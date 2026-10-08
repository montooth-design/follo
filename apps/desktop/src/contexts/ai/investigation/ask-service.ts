import { randomUUID } from 'node:crypto';
import type { AskState, ExplainCodeRequest } from '@follo/shared';
import type { AiService } from '../configuration/ai-service';
import type { AnalysisService } from '../../repositories/application/analysis-service';
import type { DecisionService } from '../decisions/decision-service';
import type { PrivacyService } from '../../repositories/application/source-permissions';
import { EngineeringTools } from './tools';
import { investigate, InvestigationFailure, INVESTIGATION_LIMITS } from './agent';
import { evaluateGroundedness } from './evaluation';
import { textHash, type InvestigationObserver } from './observability';

/** One cancellable investigation session. Ask, summaries, concepts and code explanations
 * use separate instances so their jobs do not overwrite each other's state.
 */
export class AskService {
  private controller: AbortController | null = null;
  private state: AskState | null = null;
  constructor(
    private readonly ai: AiService,
    private readonly analysis: AnalysisService,
    private readonly decisions: DecisionService,
    private readonly privacy: PrivacyService,
    private readonly observer: InvestigationObserver,
  ) {}
  start(
    repositoryId: unknown,
    analysisId: unknown,
    question: unknown,
    purpose: 'ask' | 'summary' | 'code' | 'concept' | 'documentation' = 'ask',
    selection?: ExplainCodeRequest,
  ): string {
    if (this.controller) throw new Error('Another investigation is running.');
    if (
      typeof repositoryId !== 'string' ||
      typeof analysisId !== 'string' ||
      typeof question !== 'string' ||
      !question.trim() ||
      question.length > (purpose === 'documentation' ? 64000 : 4000)
    )
      throw new Error('Select a saved analysis and enter a question of 1–4000 characters.');
    this.analysis.getGraph(repositoryId, analysisId);
    const connection = this.ai.connection();
    const policy = this.privacy.get(repositoryId, analysisId);
    const tools = new EngineeringTools(
      repositoryId,
      analysisId,
      this.analysis,
      this.decisions,
      this.privacy.budget(repositoryId, analysisId),
    );
    const investigationTools =
      purpose === 'code' && selection
        ? {
            definitions: tools.definitions.filter((tool) =>
              ['get_file', 'get_dependencies', 'get_dependents'].includes(tool.name),
            ),
            evidence: tools.evidence,
            initialCall: {
              name: 'get_file',
              arguments: JSON.stringify({
                fileId: selection.fileId,
                source: 'snippet',
                startLine: selection.startLine,
                endLine: selection.endLine,
              }),
            },
            execute: (name: string, args: string) => {
              if (!['get_file', 'get_dependencies', 'get_dependents'].includes(name))
                throw new Error('Tool is unavailable for code explanations.');

              if (name === 'get_file') {
                const request = JSON.parse(args);
                if (
                  request.source !== 'none' &&
                  (request.fileId !== selection.fileId ||
                    request.source !== 'snippet' ||
                    request.startLine < selection.startLine ||
                    request.endLine > selection.endLine)
                )
                  throw new Error('Tool source access is limited to the selected lines.');
              }

              return tools.execute(name, args);
            },
          }
        : purpose === 'summary' || purpose === 'concept' || purpose === 'documentation'
          ? {
              definitions: tools.definitions.filter((tool) => tool.name !== 'get_decision'),
              evidence: tools.evidence,
              ...(purpose === 'concept'
                ? {
                    initialCall: {
                      name: 'get_repository_summary',
                      arguments: JSON.stringify({ offset: 0 }),
                    },
                  }
                : {}),
              execute: (name: string, args: string) => {
                if (name === 'get_decision')
                  throw new Error('Tool is unavailable for repository summaries.');

                return tools.execute(name, args);
              },
            }
          : tools;
    const controller = new AbortController();
    this.controller = controller;
    const state: AskState = {
      id: randomUUID(),
      repositoryId,
      analysisId,
      status: 'running',
      streamedText: '',
      answer: '',
      activity: [],
      evidence: { files: [], decisionIds: [] },
      stats: null,
      error: null,
    };
    this.state = state;
    void investigate(
      connection.provider,
      connection.model,
      question,
      investigationTools,
      controller.signal,
      (event) => {
        if (event.type === 'round') state.streamedText = '';
        else if (event.type === 'text') state.streamedText += event.text;
        else if (event.activity.status !== 'running') state.activity.push(event.activity);
        else state.activeTool = event.activity.name;
        if (event.type === 'tool' && event.activity.status !== 'running')
          state.activeTool = undefined;
      },
      purpose === 'documentation'
        ? { ...INVESTIGATION_LIMITS, questionCharacters: 64000 }
        : INVESTIGATION_LIMITS,
    )
      .then((result) => {
        if (controller.signal.aborted) throw new Error('Investigation cancelled.');
        this.analysis.getGraph(repositoryId, analysisId);
        Object.assign(state, result);
        state.evaluation = evaluateGroundedness(
          result.answer,
          result.evidence,
          this.analysis.getGraph(repositoryId, analysisId),
          this.decisions.results(repositoryId, analysisId),
        );
        state.status = 'complete';
        state.streamedText = '';
      })
      .catch((error) => {
        if (error instanceof InvestigationFailure) Object.assign(state, error.partial);
        state.status = controller.signal.aborted ? 'cancelled' : 'failed';
        // Provider JSON parse errors may contain remote text. Expose only recognized application errors.
        const message = error instanceof Error ? error.message : '';
        state.error = controller.signal.aborted
          ? 'Investigation cancelled.'
          : /^(Investigation |Provider (request|connection|response|returned)|Tool |Invalid or repeated provider|Analysis changed)/.test(
                message,
              )
            ? message.slice(0, 500)
            : 'Provider returned an invalid response. Check model compatibility and connection settings.';
        state.streamedText = '';
        state.answer = '';
      })
      .finally(() => {
        state.activeTool = undefined;

        try {
          this.observer.record({
            id: state.id,
            createdAt: new Date().toISOString(),
            analysisId,
            provider: connection.provider.id,
            model: connection.model,
            permission: policy.level,
            questionHash: textHash(question),
            questionCharacters: question.length,
            answerHash: textHash(state.answer),
            answerCharacters: state.answer.length,
            status: state.status,
            stats: state.stats,
            activity: state.activity,
            evidence: state.evidence,
            evaluation: state.evaluation,
            error: state.error,
          });
        } catch {
          state.observationError = 'Investigation metadata could not be saved locally.';
        }

        if (this.controller === controller) this.controller = null;
      });

    return state.id;
  }
  get(id: unknown): AskState {
    if (typeof id !== 'string' || this.state?.id !== id) throw new Error('Unknown investigation.');

    return structuredClone(this.state);
  }
  cancel(): void {
    this.controller?.abort();
  }
}
