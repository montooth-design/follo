import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets, CompatibleLlmProvider } from '@follo/llm';
import { SourceBudget } from '../../repositories/application/source-permissions';

test('outbound redaction masks recognized tokens, credential assignments and entire private keys without changing line numbers', () => {
  const key = 'sk-' + 'a'.repeat(40);
  const github = 'ghp_' + 'b'.repeat(40);
  const password = ['sensitive', 'passwordvalue'].join('');
  const privateKey = [
    ['-----BEGIN', 'PRIVATE KEY-----'].join(' '),
    'secret-key-material',
    ['-----END', 'PRIVATE KEY-----'].join(' '),
  ].join('\n');
  const source = `const apiKey = "${key}";\nconst password = '${password}';\n${privateKey}\n// ${github}\nexport const run = () => true;`;
  const safe = redactSecrets(source);
  for (const secret of [key, github, password, 'secret-key-material'])
    assert.ok(!safe.includes(secret));
  assert.equal(safe.split('\n').length, source.split('\n').length);
  assert.ok(safe.includes('export const run = () => true;'));
  const budget = new SourceBudget({ level: 'full-file', selectedFileIds: [] }, () => source);
  assert.equal(budget.get('file', 4, 4, false).content, '*'.repeat('secret-key-material'.length));
  assert.equal(budget.get('file', 1, 1, true).content, safe);
  assert.equal(
    redactSecrets('const apiKey = process.env.API_KEY;'),
    'const apiKey = process.env.API_KEY;',
  );
});

test('provider message redaction protects pasted keys while authentication stays exclusively in the transport header', async () => {
  const authKey = 'sk-' + 'c'.repeat(40);
  const pastedKey = 'sk-' + 'd'.repeat(40);
  const provider = new CompatibleLlmProvider(
    'https://fixture.example/v1',
    authKey,
    async (_url, options) => {
      assert.equal((options!.headers as Record<string, string>).Authorization, `Bearer ${authKey}`);
      const body = String(options!.body);
      assert.ok(!body.includes(authKey));
      assert.ok(!body.includes(pastedKey));
      assert.equal(options!.redirect, 'error');

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Safe answer' }, finish_reason: 'stop' }],
        }),
      );
    },
  );
  await provider.respond({
    model: 'fixture',
    messages: [{ role: 'user', content: `Explain this token ${pastedKey}` }],
    tools: [],
    signal: new AbortController().signal,
  });
});
