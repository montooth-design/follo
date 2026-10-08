// Launches the real main/preload/renderer with isolated test storage.
const { app, dialog, safeStorage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve('dist/smoke');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, `user-data-${Date.now()}`));
fs.mkdirSync(app.getPath('userData'), { recursive: true });
const fixture = path.join(output, 'repository-fixture');
fs.mkdirSync(fixture, { recursive: true });

for (const name of ['auth.ts', 'schema.ts', 'payments.ts', 'README.follo.md']) {
  const file = path.join(fixture, name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

fs.writeFileSync(
  path.join(fixture, 'entry.ts'),
  "export { view } from './view.jsx';\nimport './missing';\nimport 'node:fs';\n",
);
fs.writeFileSync(path.join(fixture, 'view.jsx'), 'export const view = null;');
fs.writeFileSync(path.join(fixture, 'package.json'), '{}');
let cancelPicker = true;

// Only the test replaces the native dialog response; production always uses the OS picker.
dialog.showOpenDialog = async (parent, options) => {
  assert.ok(parent);
  assert.deepEqual(options.properties, ['openDirectory']);

  return { canceled: cancelPicker, filePaths: cancelPicker ? [] : [fixture] };
};

const timeout = setTimeout(() => {
  console.error('Desktop smoke test timed out');
  app.exit(1);
}, 30000);

async function waitForEdges(window, count) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await window.webContents.executeJavaScript(
        `document.querySelectorAll('.react-flow__edge').length === ${count}`,
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.fail(`Expected ${count} rendered map edges after layout settled`);
}

app.on('browser-window-created', (...args) => {
  const window = args[1];
  window.webContents.setBackgroundThrottling(false);
  window.once('ready-to-show', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        const bridge = window.engineering;
        const status = await bridge.getStatus();
        const original = await bridge.getSettings();
        const saved = await bridge.updateSettings({ theme: 'light' });
        const reloaded = await bridge.getSettings();
        await bridge.updateSettings(original);
        const cancelled = await bridge.openRepository();
        let rejectedPath = false;
        try { await bridge.reopenRepository('C:/not-authorized'); } catch { rejectedPath = true; }
        return { status, saved, reloaded, cancelled, rejectedPath, keys: Object.keys(bridge).sort(),
          requireType: typeof require, processType: typeof process,
          title: document.querySelector('h1')?.textContent };
      })()`);
      assert.equal(result.status.storage, 'ready');
      assert.equal(result.status.phase, 17);
      assert.equal(result.status.version, '0.21.0');
      assert.ok(
        safeStorage.isEncryptionAvailable(),
        'Windows credential protection should be available',
      );
      const encryptedFixture = safeStorage.encryptString('fixture-credential');
      assert.equal(safeStorage.decryptString(encryptedFixture), 'fixture-credential');
      assert.ok(!encryptedFixture.includes(Buffer.from('fixture-credential')));
      assert.deepEqual(result.keys, [
        'analyzeRepository',
        'ask',
        'cancelAsk',
        'cancelCodeExplanation',
        'cancelConceptSearch',
        'cancelReadme',
        'cancelRepositorySummary',
        'configureDecision',
        'configureLlm',
        'configureOpenRouter',
        'evaluateChangeRisk',
        'explainCode',
        'exportReadme',
        'generateReadme',
        'generateRepositorySummary',
        'getAiStatus',
        'getAnalysisState',
        'getAskState',
        'getCodeExplanationState',
        'getConceptSearchState',
        'getDecisionDefinitions',
        'getDecisionResults',
        'getFileSource',
        'getGraph',
        'getOpenRouterModels',
        'getParsedFile',
        'getPrivacy',
        'getReadmeEvidence',
        'getReadmeState',
        'getRecentRepositories',
        'getRepositorySummary',
        'getRepositorySummaryState',
        'getSettings',
        'getStatus',
        'inspectFile',
        'openRepository',
        'reopenRepository',
        'saveReadmeDraft',
        'searchCode',
        'searchConcept',
        'setPrivacy',
        'testDecisionConnection',
        'testLlmConnection',
        'updateSettings',
      ]);
      assert.equal(result.cancelled, null);
      assert.equal(result.rejectedPath, true);
      assert.equal(result.requireType, 'undefined');
      assert.equal(result.processType, 'undefined');
      assert.equal(result.saved.theme, 'light');
      assert.equal(result.reloaded.theme, 'light');
      assert.equal(result.title, 'Repositories');
      assert.ok(
        await window.webContents.executeJavaScript(
          `document.querySelector('.hero h2').textContent === 'follo your code.' && !document.querySelector('main > h1')`,
        ),
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `!document.querySelector('nav [aria-label="Insights"]') && !document.querySelector('main > .eyebrow') && !document.querySelector('main > .subtitle')`,
        ),
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `(() => { const main = document.querySelector('main').getBoundingClientRect(); const card = document.querySelector('.hero').getBoundingClientRect(); return Math.abs((main.top + main.bottom - card.top - card.bottom) / 2) < 10; })()`,
        ),
        'Overview card should be vertically centered',
      );
      const prefs = window.webContents.getLastWebPreferences();
      assert.equal(prefs.sandbox, true);
      assert.equal(prefs.contextIsolation, true);
      assert.equal(prefs.nodeIntegration, false);
      assert.ok(
        await window.webContents.executeJavaScript(
          `!document.querySelector('.brand-mark') && !document.querySelector('.cards')`,
        ),
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('[aria-label="Collapse Menu"]').click()`,
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `document.querySelector('.sidebar').classList.contains('collapsed') && getComputedStyle(document.querySelector('.nav-label')).display === 'none'`,
        ),
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `document.querySelector('nav [aria-label="Repositories"]').title === 'Repositories'`,
        ),
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelector('.brand-logo').getAttribute('viewBox')`,
        ),
        '0 9 14 27',
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      fs.writeFileSync(
        path.join(output, 'sidebar-collapsed.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('[aria-label="Expand Menu"]').click()`,
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `!document.querySelector('.sidebar').classList.contains('collapsed')`,
        ),
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelector('.brand-logo').getAttribute('viewBox')`,
        ),
        '0 9 64 27',
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      fs.writeFileSync(
        path.join(output, 'overview.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      cancelPicker = false;
      await window.webContents.executeJavaScript(
        `document.querySelector('nav [aria-label="Repositories"]').click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.ok(
        await window.webContents.executeJavaScript(
          `Boolean(document.querySelector('.repository-picker')) && !document.querySelector('.repository-header-choose')`,
        ),
      );
      await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Open New Repository')).click()`,
      );
      let displayed = false;

      for (let attempt = 0; attempt < 100; attempt++) {
        displayed = await window.webContents.executeJavaScript(
          `Boolean(document.querySelector('.repository-details'))`,
        );
        if (displayed) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      assert.ok(displayed, 'Selected repository metadata should appear after choosing a folder');
      const repoResult = await window.webContents.executeJavaScript(`(async () => {
        const recent = await window.engineering.getRecentRepositories();
        const fixture = recent.find(item => item.name === 'repository-fixture');
        const refreshed = await window.engineering.reopenRepository(fixture.id);
        return { refreshed, hasRecentRow: Boolean(document.querySelector('.recent-repository')),
          analysisDisabled: Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Analyze Repository').disabled };
      })()`);
      assert.equal(repoResult.refreshed.project.sourceFiles, 2);
      assert.equal(repoResult.refreshed.project.packageJson, true);
      assert.equal(repoResult.hasRecentRow, true);
      assert.equal(repoResult.analysisDisabled, false);
      assert.ok(
        await window.webContents.executeJavaScript(
          `!document.querySelector('.repository-picker') && Boolean(document.querySelector('.page-heading .repository-header-choose'))`,
        ),
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `(() => { const title = document.querySelector('.page-heading h1').getBoundingClientRect(); const button = document.querySelector('.repository-header-choose').getBoundingClientRect(); return button.left > title.right && Math.abs((title.top + title.bottom) / 2 - (button.top + button.bottom) / 2) < 2; })()`,
        ),
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `document.querySelector('.page-heading h1').textContent === 'repository-fixture' && !document.querySelector('.repository-details').textContent.includes('Git root:') && document.querySelector('.repository-submenu [aria-label="Open repository-fixture"]')`,
        ),
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('.repository-submenu [aria-label="Open repository-fixture"]').click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      fs.writeFileSync(
        path.join(output, 'repository.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('.repository-details').scrollIntoView()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      fs.writeFileSync(
        path.join(output, 'repository-details.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('nav button')).find(button => button.textContent.includes('Settings')).click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      await window.webContents.executeJavaScript(
        `document.querySelector('nav [aria-label="Repositories"]').click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        await window.webContents.executeJavaScript(
          `Boolean(document.querySelector('.repository-details')?.getBoundingClientRect().height)`,
        ),
        true,
      );
      const previousAnalysisId = await window.webContents.executeJavaScript(`(async () => {
        const repo = (await window.engineering.getRecentRepositories()).find(item => item.name === 'repository-fixture');
        return (await window.engineering.getAnalysisState(repo.id)).result?.provenance?.analysisId;
      })()`);
      await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Analyze Repository').click()`,
      );
      let coverageDisplayed = false;

      for (let attempt = 0; attempt < 100; attempt++) {
        coverageDisplayed = await window.webContents.executeJavaScript(`(async () => {
          const repo = (await window.engineering.getRecentRepositories()).find(item => item.name === 'repository-fixture');
          const state = await window.engineering.getAnalysisState(repo.id);
          return state.status === 'complete' && state.result?.provenance?.analysisId !== ${JSON.stringify(previousAnalysisId)} &&
            Boolean(document.querySelector('.coverage-grid')) && !Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Analyzing…');
        })()`);
        if (coverageDisplayed) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      assert.ok(coverageDisplayed, 'Parser coverage should be displayed');
      assert.ok(
        await window.webContents.executeJavaScript(
          `document.querySelector('.analysis-completed').textContent === 'Completed' && document.querySelectorAll('.parser-panel > .repository-card').length >= 5 && !document.querySelector('.parser-panel').textContent.includes('Saved analysis') && !document.querySelector('.parser-panel').textContent.includes('Snapshot exclusions:')`,
        ),
      );
      const parserResult = await window.webContents.executeJavaScript(`(async () => {
        const repo = (await window.engineering.getRecentRepositories()).find(item => item.name === 'repository-fixture');
        return await window.engineering.getAnalysisState(repo.id);
      })()`);
      assert.equal(parserResult.status, 'complete');
      assert.equal(parserResult.result.coverage.filesParsed, 2);
      assert.equal(parserResult.result.coverage.internalResolved, 1);
      assert.equal(parserResult.result.coverage.unresolved, 1);
      assert.equal(parserResult.result.coverage.external, 1);
      assert.equal(parserResult.result.graph.nodeCount, 2);
      assert.equal(parserResult.result.graph.edgeCount, 1);
      assert.equal(parserResult.result.graph.gapCount, 2);
      assert.equal(parserResult.result.graph.cycleGroupCount, 0);
      assert.ok(
        await window.webContents.executeJavaScript(
          `document.querySelector('.parser-panel').textContent.includes('Unique dependency edges')`,
        ),
      );
      await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('.parser-files button')).find(button => button.textContent.includes('entry.ts')).click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.ok(
        await window.webContents.executeJavaScript(
          `document.querySelector('.parsed-file')?.textContent.includes('unresolved')`,
        ),
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `document.querySelector('[aria-label="Tech stack"]')?.textContent.includes('node:fs')`,
        ),
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('[aria-label="Tech stack"]').scrollIntoView()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.writeFileSync(
        path.join(output, 'tech-stack.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('.coverage-grid').scrollIntoView()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.writeFileSync(
        path.join(output, 'parser-coverage.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(
        `document.querySelectorAll('.coverage-grid')[1].scrollIntoView()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.writeFileSync(
        path.join(output, 'graph-summary.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('.parsed-file').scrollIntoView()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.writeFileSync(
        path.join(output, 'parser-imports.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('nav button')).find(button => button.textContent.includes('Code Maps')).click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      await window.webContents.executeJavaScript(
        `document.querySelector('.code-map')?.scrollIntoView()`,
      );
      let mapDisplayed = false;

      for (let attempt = 0; attempt < 100; attempt++) {
        mapDisplayed = await window.webContents.executeJavaScript(
          `document.querySelectorAll('.react-flow__node').length === 2 && document.querySelectorAll('.react-flow__edge').length === 1`,
        );
        if (mapDisplayed) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      assert.ok(mapDisplayed, 'Saved graph should render both real file nodes');
      await waitForEdges(window, 1);
      assert.ok(
        await window.webContents.executeJavaScript(
          `!document.querySelector('[aria-label="Code Maps"]').textContent.includes('Select a file to reveal') && !document.querySelector('[aria-label="Code Maps"]').textContent.includes('Arrows point to dependencies')`,
        ),
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `!document.querySelector('.react-flow__minimap') && document.querySelector('.map-reload').textContent === '' && document.querySelector('.map-reload .lucide') && document.querySelector('.map-controls [aria-label="Zoom In"] .lucide')`,
        ),
      );
      fs.writeFileSync(
        path.join(output, 'code-map.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('.react-flow__node').click()`,
      );
      let inspectorDisplayed = false;

      for (let attempt = 0; attempt < 100; attempt++) {
        inspectorDisplayed = await window.webContents.executeJavaScript(
          `Boolean(document.querySelector('.inspector')?.textContent.includes('Fan-in / direct dependents'))`,
        );
        if (inspectorDisplayed) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assert.ok(
        inspectorDisplayed,
        'Selected file should expose verified metrics and relationships',
      );

      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          await window.webContents.executeJavaScript(
            `Boolean(document.querySelector('.source-viewer .cm-content'))`,
          )
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assert.ok(
        await window.webContents.executeJavaScript(
          `document.querySelector('.source-viewer .cm-content').getAttribute('aria-readonly') === 'true' && document.querySelector('.source-viewer .cm-gutters') && document.querySelector('.code-explanation-panel .primary').disabled`,
        ),
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `Boolean(document.querySelector('style[nonce]')?.sheet?.cssRules.length)`,
        ),
        'CodeMirror styles should work under the production CSP',
      );
      const originalCode = await window.webContents.executeJavaScript(
        `document.querySelector('.source-viewer .cm-content').textContent`,
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('.source-viewer .cm-content').focus()`,
      );
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.ok(
        await window.webContents.executeJavaScript(
          `document.querySelector('.code-selection-status').textContent.includes('Selected lines')`,
        ),
      );
      window.webContents.sendInputEvent({ type: 'char', keyCode: 'z' });
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelector('.source-viewer .cm-content').textContent`,
        ),
        originalCode,
        'The viewer must not edit source',
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('[aria-label="Clear Code Selection"]').click()`,
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `!document.querySelector('.code-selection-status').textContent.includes('Selected lines')`,
        ),
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('.code-explorer').scrollIntoView()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.writeFileSync(
        path.join(output, 'code-viewer.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `Boolean(document.querySelector('.map-inspector-panel .inspector'))`,
        ),
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `document.querySelectorAll('.map-selected').length === 1 && document.querySelectorAll('.map-connected').length === 1`,
        ),
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `document.querySelectorAll('.map-highlighted-edge').length === 1`,
        ),
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `(() => { const map = document.querySelector('.code-map').getBoundingClientRect(); const panel = document.querySelector('.map-inspector-panel').getBoundingClientRect(); return panel.left >= map.right && Math.abs(panel.top - map.top) < 2; })()`,
        ),
      );
      await waitForEdges(window, 1);
      await window.webContents.executeJavaScript(
        `document.querySelector('.code-map').scrollIntoView()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.writeFileSync(
        path.join(output, 'focused-map.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      const drag = await window.webContents.executeJavaScript(
        `(() => { const node = document.querySelector('.map-selected'); const rect = node.getBoundingClientRect(); return { id: node.dataset.id, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), transform: node.style.transform }; })()`,
      );
      window.webContents.sendInputEvent({ type: 'mouseMove', x: drag.x, y: drag.y });
      window.webContents.sendInputEvent({
        type: 'mouseDown',
        x: drag.x,
        y: drag.y,
        button: 'left',
        clickCount: 1,
      });

      for (let step = 1; step <= 5; step++) {
        window.webContents.sendInputEvent({
          type: 'mouseMove',
          x: drag.x + step * 10,
          y: drag.y + step * 6,
          button: 'left',
        });
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      window.webContents.sendInputEvent({
        type: 'mouseUp',
        x: drag.x + 50,
        y: drag.y + 30,
        button: 'left',
        clickCount: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const moved = await window.webContents.executeJavaScript(
        `document.querySelector('.map-selected').style.transform`,
      );
      assert.notEqual(moved, drag.transform, 'Dragging should update the controlled node position');
      await window.webContents.executeJavaScript(
        `(() => { const select = document.querySelector('[aria-label="Map connections"]'); select.value = 'focused'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      await waitForEdges(window, 1);
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelector('.map-selected').style.transform`,
        ),
        moved,
        'Manual node position should survive view changes',
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('[aria-label="Close File Inspector"]').click()`,
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `!document.querySelector('.map-inspector-panel')`,
        ),
      );
      await waitForEdges(window, 1);
      await window.webContents.executeJavaScript(
        `document.querySelector('.react-flow__node').click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      await window.webContents.executeJavaScript(
        `document.querySelector('.inspector').scrollIntoView()`,
      );
      fs.writeFileSync(
        path.join(output, 'inspector.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('nav [aria-label="Search"]').click()`,
      );

      for (let attempt = 0; attempt < 100; attempt++) {
        const ready = await window.webContents.executeJavaScript(
          `!document.querySelector('[aria-label="Code search"] button.primary')?.disabled`,
        );
        // Search enables after a nonempty query; invoke React's input change through its native setter.
        await window.webContents
          .executeJavaScript(`(() => { const input = document.querySelector('[aria-label="Search keywords"]');
          if (input && !input.value) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'view'); input.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      await window.webContents.executeJavaScript(
        `document.querySelector('[aria-label="Code search"] button.primary').click()`,
      );
      let searchDisplayed = false;

      for (let attempt = 0; attempt < 100; attempt++) {
        searchDisplayed = await window.webContents.executeJavaScript(
          `document.querySelectorAll('.search-result').length === 2`,
        );
        if (searchDisplayed) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assert.ok(searchDisplayed, 'Search should find saved source and matching file paths');
      fs.writeFileSync(
        path.join(output, 'search.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('nav button')).find(button => button.textContent.includes('Ask')).click()`,
      );
      let askDisplayed = false;

      for (let attempt = 0; attempt < 100; attempt++) {
        askDisplayed = await window.webContents.executeJavaScript(
          `Boolean(document.querySelector('[aria-label="Ask investigation"]')?.textContent.includes('Generative AI is unconfigured'))`,
        );
        if (askDisplayed) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assert.ok(
        askDisplayed,
        'Ask should explain its unconfigured state without inventing an answer',
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `document.querySelector('[aria-label="Ask investigation"] button.primary').disabled`,
        ),
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `document.querySelector('[aria-label="Ask investigation"]').textContent.includes('graph-only')`,
        ),
      );
      fs.writeFileSync(
        path.join(output, 'ask.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(
        `window.engineering.configureLlm({endpoint:'http://127.0.0.1:12345/v1',model:'fixture-saved-model',apiKey:''})`,
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('nav [aria-label="Settings"]').click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      await window.webContents.executeJavaScript(
        `document.querySelector('nav [aria-label="Ask"]').click()`,
      );
      let savedLlmDisplayed = false;

      for (let attempt = 0; attempt < 100; attempt++) {
        savedLlmDisplayed = await window.webContents.executeJavaScript(
          `document.querySelector('.ask-offline h2')?.textContent === 'LLM connection needs verification'`,
        );
        if (savedLlmDisplayed) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assert.ok(
        savedLlmDisplayed,
        'A saved LLM must be shown as needing verification, not unconfigured',
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `document.querySelector('.ask-offline').textContent.includes('fixture-saved-model') && document.querySelector('[aria-label="Ask investigation"] button.primary').disabled`,
        ),
      );
      await window.webContents.executeJavaScript(`window.engineering.configureLlm(null)`);
      await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('nav button')).find(button => button.textContent.includes('Settings')).click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.ok(
        await window.webContents.executeJavaScript(
          `!document.querySelector('.settings-panel [aria-label="Source Permissions settings"]')`,
        ),
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelector('.verification-badge.overall').textContent`,
        ),
        '0 of 2 connections verified',
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelectorAll('.settings-panel .verification-badge.verified').length`,
        ),
        0,
      );
      assert.deepEqual(
        await window.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('.settings-panel > .settings-card h2')).map(node => node.textContent)`,
        ),
        ['Theme', 'AI'],
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `getComputedStyle(document.querySelector('.theme-options')).justifyContent === 'center'`,
        ),
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `!!document.querySelector('[aria-label="Decision endpoint"]') && !!document.querySelector('[aria-label="Decision credential"]')`,
        ),
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('.connection-mode label:last-child input').click()`,
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `!!document.querySelector('[aria-label="OpenRouter credential"]') && !!document.querySelector('[aria-label="OpenRouter LLM model"]') && !!document.querySelector('[aria-label="OpenRouter Decision model"]')`,
        ),
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('.ai-connections').scrollIntoView()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      fs.writeFileSync(
        path.join(output, 'openrouter-settings.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(
        `document.querySelectorAll('.connection-mode input')[0].click()`,
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `(() => { const main = document.querySelector('main'); const panel = document.querySelector('.settings-panel'); const style = getComputedStyle(main); return Math.abs(panel.getBoundingClientRect().width - (main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))) < 2; })()`,
        ),
        'Settings should use the full content width',
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('.theme-card').scrollIntoView()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      fs.writeFileSync(
        path.join(output, 'settings.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelector('[aria-label="AI credential"]').value`,
        ),
        '',
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('nav [aria-label="Repositories"]').click()`,
      );

      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          await window.webContents.executeJavaScript(
            `document.querySelector('[aria-label="Source permission"]') && !document.querySelector('[aria-label="Source permission"]').disabled`,
          )
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assert.ok(
        await window.webContents.executeJavaScript(
          `document.querySelector('[aria-label="Selected repository"] .ai-settings') && document.querySelectorAll('.ai-settings select').length === 1 && document.querySelector('[aria-label="Source permission"]').value === 'graph-only'`,
        ),
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('.ai-settings').scrollIntoView()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      fs.writeFileSync(
        path.join(output, 'privacy.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(
        `(() => { const select=document.querySelector('[aria-label="Source permission"]');select.value='full-file';select.dispatchEvent(new Event('change',{bubbles:true})); })()`,
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('.ai-settings button.primary').click()`,
      );

      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          await window.webContents.executeJavaScript(
            `Boolean(document.querySelector('.ai-settings .verification-badge'))`,
          )
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assert.ok(
        await window.webContents.executeJavaScript(
          `Boolean(document.querySelector('.ai-settings .verification-badge'))`,
        ),
      );
      fs.writeFileSync(path.join(fixture, 'auth.ts'), 'export const login = () => true;');
      fs.writeFileSync(path.join(fixture, 'schema.ts'), 'export const UserSchema = {};');
      fs.writeFileSync(
        path.join(fixture, 'payments.ts'),
        "import Stripe from 'stripe'; export const payments = Stripe;",
      );
      fs.writeFileSync(
        path.join(fixture, 'package.json'),
        JSON.stringify({ dependencies: { stripe: '^1', zod: '^1' } }),
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('nav [aria-label="Repositories"]').click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Analyze Repository').click()`,
      );
      let highlightsDisplayed = false;

      for (let attempt = 0; attempt < 100; attempt++) {
        highlightsDisplayed = await window.webContents.executeJavaScript(
          `document.querySelectorAll('.highlight-card').length >= 3 && Array.from(document.querySelectorAll('.highlight-files button')).some(button => button.textContent === 'auth.ts')`,
        );
        if (highlightsDisplayed) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      assert.ok(
        await window.webContents.executeJavaScript(
          `Boolean(document.querySelector('[aria-label="Repository Summary"]')) && document.querySelector('[aria-label="Repository Summary"] button.primary').disabled`,
        ),
      );
      assert.ok(
        highlightsDisplayed,
        'Scanned authentication, schema and payments should appear as highlight cards',
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('.repository-highlights').scrollIntoView()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      fs.writeFileSync(
        path.join(output, 'repository-highlights.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
      await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('.highlight-files button')).find(button => button.textContent === 'auth.ts').click()`,
      );
      let highlightInspected = false;

      for (let attempt = 0; attempt < 100; attempt++) {
        highlightInspected = await window.webContents.executeJavaScript(
          `document.querySelector('.parsed-file h3')?.textContent === 'auth.ts'`,
        );
        if (highlightInspected) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assert.ok(highlightInspected, 'A highlight file should open its saved source inspection');
      assert.ok(
        await window.webContents.executeJavaScript(
          `!document.querySelector('.highlight-signal') && document.querySelector('[aria-label="Source permission"]').value === 'full-file'`,
        ),
        'Repository permissions should survive reanalysis and signal badges should be removed',
      );
      await window.webContents.executeJavaScript(
        `(() => { const select=document.querySelector('[aria-label="Source permission"]');select.value='graph-only';select.dispatchEvent(new Event('change',{bubbles:true})); })()`,
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('.ai-settings button.primary').click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));

      const summaryFile = await window.webContents.executeJavaScript(
        `(async () => { const repo = (await window.engineering.getRecentRepositories())[0]; const state = await window.engineering.getAnalysisState(repo.id); return state.result.files.find(file => file.path === 'auth.ts'); })()`,
      );
      let summaryRequests = 0;
      let codeMode = false;
      let codeRequests = 0;
      let conceptMode = false;
      let readmeMode = false;
      const mockSummaryServer = require('node:http').createServer((request, response) => {
        request.resume();
        request.on('end', () => {
          if (readmeMode) {
            const event = {
              choices: [
                {
                  delta: { content: '# Fixture README\n\n## Review needed\nConfirm setup.' },
                  finish_reason: 'stop',
                },
              ],
            };
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.end('data: ' + JSON.stringify(event) + '\n\ndata: [DONE]\n\n');

            return;
          }

          if (conceptMode) {
            const event = {
              choices: [
                {
                  delta: {
                    content: JSON.stringify({
                      results: [
                        {
                          fileId: summaryFile.id,
                          reason: 'The authentication filename suggests user sign-in handling.',
                        },
                      ],
                      limitations: ['Metadata-only matches.'],
                    }),
                  },
                  finish_reason: 'stop',
                },
              ],
            };
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.end('data: ' + JSON.stringify(event) + '\n\ndata: [DONE]\n\n');

            return;
          }

          if (codeMode) {
            codeRequests++;
            const event = {
              choices: [
                {
                  delta: {
                    content:
                      'This exports the login entry point. [file:' +
                      summaryFile.id +
                      '] [lines:1-1]',
                  },
                  finish_reason: 'stop',
                },
              ],
            };
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.end('data: ' + JSON.stringify(event) + '\n\ndata: [DONE]\n\n');

            return;
          }

          summaryRequests++;
          const fact = {
            text: 'A Next.js fixture with a login entry point [file:' + summaryFile.id + ']',
            fileIds: [summaryFile.id],
            inferred: true,
          };
          const text = JSON.stringify({
            purpose: fact,
            features: [fact],
            workflow: fact,
            limitations: ['Metadata-only fixture summary.'],
          });
          const names = ['follo_ping', 'get_repository_summary', 'get_file'];
          const args = [
            '{}',
            '{"offset":0}',
            JSON.stringify({ fileId: summaryFile.id, source: 'none', startLine: 1, endLine: 1 }),
          ];
          const event =
            summaryRequests <= 3
              ? {
                  choices: [
                    {
                      delta: {
                        tool_calls: [
                          {
                            index: 0,
                            id: 'summary-call-' + summaryRequests,
                            type: 'function',
                            function: {
                              name: names[summaryRequests - 1],
                              arguments: args[summaryRequests - 1],
                            },
                          },
                        ],
                      },
                      finish_reason: 'tool_calls',
                    },
                  ],
                }
              : { choices: [{ delta: { content: text }, finish_reason: 'stop' }] };
          response.writeHead(200, { 'Content-Type': 'text/event-stream' });
          response.end('data: ' + JSON.stringify(event) + '\n\ndata: [DONE]\n\n');
        });
      });
      await new Promise((resolve) => mockSummaryServer.listen(0, '127.0.0.1', resolve));

      try {
        const endpoint = 'http://127.0.0.1:' + mockSummaryServer.address().port + '/v1';
        await window.webContents.executeJavaScript(
          `window.engineering.configureLlm({endpoint:${JSON.stringify(endpoint)},model:'summary-fixture',apiKey:''})`,
        );
        await window.webContents.executeJavaScript(`window.engineering.testLlmConnection()`);
        await window.webContents.executeJavaScript(
          `document.querySelector('nav [aria-label="Settings"]').click()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        await window.webContents.executeJavaScript(
          `document.querySelector('nav [aria-label="Repositories"]').click()`,
        );

        for (let attempt = 0; attempt < 100; attempt++) {
          if (
            await window.webContents.executeJavaScript(
              `!document.querySelector('[aria-label="Repository Summary"] button.primary').disabled`,
            )
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        await window.webContents.executeJavaScript(
          `document.querySelector('[aria-label="Repository Summary"] button.primary').click()`,
        );
        let summaryDisplayed = false;

        for (let attempt = 0; attempt < 100; attempt++) {
          summaryDisplayed = await window.webContents.executeJavaScript(
            `!!document.querySelector('.summary-purpose') && !document.querySelector('[aria-label="Repository Summary"] [role=alert]')`,
          );
          if (summaryDisplayed) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        assert.ok(summaryDisplayed, 'A verified LLM should generate a saved repository summary');
        assert.equal(summaryRequests, 4);
        readmeMode = true;
        assert.ok(
          await window.webContents.executeJavaScript(
            `!document.querySelector('.readme-generate-panel') && document.querySelector('[aria-label="README draft"] button.secondary').textContent === 'Read Setup Files'`,
          ),
        );
        await window.webContents.executeJavaScript(
          `document.querySelector('[aria-label="README draft"] button.secondary').click()`,
        );
        let evidenceDisplayed = false;

        for (let attempt = 0; attempt < 100; attempt++) {
          evidenceDisplayed = await window.webContents.executeJavaScript(
            `!!document.querySelector('.readme-consent input')`,
          );
          if (evidenceDisplayed) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        assert.ok(evidenceDisplayed, 'README setup evidence should be available for review');
        assert.ok(
          await window.webContents.executeJavaScript(
            `document.querySelectorAll('.readme-file > summary svg').length >= 2`,
          ),
          'Each setup file should have a styled disclosure row',
        );
        await window.webContents.executeJavaScript(
          `document.querySelector('.readme-files').open = true; document.querySelector('.readme-file').open = true`,
        );
        assert.ok(
          await window.webContents.executeJavaScript(
            `!!document.querySelector('.readme-generate-panel .readme-consent') && !!document.querySelector('.readme-generate-panel button.primary')`,
          ),
        );
        assert.ok(
          await window.webContents.executeJavaScript(
            `document.querySelector('[aria-label="README draft"] button.primary').disabled`,
          ),
        );
        await window.webContents.executeJavaScript(
          `document.querySelector('.readme-consent input').click()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        await window.webContents.executeJavaScript(
          `document.querySelector('[aria-label="README draft"] button.primary').click()`,
        );
        let readmeDisplayed = false;

        for (let attempt = 0; attempt < 100; attempt++) {
          readmeDisplayed = await window.webContents.executeJavaScript(
            `document.querySelector('.readme-editor')?.value.includes('# Fixture README') && !document.querySelector('[aria-label="README draft"] [role=alert]')`,
          );
          if (readmeDisplayed) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        assert.ok(readmeDisplayed, 'README generation should render an editable Markdown draft');
        await window.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('[aria-label="README draft"] button')).find(button => button.textContent === 'Save README.follo.md').click()`,
        );
        let readmeSaved = false;

        for (let attempt = 0; attempt < 100; attempt++) {
          readmeSaved = await window.webContents.executeJavaScript(
            `document.querySelector('[aria-label="README draft"] [role=status]')?.textContent.startsWith('Saved ')`,
          );
          if (readmeSaved) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        assert.ok(readmeSaved, 'README save should cross the preload and main-process bridge');
        assert.match(
          fs.readFileSync(path.join(fixture, 'README.follo.md'), 'utf8'),
          /not executed or tested/,
        );
        const exportTarget = path.join(output, `readme-export-${Date.now()}.md`);
        const originalSaveDialog = dialog.showSaveDialog;

        dialog.showSaveDialog = async (parent, options) => {
          assert.equal(parent, window);
          assert.equal(options.defaultPath, 'README.follo.md');

          return { canceled: false, filePath: exportTarget };
        };

        try {
          const exported = await window.webContents.executeJavaScript(
            `window.engineering.exportReadme(document.querySelector('.readme-editor').value)`,
          );
          assert.equal(exported, exportTarget);
          assert.equal(
            fs.readFileSync(exportTarget, 'utf8'),
            fs.readFileSync(path.join(fixture, 'README.follo.md'), 'utf8'),
          );
          assert.ok(
            await window.webContents.executeJavaScript(
              `(async () => { try { await window.engineering.exportReadme('replacement'); return false; } catch { return true; } })()`,
            ),
            'Export must reject overwriting an existing file',
          );
          dialog.showSaveDialog = async () => ({ canceled: true });
          assert.equal(
            await window.webContents.executeJavaScript(
              `window.engineering.exportReadme('cancelled')`,
            ),
            null,
          );
        } finally {
          dialog.showSaveDialog = originalSaveDialog;
        }

        await window.webContents.executeJavaScript(
          `document.querySelector('[aria-label="README draft"]').scrollIntoView({behavior:'instant',block:'start'})`,
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        fs.writeFileSync(
          path.join(output, 'readme-draft.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
        readmeMode = false;
        await window.webContents.executeJavaScript(
          `document.querySelector('[aria-label="Repository Summary"]').scrollIntoView()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        fs.writeFileSync(
          path.join(output, 'repository-summary.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
        await window.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Analyze Repository').click()`,
        );
        let staleSummaryDisplayed = false;

        for (let attempt = 0; attempt < 100; attempt++) {
          staleSummaryDisplayed = await window.webContents.executeJavaScript(
            `document.querySelector('.summary-provenance')?.textContent.includes('Outdated')`,
          );
          if (staleSummaryDisplayed) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        assert.ok(staleSummaryDisplayed, 'Reanalysis should mark the saved summary outdated');
        assert.ok(
          await window.webContents.executeJavaScript(
            `Array.from(document.querySelectorAll('.summary-evidence button')).every(button => button.disabled)`,
          ),
        );
        conceptMode = true;
        await window.webContents.executeJavaScript(
          `document.querySelector('nav [aria-label="Search"]').click()`,
        );

        for (let attempt = 0; attempt < 100; attempt++) {
          if (
            await window.webContents.executeJavaScript(
              `Boolean(document.querySelector('[aria-label="Search mode"]'))`,
            )
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        await window.webContents.executeJavaScript(
          `(() => { const select = document.querySelector('[aria-label="Search mode"]'); select.value = 'concept'; select.dispatchEvent(new Event('change', {bubbles:true})); })()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        await window.webContents.executeJavaScript(
          `(() => { const input = document.querySelector('[aria-label="Search concept"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'where users sign in'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        await window.webContents.executeJavaScript(
          `document.querySelector('[aria-label="Code search"] button.primary').click()`,
        );
        let conceptDisplayed = false;

        for (let attempt = 0; attempt < 100; attempt++) {
          conceptDisplayed = await window.webContents.executeJavaScript(
            `document.querySelector('.search-result strong')?.textContent === 'auth.ts' && document.querySelector('[aria-label="Code search"]').textContent.includes('Metadata-based')`,
          );
          if (conceptDisplayed) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        assert.ok(
          conceptDisplayed,
          'Concept search should render ranked file matches and metadata limitations',
        );
        await window.webContents.executeJavaScript(
          `document.querySelector('.search-result').click()`,
        );

        for (let attempt = 0; attempt < 100; attempt++) {
          if (
            await window.webContents.executeJavaScript(
              `document.querySelector('.inspector h2')?.textContent === 'auth.ts'`,
            )
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        assert.ok(
          await window.webContents.executeJavaScript(
            `document.querySelector('.inspector h2')?.textContent === 'auth.ts'`,
          ),
        );
        fs.writeFileSync(
          path.join(output, 'concept-search.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
        conceptMode = false;
        codeMode = true;
        await window.webContents.executeJavaScript(
          `document.querySelector('nav [aria-label="Code Maps"]').click()`,
        );

        for (let attempt = 0; attempt < 100; attempt++) {
          if (
            await window.webContents.executeJavaScript(
              `document.querySelector('[aria-label="Inspect file"]')?.options.length > 1`,
            )
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        const selectCode = `(() => { const select = document.querySelector('[aria-label="Inspect file"]'); select.value = ${JSON.stringify(summaryFile.id)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`;
        await window.webContents.executeJavaScript(selectCode);

        for (let attempt = 0; attempt < 100; attempt++) {
          if (
            await window.webContents.executeJavaScript(
              `Boolean(document.querySelector('.source-viewer .cm-content'))`,
            )
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        assert.ok(
          await window.webContents.executeJavaScript(
            `document.querySelector('.code-explanation-panel .primary').disabled && document.querySelector('.code-explanation-panel').textContent.includes('Enable source access')`,
          ),
        );
        const deniedCode = await window.webContents.executeJavaScript(
          `(async () => { const repo = (await window.engineering.getRecentRepositories())[0]; const state = await window.engineering.getAnalysisState(repo.id); try { await window.engineering.explainCode(repo.id, state.result.provenance.analysisId, { fileId: ${JSON.stringify(summaryFile.id)}, startLine: 1, endLine: 1, question: '' }); return false; } catch { return true; } })()`,
        );
        assert.ok(deniedCode);
        assert.equal(codeRequests, 0);
        await window.webContents.executeJavaScript(
          `(async () => { const repo = (await window.engineering.getRecentRepositories())[0]; const state = await window.engineering.getAnalysisState(repo.id); await window.engineering.setPrivacy(repo.id, state.result.provenance.analysisId, { level: 'selected-source', selectedFileIds: [${JSON.stringify(summaryFile.id)}] }); })()`,
        );
        await window.webContents.executeJavaScript(
          `document.querySelector('[aria-label="Reload Snapshot"]').click()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        await window.webContents.executeJavaScript(selectCode);

        for (let attempt = 0; attempt < 100; attempt++) {
          if (
            await window.webContents.executeJavaScript(
              `document.querySelector('.code-explanation-panel .primary') && !document.querySelector('.code-explanation-panel .primary').disabled`,
            )
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        await window.webContents.executeJavaScript(
          `document.querySelector('.source-viewer .cm-content').focus()`,
        );
        window.webContents.sendInputEvent({
          type: 'keyDown',
          keyCode: 'A',
          modifiers: ['control'],
        });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.ok(
          await window.webContents.executeJavaScript(
            `document.querySelector('.code-explanation-panel .primary').textContent.includes('Explain Selection')`,
          ),
        );
        await window.webContents.executeJavaScript(
          `document.querySelector('.code-explanation-panel .primary').click()`,
        );

        for (let attempt = 0; attempt < 100; attempt++) {
          if (
            await window.webContents.executeJavaScript(
              `Boolean(document.querySelector('.code-answer .inline-file'))`,
            )
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        assert.equal(codeRequests, 1);
        assert.ok(
          await window.webContents.executeJavaScript(
            `document.querySelector('.code-answer').textContent.includes('login entry point')`,
          ),
        );
        await window.webContents.executeJavaScript(
          `document.querySelector('.code-answer .inline-file').click()`,
        );
        assert.ok(
          await window.webContents.executeJavaScript(
            `document.querySelector('.code-selection-status').textContent.includes('Selected lines 1–1')`,
          ),
        );
        await window.webContents.executeJavaScript(
          `document.querySelector('.code-explorer').scrollIntoView()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        fs.writeFileSync(
          path.join(output, 'code-explanation.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
        await window.webContents.executeJavaScript(
          `document.documentElement.dataset.theme = 'light'`,
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.ok(
          await window.webContents.executeJavaScript(
            `!document.querySelector('.source-viewer .cm-editor').classList.contains('cm-dark')`,
          ),
        );
        fs.writeFileSync(
          path.join(output, 'code-explanation-light.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
        await window.webContents.executeJavaScript(
          `document.documentElement.dataset.theme = 'dark'`,
        );
        await window.webContents.executeJavaScript(`window.engineering.configureLlm(null)`);
      } finally {
        await new Promise((resolve) => mockSummaryServer.close(resolve));
      }

      const secondFixture = path.join(output, 'another-repository');
      fs.mkdirSync(secondFixture, { recursive: true });
      fs.writeFileSync(path.join(secondFixture, 'entry.ts'), 'export const second = true;');
      const originalOpenDialog = dialog.showOpenDialog;

      dialog.showOpenDialog = async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));

        return { canceled: false, filePaths: [secondFixture] };
      };

      await window.webContents.executeJavaScript(
        `document.querySelector('nav [aria-label="Repositories"]').click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      await window.webContents.executeJavaScript(
        `document.querySelector('.repository-header-choose').click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(
        await window.webContents.executeJavaScript(
          `!!document.querySelector('.repository-loading') && document.querySelector('.repository-content').hidden`,
        ),
        'Repository contents should stay hidden during loading',
      );
      let secondLoaded = false;

      for (let attempt = 0; attempt < 100; attempt++) {
        secondLoaded = await window.webContents.executeJavaScript(
          `document.querySelector('.page-heading h1')?.textContent === 'another-repository' && !document.querySelector('.repository-content').hidden`,
        );
        if (secondLoaded) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      dialog.showOpenDialog = originalOpenDialog;
      assert.ok(secondLoaded, 'Repository contents should appear when saved analysis is ready');
      await window.webContents.executeJavaScript(
        `if (!document.querySelector('.repository-submenu')) document.querySelector('nav [aria-label="Repositories"]').click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      const menuBefore = await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('.repository-submenu button')).map(button => button.getAttribute('aria-label'))`,
      );
      await window.webContents.executeJavaScript(
        `document.querySelector('.repository-submenu [aria-label="Open repository-fixture"]').click()`,
      );
      let firstLoaded = false;

      for (let attempt = 0; attempt < 100; attempt++) {
        firstLoaded = await window.webContents.executeJavaScript(
          `document.querySelector('.page-heading h1')?.textContent === 'repository-fixture' && !document.querySelector('.repository-content').hidden && !document.querySelector('.repository-loading')`,
        );
        if (firstLoaded) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assert.ok(firstLoaded, 'Switching repositories should finish loading');
      assert.deepEqual(
        await window.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('.repository-submenu button')).map(button => button.getAttribute('aria-label'))`,
        ),
        menuBefore,
        'Selecting a repository must not reorder the menu',
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          `(() => { const row = document.querySelector('.analysis-next:has(.primary)'); const button = row.querySelector('.primary'); return Math.abs(row.getBoundingClientRect().right - button.getBoundingClientRect().right) < 2; })()`,
        ),
        'Primary analysis action should align to the right',
      );

      for (const name of ['auth.ts', 'schema.ts', 'payments.ts'])
        fs.unlinkSync(path.join(fixture, name));
      fs.writeFileSync(path.join(fixture, 'package.json'), '{}');
      console.log(
        'Desktop smoke passed: repository selection, worker analysis, parser coverage, classified imports, narrow IPC, SQLite, and renderer isolation. Native dialog responses were stubbed.',
      );
      clearTimeout(timeout);
      app.quit();
    } catch (error) {
      console.error(error);

      try {
        console.error(
          await window.webContents.executeJavaScript(
            `({nodes:document.querySelectorAll('.react-flow__node').length,edges:document.querySelectorAll('.react-flow__edge').length,errors:Array.from(document.querySelectorAll('[role=alert]')).map(node=>node.textContent),section:document.querySelector('header').textContent})`,
          ),
        );
        fs.writeFileSync(
          path.join(output, 'failure.png'),
          (await window.webContents.capturePage()).toPNG(),
        );
      } catch {
        /* Preserve the original smoke failure if diagnostics are unavailable. */
      }

      clearTimeout(timeout);
      app.exit(1);
    }
  });
});
require('../apps/desktop/dist/main.cjs');
