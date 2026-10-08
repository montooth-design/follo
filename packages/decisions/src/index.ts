import { createHash, randomUUID } from 'node:crypto';

export { changeRiskDefinition, changeRiskState } from './change-risk';
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type DecisionQuestion =
  | { id: string; type: 'choice'; question: string; choices: string[]; probabilities: boolean }
  | { id: string; type: 'boolean'; question: string }
  | { id: string; type: 'score'; question: string; min: number; max: number };
export interface DecisionContext {
  analysisId: string;
  subjectId: string;
  facts: JsonValue;
}
export interface DecisionDefinition {
  id: string;
  version: number;
  name: string;
  questions: DecisionQuestion[];
  extractState(context: DecisionContext): JsonValue;
}
export interface DecisionModelProvider {
  id: string;
  name: string;
  getCapabilities(
    model: string,
  ): Promise<{ questionTypes: DecisionQuestion['type'][]; probabilities: boolean }>;
  decide(
    request: { model: string; state: JsonValue; questions: DecisionQuestion[] },
    signal: AbortSignal,
  ): Promise<unknown>;
}
export interface DecisionAnswer {
  questionId: string;
  value: string | boolean | number;
  probabilities?: Record<string, number>;
}
export interface DecisionResult {
  decisionId: string;
  definitionId: string;
  definitionVersion: number;
  analysisId: string;
  subjectId: string;
  inputStateHash: string;
  state: JsonValue;
  provider: string;
  model: string;
  answers: DecisionAnswer[];
  latencyMs: number;
  createdAt: string;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }

  throw new Error('Decision state must contain finite JSON facts only.');
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Malformed decision response.');

  return input as Record<string, unknown>;
}

export function validateAnswers(input: unknown, questions: DecisionQuestion[]): DecisionAnswer[] {
  const response = record(input);
  if (
    Object.keys(response).join(',') !== 'answers' ||
    !Array.isArray(response.answers) ||
    response.answers.length !== questions.length
  )
    throw new Error('Expected exactly one answer per registered question.');
  const seen = new Set<string>();

  return response.answers.map((raw) => {
    const answer = record(raw);
    const question = questions.find((item) => item.id === answer.questionId);
    if (!question || seen.has(question.id))
      throw new Error('Unknown or duplicate decision question.');
    seen.add(question.id);
    const expected =
      question.type === 'choice' && question.probabilities
        ? 'probabilities,questionId,value'
        : 'questionId,value';
    if (Object.keys(answer).sort().join(',') !== expected)
      throw new Error('Unexpected decision answer fields.');
    if (question.type === 'boolean' && typeof answer.value !== 'boolean')
      throw new Error('Expected Boolean decision.');
    if (
      question.type === 'score' &&
      (typeof answer.value !== 'number' ||
        !Number.isFinite(answer.value) ||
        answer.value < question.min ||
        answer.value > question.max)
    )
      throw new Error('Decision score is outside its defined range.');

    if (question.type === 'choice') {
      if (typeof answer.value !== 'string' || !question.choices.includes(answer.value))
        throw new Error('Decision outcome is not allowed.');

      if (question.probabilities) {
        const probabilities = record(answer.probabilities);
        const values = Object.values(probabilities);
        if (
          Object.keys(probabilities).sort().join('\n') !==
            [...question.choices].sort().join('\n') ||
          values.some(
            (value) =>
              typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1,
          ) ||
          Math.abs((values as number[]).reduce((a, b) => a + b, 0) - 1) > 0.001 ||
          probabilities[answer.value] !== Math.max(...(values as number[]))
        )
          throw new Error('Decision probabilities are invalid or disagree with the outcome.');
      }
    }

    return structuredClone(answer) as unknown as DecisionAnswer;
  });
}

export class DecisionEngine {
  private readonly definitions = new Map<string, DecisionDefinition>();
  constructor(
    private readonly store: {
      saveDefinition(definition: {
        id: string;
        version: number;
        name: string;
        questions: DecisionQuestion[];
      }): void;
      saveResult(result: DecisionResult): void;
    },
    private readonly configured?: { provider: DecisionModelProvider; model: string },
  ) {}
  register(definition: DecisionDefinition): void {
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(definition.id) ||
      this.definitions.has(definition.id) ||
      !Number.isSafeInteger(definition.version) ||
      definition.version < 1 ||
      !definition.questions.length ||
      new Set(definition.questions.map((question) => question.id)).size !==
        definition.questions.length
    )
      throw new Error('Invalid or duplicate decision definition.');

    for (const question of definition.questions) {
      if (
        !question.id ||
        !question.question ||
        (question.type === 'choice' &&
          (question.choices.length < 2 ||
            question.choices.some((choice) => !choice) ||
            new Set(question.choices).size !== question.choices.length)) ||
        (question.type === 'score' &&
          (!Number.isFinite(question.min) ||
            !Number.isFinite(question.max) ||
            question.min > question.max))
      )
        throw new Error('Invalid decision question.');
    }

    this.store.saveDefinition({
      id: definition.id,
      version: definition.version,
      name: definition.name,
      questions: definition.questions,
    });
    this.definitions.set(definition.id, {
      ...definition,
      questions: structuredClone(definition.questions),
    });
  }
  list() {
    return [...this.definitions.values()].map(({ id, version, name, questions }) => ({
      id,
      version,
      name,
      questions: structuredClone(questions),
      configured: Boolean(this.configured),
    }));
  }
  async evaluate(definitionId: string, context: DecisionContext): Promise<DecisionResult> {
    const definition = this.definitions.get(definitionId);
    if (!definition) throw new Error('Decision definition is not registered.');
    if (!this.configured) throw new Error('Decision provider not configured.');
    const state = definition.extractState(context);
    const canonical = canonicalJson(state);
    const controller = new AbortController();
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race([
        (async () => {
          const { provider, model } = this.configured!;
          const capabilities = await provider.getCapabilities(model);
          if (
            definition.questions.some(
              (question) =>
                !capabilities.questionTypes.includes(question.type) ||
                (question.type === 'choice' &&
                  question.probabilities &&
                  !capabilities.probabilities),
            )
          )
            throw new Error('Provider does not support this registered decision.');
          if (controller.signal.aborted) throw new Error('Decision provider timed out.');
          const raw = await provider.decide(
            {
              model,
              state: structuredClone(state),
              questions: structuredClone(definition.questions),
            },
            controller.signal,
          );
          const answers = validateAnswers(raw, definition.questions);

          return {
            decisionId: randomUUID(),
            definitionId,
            definitionVersion: definition.version,
            analysisId: context.analysisId,
            subjectId: context.subjectId,
            inputStateHash: createHash('sha256').update(canonical).digest('hex'),
            state,
            provider: provider.id,
            model,
            answers,
            latencyMs: Date.now() - started,
            createdAt: new Date().toISOString(),
          };
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Decision provider timed out.'));
          }, 30000);
        }),
      ]);
      this.store.saveResult(result);

      return result;
    } finally {
      clearTimeout(timer);
    }
  }
}
