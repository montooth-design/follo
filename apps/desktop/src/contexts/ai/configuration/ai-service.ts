import { CompatibleLlmProvider, validateEndpoint } from '@follo/llm';
import type { AiStatus, AiModel } from '@follo/shared';
import type { LocalDatabase } from '@follo/database';
import { CredentialVault } from './credential-vault';
import { randomUUID } from 'node:crypto';
import { NativeDecisionProvider } from '../providers/native-decision-provider';
import { validateAnswers } from '@follo/decisions';

const validModel = (model: unknown): model is string =>
  typeof model === 'string' && /^[~a-zA-Z0-9_.:/-]{1,160}$/.test(model);
export class AiService {
  private testing = false;
  private testingDecision = false;
  constructor(
    private readonly database: LocalDatabase,
    private readonly vault: CredentialVault,
    private readonly transport: typeof fetch = fetch,
    private readonly decisionVault?: CredentialVault,
  ) {}
  private config(
    kind: 'llm' | 'decision' = 'llm',
  ): { endpoint: string; model: string; verified: boolean; revision: string } | null {
    const raw = this.database.readConfiguration(kind);
    if (!raw) return null;
    if (
      typeof raw !== 'object' ||
      !('endpoint' in raw) ||
      !('model' in raw) ||
      !('verified' in raw) ||
      !('revision' in raw) ||
      typeof raw.revision !== 'string' ||
      typeof raw.model !== 'string' ||
      typeof raw.verified !== 'boolean'
    )
      throw new Error('Saved AI configuration is invalid.');

    return {
      endpoint: validateEndpoint(raw.endpoint),
      model: raw.model,
      verified: raw.verified,
      revision: raw.revision,
    };
  }
  status(): AiStatus {
    const summary = (kind: 'llm' | 'decision') => {
      const config = this.config(kind);

      return {
        configured: Boolean(config),
        verified: config?.verified ?? false,
        endpoint: config?.endpoint ?? '',
        model: config?.model ?? '',
      };
    };

    const decision = summary('decision');

    return {
      decisionConfigured: decision.verified,
      llm: summary('llm'),
      decision,
      secureStorageAvailable: this.vault.available() && (this.decisionVault?.available() ?? true),
    };
  }
  configure(input: unknown, kind: 'llm' | 'decision' = 'llm'): AiStatus {
    const vault = kind === 'llm' ? this.vault : this.decisionVault;
    if (!vault) throw new Error('Decision credential storage is unavailable.');

    if (input === null) {
      this.database.saveConfiguration(kind, null);
      vault.clear();

      return this.status();
    }

    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'apiKey,endpoint,model' ||
      !('apiKey' in input) ||
      typeof input.apiKey !== 'string' ||
      !('endpoint' in input) ||
      !('model' in input) ||
      typeof input.model !== 'string' ||
      !validModel(input.model)
    )
      throw new Error('Invalid AI configuration. Choose an endpoint, model, and credential.');
    const endpoint = validateEndpoint(input.endpoint);
    const credential =
      input.apiKey || (this.config(kind)?.endpoint === endpoint ? vault.get(endpoint) : '');
    vault.set(endpoint, credential);
    this.database.saveConfiguration(kind, {
      endpoint,
      model: input.model,
      verified: false,
      revision: randomUUID(),
    });

    return this.status();
  }
  configureOpenRouter(input: unknown): AiStatus {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'apiKey,decisionModel,llmModel' ||
      !('apiKey' in input) ||
      typeof input.apiKey !== 'string' ||
      input.apiKey.length > 8192 ||
      /[\r\n]/.test(input.apiKey) ||
      !('llmModel' in input) ||
      !('decisionModel' in input) ||
      (input.llmModel !== '' && !validModel(input.llmModel)) ||
      (input.decisionModel !== '' && !validModel(input.decisionModel)) ||
      (!input.llmModel && !input.decisionModel)
    )
      throw new Error('Choose at least one OpenRouter model and a valid key.');
    if (!this.vault.available() || !this.decisionVault?.available())
      throw new Error('OS-protected credential storage is unavailable.');
    // Validate both roles before changing either. Unselected roles retain their configuration.
    if (!input.apiKey) throw new Error('Enter an OpenRouter key to save the selected connections.');
    if (input.llmModel)
      this.configure({
        endpoint: 'https://openrouter.ai/api/v1',
        model: input.llmModel,
        apiKey: input.apiKey,
      });
    if (input.decisionModel)
      this.configure(
        {
          endpoint: 'https://openrouter.ai/api/alpha/decisions',
          model: input.decisionModel,
          apiKey: input.apiKey,
        },
        'decision',
      );

    return this.status();
  }
  decisionConnection() {
    const config = this.config('decision');
    if (!config?.verified || !this.decisionVault)
      throw new Error('Decision provider is not configured and verified.');

    return {
      model: config.model,
      revision: config.revision,
      provider: new NativeDecisionProvider(
        config.endpoint,
        this.decisionVault.get(config.endpoint),
        this.transport,
      ),
    };
  }
  decisionRevision() {
    return this.config('decision')?.revision;
  }
  async testDecision(): Promise<AiStatus> {
    if (this.testingDecision) throw new Error('A decision connection test is already running.');
    const config = this.config('decision');
    if (!config || !this.decisionVault) throw new Error('Configure a decision provider first.');
    const provider = new NativeDecisionProvider(
      config.endpoint,
      this.decisionVault.get(config.endpoint),
      this.transport,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    this.testingDecision = true;
    this.database.saveConfiguration('decision', { ...config, verified: false });

    try {
      const questions = [
        {
          id: 'connection',
          type: 'choice' as const,
          question: 'Select READY when the supplied connection_check is true, otherwise NOT_READY.',
          choices: ['READY', 'NOT_READY'],
          probabilities: true,
        },
      ];
      const raw = await provider.decide(
        { model: config.model, state: { connection_check: true }, questions },
        controller.signal,
      );
      if (validateAnswers(raw, questions)[0].value !== 'READY')
        throw new Error('Decision model failed the compatibility check.');
      if (this.config('decision')?.revision !== config.revision)
        throw new Error('Configuration changed during the connection test.');
      this.database.saveConfiguration('decision', { ...config, verified: true });

      return this.status();
    } finally {
      clearTimeout(timer);
      this.testingDecision = false;
    }
  }
  async openRouterModels(): Promise<AiModel[]> {
    let response: Response;

    try {
      response = await this.transport(
        'https://openrouter.ai/api/v1/models?output_modalities=text,decisions',
        { redirect: 'error', signal: AbortSignal.timeout(15000) },
      );
    } catch {
      throw new Error('Could not load OpenRouter models. Try again or enter a model ID.');
    }

    if (!response.ok) {
      void response.body?.cancel();
      throw new Error(`OpenRouter model list failed (HTTP ${response.status}).`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('OpenRouter returned no model list.');
    let text = '';
    let bytes = 0;
    const decoder = new TextDecoder();

    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 8 * 1024 * 1024) throw new Error('Model list exceeded its size limit.');
        text += decoder.decode(chunk.value, { stream: true });
      }

      text += decoder.decode();
    } finally {
      await reader.cancel();
    }

    let data: unknown;

    try {
      data = JSON.parse(text)?.data;
    } catch {
      throw new Error('OpenRouter returned an invalid model list.');
    }

    if (!Array.isArray(data) || data.length > 10000)
      throw new Error('OpenRouter returned an invalid model list.');
    const models: AiModel[] = [];

    for (const item of data) {
      if (!item || !validModel(item.id) || typeof item.name !== 'string' || item.name.length > 300)
        continue;
      const modalities = item.architecture?.output_modalities;
      if (Array.isArray(modalities) && modalities.includes('decisions'))
        models.push({ id: item.id, name: item.name, kind: 'decision' });
      if (
        Array.isArray(modalities) &&
        modalities.includes('text') &&
        Array.isArray(item.supported_parameters) &&
        item.supported_parameters.includes('tools')
      )
        models.push({ id: item.id, name: item.name, kind: 'llm' });
    }

    return models.sort((a, b) => a.name.localeCompare(b.name));
  }
  connection() {
    const config = this.config();
    if (!config?.verified) throw new Error('Generative provider is not configured and verified.');

    return {
      model: config.model,
      provider: new CompatibleLlmProvider(
        config.endpoint,
        this.vault.get(config.endpoint),
        this.transport,
      ),
    };
  }
  async test(): Promise<AiStatus> {
    if (this.testing) throw new Error('A connection test is already running.');
    const config = this.config();
    if (!config) throw new Error('Configure a generative provider first.');
    const provider = new CompatibleLlmProvider(
      config.endpoint,
      this.vault.get(config.endpoint),
      this.transport,
    );
    this.database.saveConfiguration('llm', { ...config, verified: false });
    this.testing = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      let complete = false;

      for await (const event of provider.stream({
        model: config.model,
        signal: controller.signal,
        messages: [
          {
            role: 'system',
            content:
              'Compatibility check only: call follo_ping with an empty object. No repository data is supplied.',
          },
          { role: 'user', content: 'Call follo_ping now.' },
        ],
        tools: [
          {
            name: 'follo_ping',
            description: 'Connection test',
            parameters: {
              type: 'object',
              properties: {},
              required: [],
              additionalProperties: false,
            },
          },
        ],
      })) {
        if (event.type === 'complete') {
          let args: unknown;

          try {
            args = JSON.parse(event.response.toolCalls[0]?.arguments ?? 'null');
          } catch {
            throw new Error('Model returned invalid compatibility-check arguments.');
          }

          if (
            event.response.toolCalls.length !== 1 ||
            event.response.toolCalls[0].name !== 'follo_ping' ||
            JSON.stringify(args) !== '{}'
          )
            throw new Error('Model did not pass the streaming native-tool compatibility check.');
          complete = true;
        }
      }

      if (!complete) throw new Error('Provider test did not complete.');
      // A changed configuration cannot be verified by a response to an earlier endpoint/model.
      const current = this.config();
      if (current?.revision !== config.revision)
        throw new Error('Configuration changed during the connection test.');
      this.database.saveConfiguration('llm', { ...config, verified: true });

      return this.status();
    } finally {
      clearTimeout(timer);
      this.testing = false;
    }
  }
}
