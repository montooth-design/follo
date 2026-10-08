import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalDatabase } from '@follo/database';
import { parseRepository } from '@follo/parser';
import { EngineeringGraph } from '@follo/graph';
import { AnalysisService } from '../application/analysis-service';
import { ReadmeService, validateReadme } from '../application/readme-service';
import { AiService } from '../../ai/configuration/ai-service';
import { AskService } from '../../ai/investigation/ask-service';
import { CredentialVault } from '../../ai/configuration/credential-vault';
import { PrivacyService } from '../application/source-permissions';
import { DecisionService } from '../../ai/decisions/decision-service';
import { LocalInvestigationObserver } from '../../ai/investigation/observability';

test('README uses explicitly reviewed redacted setup evidence, leaves live env/source private and saves without overwriting', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'follo-readme-'));
  const db = new LocalDatabase(path.join(root, 'db.sqlite'));

  try {
    writeFileSync(path.join(root, 'app.ts'), 'export const privateSourceToken = "source-private";');
    const existingReadme =
      '# Existing README\n\n' + 'Existing project documentation.\n'.repeat(150);
    writeFileSync(path.join(root, 'README.md'), existingReadme);
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', scripts: { dev: 'vite', test: 'node --test' } }),
    );
    writeFileSync(path.join(root, '.env'), 'KEY=live-env-private');
    writeFileSync(
      path.join(root, '.env.example'),
      'DATABASE_URL=example-private-value\nAPI_KEY=custom-private-value',
    );
    writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfile-secret-contents');
    writeFileSync(path.join(root, '.node-version'), 'a'.repeat(13000));
    const repositoryId = randomUUID();
    db.rememberRepository({
      id: repositoryId,
      name: 'fixture',
      path: root,
      lastOpenedAt: new Date().toISOString(),
    });
    const parsed = await parseRepository(root);
    const saved = db.saveAnalysis(
      repositoryId,
      { ...parsed, graph: new EngineeringGraph(parsed.files).snapshot() },
      {
        status: 'not-repository',
        root: null,
        branch: null,
        commit: null,
        detached: false,
        workingTree: 'unknown',
      },
    );
    let calls = 0;

    const transport: typeof fetch = async (_url, options) => {
      calls++;
      const body = String(options?.body);
      for (const secret of [
        'privateSourceToken',
        'live-env-private',
        'example-private-value',
        'custom-private-value',
        'lockfile-secret-contents',
      ])
        assert.ok(!body.includes(secret));

      if (calls === 2) {
        assert.ok(body.includes('pnpm-lock.yaml'));
        assert.ok(body.includes('vite'));
        assert.ok(body.includes('Existing README'));
      }

      const event =
        calls === 1
          ? {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'ping',
                        type: 'function',
                        function: { name: 'follo_ping', arguments: '{}' },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            }
          : {
              choices: [
                {
                  delta: {
                    content:
                      '# Fixture\n\n## Local development\n\nRun `npm run dev` (found in package.json).\n\n## Review needed\nConfirm runtime requirements.',
                  },
                  finish_reason: 'stop',
                },
              ],
            };

      return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
    };

    const vault = new CredentialVault(path.join(root, 'vault'), {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    });
    const ai = new AiService(db, vault, transport);
    const analysis = new AnalysisService(db);
    const privacy = new PrivacyService(db, analysis);
    const service = new ReadmeService(
      db,
      analysis,
      new AskService(
        ai,
        analysis,
        new DecisionService(db, analysis),
        privacy,
        new LocalInvestigationObserver(db),
      ),
    );
    assert.throws(() => service.start(repositoryId, saved.analysisId, 'missing'), /Review/);
    const evidence = await service.collect(repositoryId, saved.analysisId);
    assert.ok(
      !evidence.files.some((file) => file.path === '.env' || file.path === '.node-version'),
    );
    assert.match(
      evidence.files.find((file) => file.path === '.env.example')!.content,
      /DATABASE_URL=<YOUR_VALUE>/,
    );
    assert.ok(evidence.limitations.some((text) => text.includes('size limit')));
    assert.throws(
      () => service.start(repositoryId, saved.analysisId, evidence.id),
      /not configured/,
    );
    ai.configure({ endpoint: 'https://fixture.example/v1', model: 'fixture-model', apiKey: '' });
    await ai.test();
    const id = service.start(repositoryId, saved.analysisId, evidence.id);
    for (let i = 0; i < 200 && service.get(id).status === 'running'; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    const state = service.get(id);
    assert.equal(state.status, 'complete', state.error ?? undefined);
    assert.match(state.answer, /not executed or tested/);
    const filename = await service.save(repositoryId, saved.analysisId, state.answer);
    assert.equal(readFileSync(path.join(root, 'README.md'), 'utf8'), existingReadme);
    assert.equal(readFileSync(filename, 'utf8'), state.answer);
    await assert.rejects(service.save(repositoryId, saved.analysisId, 'replacement'), /EEXIST/);
    const cancellation = service.start(repositoryId, saved.analysisId, evidence.id);
    service.cancel(cancellation);
    for (let i = 0; i < 200 && service.get(cancellation).status === 'running'; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(service.get(cancellation).status, 'cancelled');
    await assert.rejects(service.collect(randomUUID(), saved.analysisId));
    assert.throws(() => validateReadme('sk-' + 'a'.repeat(40)), /secret/);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('README setup collection refuses symbolic links', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'follo-readme-links-'));
  const external = mkdtempSync(path.join(tmpdir(), 'follo-readme-external-'));
  const db = new LocalDatabase(path.join(root, 'db.sqlite'));

  try {
    writeFileSync(path.join(external, 'README.md'), 'outside-private');
    symlinkSync(external, path.join(root, '.github'), 'junction');
    writeFileSync(path.join(root, 'app.ts'), 'export const x=1;');
    const repositoryId = randomUUID();
    db.rememberRepository({
      id: repositoryId,
      name: 'fixture',
      path: root,
      lastOpenedAt: new Date().toISOString(),
    });
    const parsed = await parseRepository(root);
    const saved = db.saveAnalysis(
      repositoryId,
      { ...parsed, graph: new EngineeringGraph(parsed.files).snapshot() },
      {
        status: 'not-repository',
        root: null,
        branch: null,
        commit: null,
        detached: false,
        workingTree: 'unknown',
      },
    );
    const service = new ReadmeService(db, new AnalysisService(db), {} as AskService);
    assert.ok(
      !(await service.collect(repositoryId, saved.analysisId)).files.some((file) =>
        file.path.startsWith('.github'),
      ),
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
