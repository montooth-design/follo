import {
  validateAnswers,
  type DecisionModelProvider,
  type DecisionQuestion,
  type JsonValue,
} from '@follo/decisions';
import { validateEndpoint } from '@follo/llm';

/** Native Decisions protocol. Never routes a decision through chat completions. */
export class NativeDecisionProvider implements DecisionModelProvider {
  readonly id: string;
  readonly name = 'Decisions API';
  private readonly endpoint: string;
  constructor(
    endpoint: string,
    private readonly credential: string,
    private readonly transport: typeof fetch = fetch,
  ) {
    this.endpoint = validateEndpoint(endpoint);
    this.id =
      this.endpoint === 'https://openrouter.ai/api/alpha/decisions'
        ? 'openrouter-decisions'
        : 'native-decisions';
  }
  async getCapabilities() {
    return { questionTypes: ['choice'] as DecisionQuestion['type'][], probabilities: true };
  }
  async decide(
    request: { model: string; state: JsonValue; questions: DecisionQuestion[] },
    signal: AbortSignal,
  ): Promise<unknown> {
    const questions = Object.fromEntries(
      request.questions.map((question) => {
        if (question.type !== 'choice')
          throw new Error('This adapter supports choice decisions only.');

        return [
          question.id,
          {
            type: 'choice',
            instructions: question.question,
            criteria: Object.fromEntries(question.choices.map((choice) => [choice, choice])),
          },
        ];
      }),
    );
    let response: Response;

    try {
      response = await this.transport(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.credential ? { Authorization: `Bearer ${this.credential}` } : {}),
        },
        body: JSON.stringify({ model: request.model, state: request.state, questions }),
      });
    } catch {
      throw new Error(
        signal.aborted
          ? 'Decision request cancelled or timed out.'
          : 'Decision connection failed. Check the endpoint.',
      );
    }

    if (!response.ok) {
      void response.body?.cancel();
      throw new Error(
        `Decision request failed (HTTP ${response.status}). Check model, credentials, and Decisions API compatibility.`,
      );
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Decision provider returned no response.');
    let text = '';
    let bytes = 0;
    const decoder = new TextDecoder();

    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1024 * 1024) throw new Error('Decision response exceeded its size limit.');
        text += decoder.decode(chunk.value, { stream: true });
      }

      text += decoder.decode();
    } finally {
      await reader.cancel();
    }

    let raw: {
      answers?: Record<string, { type?: unknown; choice?: unknown; probabilities?: unknown }>;
    };

    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error('Decision provider returned invalid JSON.');
    }

    if (
      !raw ||
      !raw.answers ||
      typeof raw.answers !== 'object' ||
      Array.isArray(raw.answers) ||
      Object.keys(raw.answers).sort().join(',') !==
        request.questions
          .map((question) => question.id)
          .sort()
          .join(',')
    )
      throw new Error('Decision provider returned unexpected questions.');
    const answers = request.questions.map((question) => {
      const answer = raw.answers![question.id];
      if (!answer || answer.type !== 'choice')
        throw new Error('Decision provider returned an invalid answer type.');

      return {
        questionId: question.id,
        value: answer.choice,
        ...(question.type === 'choice' && question.probabilities
          ? { probabilities: answer.probabilities }
          : {}),
      };
    });

    return { answers: validateAnswers({ answers }, request.questions) };
  }
}
