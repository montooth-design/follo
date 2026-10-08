import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DecisionEngine,
  canonicalJson,
  validateAnswers,
  changeRiskDefinition,
  type DecisionDefinition,
  type DecisionModelProvider,
  type DecisionResult,
} from '@follo/decisions';

const definition: DecisionDefinition = {
  id: 'fixture-check',
  version: 1,
  name: 'Test-only fact check',
  questions: [
    {
      id: 'valid',
      type: 'choice',
      question: 'Fixture question',
      choices: ['YES', 'NO'],
      probabilities: true,
    },
  ],
  extractState: (context) => context.facts,
};
test('approved change-risk definition accepts verified metrics, retains cyclic depth uncertainty and rejects source or unknown facts', async () => {
  const facts = {
    fanIn: 1,
    fanOut: 1,
    directDependents: 1,
    downstreamDependents: 1,
    cycleCount: 1,
    maxDependencyDepth: null,
    linesOfCode: 10,
    coverage: {
      filesDiscovered: 2,
      filesParsed: 2,
      filesSkipped: 0,
      filesWithSyntaxErrors: 0,
      importsDiscovered: 2,
      internalResolved: 2,
      external: 0,
      skipped: 0,
      unresolved: 0,
      discoveryComplete: true,
    },
    unresolvedImports: 0,
    skippedImports: 0,
  };
  const context = { analysisId: 'fixture', subjectId: 'fixture', facts };
  assert.deepEqual(changeRiskDefinition.extractState(context), facts);
  assert.throws(
    () =>
      changeRiskDefinition.extractState({
        ...context,
        facts: { ...facts, source: 'private source' },
      }),
    /Unexpected/,
  );
  assert.throws(
    () => changeRiskDefinition.extractState({ ...context, facts: { ...facts, linesOfCode: null } }),
    /metric/,
  );
  assert.throws(
    () => changeRiskDefinition.extractState({ ...context, facts: { ...facts, coverage: {} } }),
    /coverage/,
  );
  const engine = new DecisionEngine(
    { saveDefinition: () => {}, saveResult: () => {} },
    {
      model: 'fixture',
      provider: {
        id: 'fixture',
        name: 'fixture',
        getCapabilities: async () => ({ questionTypes: ['choice'], probabilities: true }),
        decide: async (request) => {
          assert.equal('source' in (request.state as object), false);

          return {
            answers: [
              {
                questionId: 'risk',
                value: 'HIGH',
                probabilities: { LOW: 0.1, MODERATE: 0.2, HIGH: 0.6, CRITICAL: 0.1 },
              },
            ],
          };
        },
      },
    },
  );
  engine.register(changeRiskDefinition);
  assert.equal((await engine.evaluate('change-risk', context)).answers[0].value, 'HIGH');
});
test('registered decisions validate responses, hash canonical state and preserve provider-independent provenance', async () => {
  const results: DecisionResult[] = [];

  for (const id of ['fixture-provider-a', 'fixture-provider-b']) {
    const provider: DecisionModelProvider = {
      id,
      name: id,
      getCapabilities: async () => ({ questionTypes: ['choice'], probabilities: true }),
      decide: async (request) => {
        assert.equal(request.model, 'fixture-model');
        assert.equal(request.questions[0].id, 'valid');

        return {
          answers: [{ questionId: 'valid', value: 'YES', probabilities: { YES: 0.9, NO: 0.1 } }],
        };
      },
    };
    const engine = new DecisionEngine(
      { saveDefinition: () => {}, saveResult: (result) => results.push(result) },
      { provider, model: 'fixture-model' },
    );
    engine.register(definition);
    const result = await engine.evaluate('fixture-check', {
      analysisId: 'analysis',
      subjectId: 'file',
      facts: { b: 2, a: 1 },
    });
    assert.equal(result.provider, id);
    assert.equal(result.definitionVersion, 1);
    assert.equal(result.analysisId, 'analysis');
    assert.throws(() => engine.register(definition), /duplicate/);
    await assert.rejects(
      engine.evaluate('unregistered', { analysisId: 'analysis', subjectId: 'file', facts: {} }),
      /registered/,
    );
  }

  assert.equal(results[0].inputStateHash, results[1].inputStateHash);
  assert.equal(results.length, 2);
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
  assert.throws(() => canonicalJson({ a: Infinity }), /finite/);
});
test('missing providers, unsupported capabilities and malformed outcomes never persist guessed decisions', async () => {
  let stored = 0;
  const store = {
    saveDefinition: () => {},
    saveResult: () => {
      stored++;
    },
  };
  const unconfigured = new DecisionEngine(store);
  unconfigured.register(definition);
  const context = { analysisId: 'a', subjectId: 'b', facts: {} };
  await assert.rejects(unconfigured.evaluate(definition.id, context), /not configured/);
  const unsupported = new DecisionEngine(store, {
    provider: {
      id: 'fixture',
      name: 'fixture',
      getCapabilities: async () => ({ questionTypes: [], probabilities: false }),
      decide: async () => assert.fail('Must not invoke unsupported provider'),
    },
    model: 'fixture',
  });
  unsupported.register(definition);
  await assert.rejects(unsupported.evaluate(definition.id, context), /does not support/);
  for (const response of [
    { answers: [] },
    { answers: [{ questionId: 'valid', value: 'MAYBE', probabilities: { YES: 0.5, NO: 0.5 } }] },
    { answers: [{ questionId: 'valid', value: 'YES', probabilities: { YES: 0.1, NO: 0.9 } }] },
    { answers: [{ questionId: 'valid', value: 'YES', probabilities: { YES: NaN, NO: 0.1 } }] },
    {
      answers: [
        {
          questionId: 'valid',
          value: 'YES',
          probabilities: { YES: 0.9, NO: 0.1 },
          explanation: 'Unverified claim',
        },
      ],
    },
  ])
    assert.throws(() => validateAnswers(response, definition.questions));
  assert.equal(stored, 0);
  assert.deepEqual(
    validateAnswers(
      {
        answers: [
          { questionId: 'flag', value: false },
          { questionId: 'score', value: 3 },
        ],
      },
      [
        { id: 'flag', type: 'boolean', question: 'Flag?' },
        { id: 'score', type: 'score', question: 'Score?', min: 0, max: 5 },
      ],
    ).map((answer) => answer.value),
    [false, 3],
  );
});
