import { open } from 'node:fs/promises';
import { ReadmeService, validateReadme } from '../contexts/repositories/application/readme-service';
import { app, BrowserWindow, dialog, ipcMain, session, safeStorage } from 'electron';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { LocalDatabase } from '@follo/database';
import { CHANNELS } from '@follo/shared';
import { isTrustedFrame } from './ipc-security';
import { RepositoryService } from '../contexts/repositories/application/repository-service';
import { AnalysisService } from '../contexts/repositories/application/analysis-service';
import { DecisionService } from '../contexts/ai/decisions/decision-service';
import { AiService } from '../contexts/ai/configuration/ai-service';
import { CredentialVault } from '../contexts/ai/configuration/credential-vault';
import { PrivacyService } from '../contexts/repositories/application/source-permissions';
import { AskService } from '../contexts/ai/investigation/ask-service';
import { LocalInvestigationObserver } from '../contexts/ai/investigation/observability';
import { RepositorySummaryService } from '../contexts/repositories/application/repository-summary';
import { CodeExplanationService } from '../contexts/code-intelligence/application/code-explanation';
import { ConceptSearchService } from '../contexts/search/application/concept-search';

let database: LocalDatabase | undefined;
let window: BrowserWindow | undefined;
let repositories: RepositoryService;
let analysis: AnalysisService;
let decisions: DecisionService;
let ai: AiService;
let privacy: PrivacyService;
let ask: AskService;
let repositorySummary: RepositorySummaryService;
let codeExplanation: CodeExplanationService;
let conceptSearch: ConceptSearchService;
let readme: ReadmeService;
const rendererPath = path.join(__dirname, 'renderer/index.html');
const developmentUrl = !app.isPackaged ? process.env.FOLLO_DEV_URL : undefined;

if (developmentUrl && developmentUrl !== 'http://127.0.0.1:5173/') {
  throw new Error('Unexpected development renderer URL.');
}

const trustedUrl = developmentUrl ?? pathToFileURL(rendererPath).href;
const styleNonce = randomBytes(24).toString('base64');

function registerIpc(): void {
  for (const channel of Object.values(CHANNELS)) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (
        !window ||
        !isTrustedFrame(
          event.sender.id,
          window.webContents.id,
          event.senderFrame?.url,
          trustedUrl,
          event.senderFrame === event.sender.mainFrame,
        )
      ) {
        throw new Error('Untrusted IPC sender.');
      }

      if (!database) throw new Error('Storage is unavailable.');

      if (channel === CHANNELS.readmeEvidence) {
        if (args.length !== 2) throw new Error('Invalid argument count.');

        return readme.collect(args[0], args[1]);
      }

      if (channel === CHANNELS.readmeGenerate) {
        if (args.length !== 3) throw new Error('Invalid argument count.');

        return readme.start(args[0], args[1], args[2]);
      }

      if (channel === CHANNELS.readmeState || channel === CHANNELS.readmeCancel) {
        if (args.length !== 1) throw new Error('Invalid argument count.');

        return channel === CHANNELS.readmeState ? readme.get(args[0]) : readme.cancel(args[0]);
      }

      if (channel === CHANNELS.readmeSave) {
        if (args.length !== 3) throw new Error('Invalid argument count.');

        return readme.save(args[0], args[1], args[2]);
      }

      if (channel === CHANNELS.readmeExport) {
        if (args.length !== 1) throw new Error('Invalid argument count.');
        const content = validateReadme(args[0]);
        const result = await dialog.showSaveDialog(window, {
          title: 'Export README draft',
          defaultPath: 'README.follo.md',
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
        if (result.canceled || !result.filePath) return null;
        const handle = await open(result.filePath, 'wx', 0o600);

        try {
          await handle.writeFile(content, 'utf8');
        } finally {
          await handle.close();
        }

        return result.filePath;
      }

      if (channel === CHANNELS.conceptSearch) {
        if (args.length !== 3) throw new Error('Invalid argument count.');

        return conceptSearch.start(args[0], args[1], args[2]);
      }

      if (channel === CHANNELS.conceptSearchState) {
        if (args.length !== 1) throw new Error('Invalid argument count.');

        return conceptSearch.get(args[0]);
      }

      if (channel === CHANNELS.cancelConceptSearch) {
        if (args.length !== 1 || typeof args[0] !== 'string')
          throw new Error('Invalid argument count.');

        return conceptSearch.cancel(args[0]);
      }

      if (channel === CHANNELS.fileSource) {
        if (args.length !== 3) throw new Error('Invalid argument count.');

        return analysis.getSource(args[0], args[1], args[2]);
      }

      if (channel === CHANNELS.explainCode) {
        if (args.length !== 3) throw new Error('Invalid argument count.');

        return codeExplanation.start(args[0], args[1], args[2]);
      }

      if (channel === CHANNELS.codeExplanationState) {
        if (args.length !== 1) throw new Error('Invalid argument count.');

        return codeExplanation.get(args[0]);
      }

      if (channel === CHANNELS.cancelCodeExplanation) {
        if (args.length !== 1) throw new Error('Invalid argument count.');

        return codeExplanation.cancel(args[0]);
      }

      if (channel === CHANNELS.repositorySummary || channel === CHANNELS.summaryState) {
        if (args.length !== 1) throw new Error('Invalid argument count.');

        return channel === CHANNELS.repositorySummary
          ? repositorySummary.get(args[0])
          : repositorySummary.getState(args[0]);
      }

      if (channel === CHANNELS.generateSummary) {
        if (args.length !== 2) throw new Error('Invalid argument count.');

        return repositorySummary.start(args[0], args[1]);
      }

      if (channel === CHANNELS.cancelSummary) {
        if (args.length) throw new Error('Unexpected arguments.');

        return repositorySummary.cancel();
      }

      if (channel === CHANNELS.ask) {
        if (args.length !== 3) throw new Error('Invalid argument count.');

        return ask.start(args[0], args[1], args[2]);
      }

      if (channel === CHANNELS.askState) {
        if (args.length !== 1) throw new Error('Invalid argument count.');

        return ask.get(args[0]);
      }

      if (channel === CHANNELS.cancelAsk) {
        if (args.length) throw new Error('Unexpected arguments.');

        return ask.cancel();
      }

      if (channel === CHANNELS.privacy || channel === CHANNELS.setPrivacy) {
        if (args.length !== (channel === CHANNELS.privacy ? 2 : 3))
          throw new Error('Invalid argument count.');

        if (channel === CHANNELS.setPrivacy) {
          ask.cancel();
          repositorySummary.cancel();
          codeExplanation.cancel();
          conceptSearch.cancel();
          readme.cancel();
        }

        return channel === CHANNELS.privacy
          ? privacy.get(args[0], args[1])
          : privacy.set(args[0], args[1], args[2]);
      }

      if (channel === CHANNELS.configureLlm) {
        if (args.length !== 1) throw new Error('Invalid argument count.');
        ask.cancel();
        repositorySummary.cancel();
        codeExplanation.cancel();
        conceptSearch.cancel();
        readme.cancel();

        return ai.configure(args[0]);
      }

      if (channel === CHANNELS.configureDecision || channel === CHANNELS.configureOpenRouter) {
        if (args.length !== 1) throw new Error('Invalid argument count.');
        ask.cancel();
        repositorySummary.cancel();
        codeExplanation.cancel();
        conceptSearch.cancel();
        readme.cancel();

        return channel === CHANNELS.configureDecision
          ? ai.configure(args[0], 'decision')
          : ai.configureOpenRouter(args[0]);
      }

      if (channel === CHANNELS.evaluateDecision) {
        if (args.length !== 3) throw new Error('Invalid argument count.');

        return decisions.evaluate(args[0], args[1], args[2]);
      }

      if (channel === CHANNELS.decisionResults) {
        if (args.length !== 2) throw new Error('Invalid argument count.');

        return decisions.results(args[0], args[1]);
      }

      if (channel === CHANNELS.inspectFile || channel === CHANNELS.search) {
        if (args.length !== 3) throw new Error('Invalid argument count.');

        return channel === CHANNELS.inspectFile
          ? analysis.inspectFile(args[0], args[1], args[2])
          : analysis.searchCode(args[0], args[1], args[2]);
      }

      if (channel === CHANNELS.graph) {
        if (args.length !== 2) throw new Error('Invalid argument count.');

        return analysis.getGraph(args[0], args[1]);
      }

      if (channel === CHANNELS.analyzeRepository || channel === CHANNELS.parsedFile) {
        if (args.length !== 2) throw new Error('Invalid argument count.');

        if (channel === CHANNELS.analyzeRepository) {
          ask.cancel();
          repositorySummary.cancel();
          codeExplanation.cancel();
          conceptSearch.cancel();
          readme.cancel();
          privacy.preserve(args[0]);
        }

        return channel === CHANNELS.analyzeRepository
          ? analysis.start(args[0], args[1])
          : analysis.getFile(args[0], args[1]);
      }

      if (channel === CHANNELS.analysisState) {
        if (args.length !== 1) throw new Error('Invalid argument count.');

        return analysis.getState(args[0]);
      }

      if (channel === CHANNELS.updateSettings) {
        if (args.length !== 1) throw new Error('Invalid argument count.');

        return database.updateSettings(args[0]);
      }

      if (channel === CHANNELS.reopenRepository) {
        if (args.length !== 1) throw new Error('Invalid argument count.');

        return repositories.reopen(args[0]);
      }

      if (args.length) throw new Error('Unexpected arguments.');
      if (channel === CHANNELS.aiStatus) return ai.status();

      if (channel === CHANNELS.testLlm) {
        ask.cancel();
        repositorySummary.cancel();
        codeExplanation.cancel();
        conceptSearch.cancel();
        readme.cancel();

        return ai.test();
      }

      if (channel === CHANNELS.testDecision) {
        ask.cancel();

        return ai.testDecision();
      }

      if (channel === CHANNELS.openRouterModels) return ai.openRouterModels();
      if (channel === CHANNELS.decisionDefinitions) return decisions.list();
      if (channel === CHANNELS.getSettings) return database.getSettings();
      if (channel === CHANNELS.recentRepositories) return database.getRecentRepositories();

      if (channel === CHANNELS.openRepository) {
        const parent = window;

        return repositories.open(async () => {
          const result = await dialog.showOpenDialog(parent, {
            title: 'Open a local repository',
            buttonLabel: 'Open Repository',
            properties: ['openDirectory'],
          });

          return result.canceled ? null : (result.filePaths[0] ?? null);
        });
      }

      return {
        name: 'Follo',
        version: app.getVersion(),
        storage: 'ready',
        styleNonce,
        schemaVersion: database.schemaVersion,
        phase: 17,
      };
    });
  }
}

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 680,
    title: 'Follo · Engineering Intelligence',
    backgroundColor: '#101419',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => {
    window = undefined;
  });
  if (developmentUrl) await window.loadURL(developmentUrl);
  else await window.loadFile(rendererPath);
}

app
  .whenReady()
  .then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const csp = developmentUrl
        ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:5173; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'"
        : `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${styleNonce}'; connect-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'`;
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
      });
    });
    database = new LocalDatabase(path.join(app.getPath('userData'), 'follo.sqlite'));
    repositories = new RepositoryService(database);
    analysis = new AnalysisService(database);
    privacy = new PrivacyService(database, analysis);
    const protection = {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptString(value),
      decryptString: (value) => safeStorage.decryptString(value),
      ...(process.platform === 'linux'
        ? { getSelectedStorageBackend: () => safeStorage.getSelectedStorageBackend() }
        : {}),
    } satisfies ConstructorParameters<typeof CredentialVault>[1];
    ai = new AiService(
      database,
      new CredentialVault(path.join(app.getPath('userData'), 'llm.credential'), protection),
      fetch,
      new CredentialVault(path.join(app.getPath('userData'), 'decision.credential'), protection),
    );
    decisions = new DecisionService(database, analysis, ai);
    ask = new AskService(
      ai,
      analysis,
      decisions,
      privacy,
      new LocalInvestigationObserver(database),
    );
    repositorySummary = new RepositorySummaryService(
      database,
      analysis,
      ai,
      privacy,
      new AskService(ai, analysis, decisions, privacy, new LocalInvestigationObserver(database)),
    );
    codeExplanation = new CodeExplanationService(
      analysis,
      privacy,
      new AskService(ai, analysis, decisions, privacy, new LocalInvestigationObserver(database)),
    );
    conceptSearch = new ConceptSearchService(
      analysis,
      privacy,
      new AskService(ai, analysis, decisions, privacy, new LocalInvestigationObserver(database)),
    );
    readme = new ReadmeService(
      database,
      analysis,
      new AskService(ai, analysis, decisions, privacy, new LocalInvestigationObserver(database)),
    );
    registerIpc();
    await createWindow();
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) void createWindow().catch(fatalError);
    });
  })
  .catch(fatalError);

function fatalError(error: unknown): void {
  dialog.showErrorBox(
    'Follo could not start',
    error instanceof Error ? error.message : 'Unknown startup error.',
  );
  app.quit();
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('will-quit', () => {
  ask?.cancel();
  repositorySummary?.cancel();
  codeExplanation?.cancel();
  conceptSearch?.cancel();
  readme?.cancel();
  analysis?.dispose();
  database?.close();
});
