import {
  VerificationBadge,
  VerificationButton,
  SectionCard,
  SectionHeader,
} from '../../../shared/ui';
import { useEffect, useState } from 'react';
import type { AiConnectionInput, AiModel, AiStatus } from '@follo/shared';

const empty = (): AiConnectionInput => ({ endpoint: '', model: '', apiKey: '' });

export function AiSettings() {
  const [status, setStatus] = useState<AiStatus>();
  const [testingRole, setTestingRole] = useState<'llm' | 'decision' | null>(null);
  const [mode, setMode] = useState<'separate' | 'openrouter'>('separate');
  const [llm, setLlm] = useState(empty);
  const [decision, setDecision] = useState(empty);
  const [routerKey, setRouterKey] = useState('');
  const [routerLlm, setRouterLlm] = useState('');
  const [routerDecision, setRouterDecision] = useState('');
  const [models, setModels] = useState<AiModel[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: 'verified' | 'saved' | 'removed';
    text: string;
  } | null>(null);

  function sync(info: AiStatus) {
    setStatus(info);
    setLlm({ endpoint: info.llm.endpoint, model: info.llm.model, apiKey: '' });
    setDecision({ endpoint: info.decision.endpoint, model: info.decision.model, apiKey: '' });
    setRouterLlm(info.llm.endpoint === 'https://openrouter.ai/api/v1' ? info.llm.model : '');
    setRouterDecision(
      info.decision.endpoint === 'https://openrouter.ai/api/alpha/decisions'
        ? info.decision.model
        : '',
    );
  }

  useEffect(() => {
    let active = true;
    window
      .engineering!.getAiStatus()
      .then((info) => {
        if (active) {
          sync(info);
          if (
            info.llm.endpoint.startsWith('https://openrouter.ai/') ||
            info.decision.endpoint.startsWith('https://openrouter.ai/')
          )
            setMode('openrouter');
        }
      })
      .catch((error) => {
        if (active) setError(String(error));
      });

    return () => {
      active = false;
    };
  }, []);

  async function action(role: 'llm' | 'decision', kind: 'save' | 'test' | 'clear') {
    setTestingRole(kind === 'test' ? role : null);
    setBusy(true);
    setError('');
    setNotice(null);

    try {
      const bridge = window.engineering!;
      const info =
        kind === 'test'
          ? await (role === 'llm' ? bridge.testLlmConnection() : bridge.testDecisionConnection())
          : await (role === 'llm'
              ? bridge.configureLlm(kind === 'clear' ? null : llm)
              : bridge.configureDecision(kind === 'clear' ? null : decision));
      sync(info);
      setNotice({
        kind: kind === 'test' ? 'verified' : kind === 'save' ? 'saved' : 'removed',
        text: `${role === 'llm' ? 'LLM' : 'Decision Model'} ${kind === 'test' ? 'verified' : kind === 'save' ? 'saved · Needs verification' : 'removed'}`,
      });
    } catch (error) {
      setError(String(error));

      try {
        setStatus(await window.engineering!.getAiStatus());
      } catch {
        /* Keep the original actionable error. */
      }
    } finally {
      setLlm((previous) => ({ ...previous, apiKey: '' }));
      setDecision((previous) => ({ ...previous, apiKey: '' }));
      setTestingRole(null);
      setBusy(false);
    }
  }

  async function saveRouter() {
    setBusy(true);
    setError('');
    setNotice(null);

    try {
      sync(
        await window.engineering!.configureOpenRouter({
          apiKey: routerKey,
          llmModel: routerLlm,
          decisionModel: routerDecision,
        }),
      );
      setNotice({ kind: 'saved', text: 'Connections saved · Test each model' });
    } catch (error) {
      setError(String(error));
    } finally {
      setRouterKey('');
      setBusy(false);
    }
  }

  async function loadModels() {
    setBusy(true);
    setError('');
    setNotice(null);

    try {
      setModels(await window.engineering!.getOpenRouterModels());
      setLoaded(true);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }

  function hasChanges(role: 'llm' | 'decision') {
    const info = status?.[role];
    if (!info) return false;

    if (mode === 'openrouter') {
      const model = role === 'llm' ? routerLlm : routerDecision;
      const endpoint =
        role === 'llm'
          ? 'https://openrouter.ai/api/v1'
          : 'https://openrouter.ai/api/alpha/decisions';

      return !!model && (model !== info.model || endpoint !== info.endpoint || !!routerKey);
    }

    const input = role === 'llm' ? llm : decision;

    return input.endpoint !== info.endpoint || input.model !== info.model || !!input.apiKey;
  }

  function connectionState(role: 'llm' | 'decision') {
    const info = status?.[role];
    const state =
      testingRole === role
        ? 'testing'
        : hasChanges(role)
          ? 'unsaved'
          : info?.verified
            ? 'verified'
            : info?.configured
              ? 'pending'
              : 'off';
    const label =
      state === 'verified'
        ? 'Verified'
        : state === 'testing'
          ? 'Testing…'
          : state === 'unsaved'
            ? 'Unsaved changes'
            : state === 'pending'
              ? 'Needs verification'
              : 'Not configured';

    return (
      <div className="connection-status">
        <VerificationBadge
          state={state}
          role="status"
          aria-label={`${role === 'llm' ? 'LLM' : 'Decision Model'}: ${label}`}
        >
          {label}
        </VerificationBadge>
        <span className="metadata-note">
          {state === 'verified'
            ? 'Connected · Tested · Verified'
            : state === 'pending'
              ? 'Saved · Run connection test'
              : state === 'unsaved'
                ? 'Save and test these changes'
                : state === 'testing'
                  ? 'Checking connection and model compatibility'
                  : 'Optional connection'}
        </span>
      </div>
    );
  }

  const allVerified =
    !!status?.llm.verified &&
    !!status?.decision.verified &&
    !testingRole &&
    !hasChanges('llm') &&
    !hasChanges('decision');
  const verifiedCount = (['llm', 'decision'] as const).filter(
    (role) => status?.[role].verified && testingRole !== role && !hasChanges(role),
  ).length;

  function connectionActions(role: 'llm' | 'decision', save: boolean) {
    const info = status?.[role];
    const input = role === 'llm' ? llm : decision;

    return (
      <div className="map-toolbar">
        {save && (
          <button
            className="primary"
            disabled={busy || !status?.secureStorageAvailable || !input.endpoint || !input.model}
            onClick={() => void action(role, 'save')}
          >
            Save {role === 'llm' ? 'LLM' : 'Decision Model'}
          </button>
        )}
        <VerificationButton
          label={`Test ${role === 'llm' ? 'LLM' : 'Decision Model'}`}
          busy={testingRole === role}
          disabled={busy || !info?.configured}
          onVerify={() => void action(role, 'test')}
        />
        <button
          className="secondary"
          disabled={busy || !info?.configured}
          onClick={() => void action(role, 'clear')}
        >
          Remove {role === 'llm' ? 'LLM' : 'Decision Model'}
        </button>
      </div>
    );
  }

  function fields(role: 'llm' | 'decision') {
    const input = role === 'llm' ? llm : decision;
    const update = role === 'llm' ? setLlm : setDecision;

    return (
      <div className="connection-fields">
        <label>
          {role === 'llm' ? 'API base URL' : 'Decisions request URL'}
          <input
            aria-label={role === 'llm' ? 'AI endpoint' : 'Decision endpoint'}
            value={input.endpoint}
            onChange={(event) =>
              update((previous) => ({ ...previous, endpoint: event.target.value }))
            }
            placeholder={
              role === 'llm'
                ? 'https://provider.example/v1'
                : 'https://openrouter.ai/api/alpha/decisions'
            }
          />
        </label>
        <label>
          Model ID
          <input
            aria-label={role === 'llm' ? 'AI model' : 'Decision model'}
            value={input.model}
            onChange={(event) => update((previous) => ({ ...previous, model: event.target.value }))}
            placeholder="Your selected model"
          />
        </label>
        <label>
          API key
          <input
            aria-label={role === 'llm' ? 'AI credential' : 'Decision credential'}
            type="password"
            autoComplete="off"
            value={input.apiKey}
            onChange={(event) =>
              update((previous) => ({ ...previous, apiKey: event.target.value }))
            }
            placeholder={
              status?.[role].configured ? 'Leave blank to keep the saved key' : 'Provider API key'
            }
          />
        </label>
      </div>
    );
  }

  return (
    <SectionCard variant="settings" className="ai-connections" aria-label="AI Settings">
      <SectionHeader title="AI" headingLevel="h2" className="ai-card-heading">
        <VerificationBadge
          state={allVerified ? 'verified' : 'pending'}
          className="overall"
          role="status"
        >
          {allVerified ? 'All connections verified' : `${verifiedCount} of 2 connections verified`}
        </VerificationBadge>
      </SectionHeader>
      <p className="muted">
        LLM investigates and explains. Decision Model classifies structural change risk from
        verified facts. Configure either or both.
      </p>
      <fieldset className="connection-mode" disabled={busy}>
        <legend>Connection setup</legend>
        <label>
          <input
            type="radio"
            name="connection-mode"
            checked={mode === 'separate'}
            onChange={() => {
              setMode('separate');
              setError('');
              setNotice(null);
            }}
          />
          Separate providers
        </label>
        <label>
          <input
            type="radio"
            name="connection-mode"
            checked={mode === 'openrouter'}
            onChange={() => {
              setMode('openrouter');
              setError('');
              setNotice(null);
            }}
          />
          OpenRouter
        </label>
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <div className={`connection-feedback ${notice.kind}`} role="status">
          <VerificationBadge
            state={
              notice.kind === 'verified' ? 'verified' : notice.kind === 'saved' ? 'pending' : 'off'
            }
          >
            {notice.text}
          </VerificationBadge>
          {notice.kind === 'verified' && <strong>Connected · Tested · Verified</strong>}
        </div>
      )}
      {mode === 'separate' ? (
        <div className="connection-grid">
          <fieldset disabled={busy}>
            <legend>LLM</legend>
            <p className="metadata-note">
              OpenAI-compatible chat API with streaming and tool calling.
            </p>
            {connectionState('llm')}
            {fields('llm')}
            {connectionActions('llm', true)}
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Decision Model</legend>
            <p className="metadata-note">
              Native Decisions API with choice probabilities. Use a provider with the OpenRouter
              Decisions protocol.
            </p>
            {connectionState('decision')}
            {fields('decision')}
            {connectionActions('decision', true)}
          </fieldset>
        </div>
      ) : (
        <>
          <div className="router-key">
            <label>
              OpenRouter API key
              <input
                aria-label="OpenRouter credential"
                type="password"
                autoComplete="off"
                value={routerKey}
                onChange={(event) => setRouterKey(event.target.value)}
              />
            </label>
            <button className="secondary" disabled={busy} onClick={() => void loadModels()}>
              {busy ? 'Working…' : loaded ? 'Refresh Models' : 'Load Models'}
            </button>
          </div>
          <p className="metadata-note">
            One key for both roles. Loading models contacts OpenRouter without sending repository
            data. Leave a model blank to keep that role unchanged.
          </p>
          <div className="connection-grid">
            {(['llm', 'decision'] as const).map((role) => (
              <fieldset disabled={busy} key={role}>
                <legend>{role === 'llm' ? 'LLM' : 'Decision Model'}</legend>
                {connectionState(role)}
                <label>
                  Model
                  <input
                    aria-label={
                      role === 'llm' ? 'OpenRouter LLM model' : 'OpenRouter Decision model'
                    }
                    list={`router-${role}-models`}
                    value={role === 'llm' ? routerLlm : routerDecision}
                    onChange={(event) =>
                      (role === 'llm' ? setRouterLlm : setRouterDecision)(event.target.value)
                    }
                    placeholder="Choose or enter a model ID"
                  />
                  <datalist id={`router-${role}-models`}>
                    {models
                      .filter((model) => model.kind === role)
                      .map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                  </datalist>
                </label>
                <p className="metadata-note">
                  {role === 'llm'
                    ? 'Models supporting tool calling. Streaming is checked by Test LLM.'
                    : 'Native decision models, using the separate Decisions API.'}
                </p>
                {loaded && !models.some((model) => model.kind === role) && (
                  <p className="metadata-note">
                    No compatible models listed. Enter a provider model ID and test the connection.
                  </p>
                )}
                {connectionActions(role, false)}
              </fieldset>
            ))}
          </div>
          <div className="map-toolbar">
            <button
              className="primary"
              disabled={
                busy ||
                !status?.secureStorageAvailable ||
                !routerKey ||
                (!routerLlm && !routerDecision)
              }
              onClick={() => void saveRouter()}
            >
              Save OpenRouter Connections
            </button>
          </div>
        </>
      )}
      <p className="metadata-note">
        Connection tests send a small sample with no repository data. Keys stay encrypted on this
        machine.
      </p>
      {status && !status.secureStorageAvailable && (
        <p className="inspection-warnings">
          OS-protected credential storage is unavailable; saving credentials is disabled.
        </p>
      )}
    </SectionCard>
  );
}
