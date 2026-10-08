import { DecisionEngine } from '@follo/decisions';
import type { LocalDatabase } from '@follo/database';
import { changeRiskDefinition, changeRiskState } from '@follo/decisions';
import type { AnalysisService } from '../../repositories/application/analysis-service';
import type { AiService } from '../configuration/ai-service';

/** Trusted definitions/providers register here; the renderer cannot supply definitions or prompts. */
export class DecisionService {
  readonly engine: DecisionEngine;
  constructor(
    private readonly database: LocalDatabase,
    private readonly analysis: AnalysisService,
    private readonly ai?: AiService,
  ) {
    this.engine = new DecisionEngine(database);
    this.engine.register(changeRiskDefinition);
  }
  list() {
    return this.engine.list().map(({ id, version, name }) => ({
      id,
      version,
      name,
      configured: this.ai?.status().decisionConfigured ?? false,
    }));
  }
  async evaluate(repositoryId: unknown, analysisId: unknown, fileId: unknown) {
    const inspection = this.analysis.inspectFile(repositoryId, analysisId, {
      fileId,
      maxDepth: 0,
      targetFileId: null,
    });
    const state = changeRiskState(
      inspection,
      this.analysis.getState(repositoryId).result!.coverage,
    );
    if (!this.ai)
      return this.engine.evaluate('change-risk', {
        analysisId: analysisId as string,
        subjectId: fileId as string,
        facts: state,
      });
    const connection = this.ai.decisionConnection();
    const engine = new DecisionEngine(
      {
        saveDefinition: (definition) => this.database.saveDefinition(definition),
        saveResult: (result) => {
          if (
            this.ai?.decisionRevision() !== connection.revision ||
            !this.ai.status().decisionConfigured
          )
            throw new Error('Decision configuration changed during evaluation.');
          this.database.saveResult(result);
        },
      },
      connection,
    );
    engine.register(changeRiskDefinition);

    return engine.evaluate('change-risk', {
      analysisId: analysisId as string,
      subjectId: fileId as string,
      facts: state,
    });
  }
  results(repositoryId: unknown, analysisId: unknown) {
    this.analysis.getGraph(repositoryId, analysisId);

    return this.database.getDecisionResults(analysisId as string);
  }
}
