import { redactSecrets } from './secrets';

export { redactSecrets } from './secrets';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}
export interface LlmRequest {
  model: string;
  messages: LlmMessage[];
  tools: ToolDefinition[];
  signal: AbortSignal;
}
export interface LlmResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: { inputTokens: number | null; outputTokens: number | null };
  latencyMs: number;
}
export type LlmStreamEvent =
  { type: 'text'; text: string } | { type: 'complete'; response: LlmResponse };
export interface LlmProvider {
  id: string;
  name: string;
  getCapabilities(): { chat: boolean; streaming: boolean; toolCalling: boolean };
  respond(request: LlmRequest): Promise<LlmResponse>;
  stream?(request: LlmRequest): AsyncIterable<LlmStreamEvent>;
}

export function validateEndpoint(input: unknown): string {
  if (typeof input !== 'string' || input.length > 500)
    throw new Error('Invalid provider endpoint.');
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new Error('Invalid provider endpoint.');
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new Error(
      'Use HTTPS or an explicit loopback HTTP endpoint, without credentials or query parameters.',
    );

  return url.href.replace(/\/$/, '');
}

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid provider response.');

  return input as Record<string, unknown>;
}

function providerJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Provider returned invalid JSON.');
  }
}

function nativeCalls(calls: ToolCall[]) {
  return calls.map((call) => ({
    id: call.id,
    type: 'function',
    function: { name: call.name, arguments: call.arguments },
  }));
}

function callsFrom(input: unknown): ToolCall[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 24)
    throw new Error('Invalid or excessive provider tool calls.');
  const calls = input.map((raw) => {
    const call = object(raw);
    const fn = object(call.function);
    if (
      call.type !== 'function' ||
      typeof call.id !== 'string' ||
      !call.id ||
      call.id.length > 200 ||
      typeof fn.name !== 'string' ||
      !/^[a-z_]{1,64}$/.test(fn.name) ||
      typeof fn.arguments !== 'string' ||
      fn.arguments.length > 16000
    )
      throw new Error('Invalid provider tool call.');

    return { id: call.id, name: fn.name, arguments: fn.arguments };
  });
  if (new Set(calls.map((call) => call.id)).size !== calls.length)
    throw new Error('Duplicate provider tool-call IDs.');

  return calls;
}

function usageFrom(raw: unknown) {
  const usage = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

  return { inputTokens: count(usage.prompt_tokens), outputTokens: count(usage.completion_tokens) };
}

/** Protocol adapter, with user-selected endpoint/model. No model capability or price is hard-coded. */
export class CompatibleLlmProvider implements LlmProvider {
  readonly id = 'openai-compatible';
  readonly name = 'OpenAI-compatible';
  private readonly endpoint: string;
  constructor(
    endpoint: string,
    private readonly credential: string,
    private readonly transport: typeof fetch = fetch,
  ) {
    this.endpoint = validateEndpoint(endpoint);
  }
  getCapabilities() {
    return { chat: true, streaming: true, toolCalling: true };
  }
  private async request(request: LlmRequest, stream: boolean) {
    const messages = request.messages.map((message) => ({
      role: message.role,
      content: message.content === null ? null : redactSecrets(message.content),
      ...(message.toolCalls ? { tool_calls: nativeCalls(message.toolCalls) } : {}),
      ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    }));
    const tools = request.tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
    let response: Response;

    try {
      response = await this.transport(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        signal: request.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.credential ? { Authorization: `Bearer ${this.credential}` } : {}),
        },
        body: JSON.stringify({
          model: request.model,
          messages,
          ...(tools.length ? { tools } : {}),
          stream,
          store: false,
        }),
      });
    } catch {
      throw new Error(
        request.signal.aborted
          ? 'Provider request cancelled or timed out.'
          : 'Provider connection failed. Check endpoint and connection settings.',
      );
    }

    if (!response.ok) {
      void response.body?.cancel();
      throw new Error(
        `Provider request failed (HTTP ${response.status}). Check credentials, model, and API compatibility.`,
      );
    }

    return response;
  }
  async respond(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const response = await this.request(request, false);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Provider returned no response body.');
    let bytes = 0;
    const chunks: Uint8Array[] = [];

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2 * 1024 * 1024) throw new Error('Provider response exceeded its size limit.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }

    const raw = object(providerJson(new TextDecoder().decode(concat(chunks, bytes))));
    if (!Array.isArray(raw.choices) || raw.choices.length !== 1)
      throw new Error('Expected one provider completion.');
    const choice = object(raw.choices[0]);
    const message = object(choice.message);
    if (!['stop', 'tool_calls'].includes(String(choice.finish_reason)))
      throw new Error('Provider response was truncated or refused.');
    const text = message.content === null ? '' : message.content;
    if (typeof text !== 'string' || text.length > 120000) throw new Error('Invalid provider text.');

    return {
      text,
      toolCalls: callsFrom(message.tool_calls),
      usage: usageFrom(raw.usage),
      latencyMs: Date.now() - started,
    };
  }
  async *stream(request: LlmRequest): AsyncIterable<LlmStreamEvent> {
    const started = Date.now();
    const response = await this.request(request, true);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Provider returned no stream.');
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let bytes = 0;
    let finished = false;
    let reason = '';
    let usage: unknown;
    const calls = new Map<number, { id: string; name: string; arguments: string }>();

    try {
      while (true) {
        const chunk = await reader.read();

        if (chunk.done) {
          buffer += decoder.decode();
          break;
        }

        bytes += chunk.value.byteLength;
        if (bytes > 2 * 1024 * 1024) throw new Error('Provider stream exceeded its size limit.');
        buffer += decoder.decode(chunk.value, { stream: true });
        let newline: number;

        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trimEnd();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();

          if (data === '[DONE]') {
            finished = true;
            continue;
          }

          const event = object(providerJson(data));
          if (event.usage) usage = event.usage;
          if (!Array.isArray(event.choices) || !event.choices.length) continue;
          const choice = object(event.choices[0]);
          const delta = object(choice.delta ?? {});
          if (choice.finish_reason) reason = String(choice.finish_reason);

          if (typeof delta.content === 'string') {
            text += delta.content;
            if (text.length > 120000) throw new Error('Provider text exceeded its limit.');
            yield { type: 'text', text: delta.content };
          }

          if (Array.isArray(delta.tool_calls))
            for (const raw of delta.tool_calls) {
              const call = object(raw);
              if (
                typeof call.index !== 'number' ||
                !Number.isInteger(call.index) ||
                call.index < 0 ||
                call.index >= 24
              )
                throw new Error('Invalid streaming tool index.');
              const current = calls.get(call.index) ?? { id: '', name: '', arguments: '' };
              const fn = object(call.function ?? {});
              if (typeof call.id === 'string') current.id += call.id;
              if (typeof fn.name === 'string') current.name += fn.name;
              if (typeof fn.arguments === 'string') current.arguments += fn.arguments;
              if (
                current.id.length > 200 ||
                current.name.length > 64 ||
                current.arguments.length > 16000
              )
                throw new Error('Streaming tool exceeded its limit.');
              calls.set(call.index, current);
            }
        }
      }
    } finally {
      await reader.cancel();
    }

    if (!finished || !['stop', 'tool_calls'].includes(reason))
      throw new Error('Provider stream ended without a complete response.');
    const toolCalls = callsFrom(
      [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
    );
    yield {
      type: 'complete',
      response: { text, toolCalls, usage: usageFrom(usage), latencyMs: Date.now() - started },
    };
  }
}

function concat(chunks: Uint8Array[], size: number) {
  const result = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}
