import type { DecisionDefinition, JsonValue } from './index';
import type { FileInspection, ParserCoverage } from '@follo/shared';

export function changeRiskState(inspection: FileInspection, coverage: ParserCoverage): JsonValue {
  if (
    inspection.file.status !== 'parsed' ||
    inspection.file.diagnostics.length ||
    inspection.file.linesOfCode === null
  )
    throw new Error('Change risk requires a parsed file with known LOC and no syntax diagnostics.');
  const {
    fanIn,
    fanOut,
    directDependents,
    downstreamDependents,
    cycleCount,
    maxDependencyDepth,
    linesOfCode,
  } = inspection.metrics;

  return {
    fanIn,
    fanOut,
    directDependents,
    downstreamDependents,
    cycleCount,
    maxDependencyDepth,
    linesOfCode,
    coverage: { ...coverage },
    unresolvedImports: inspection.file.imports.filter(
      (fact) => fact.resolution.status === 'unresolved',
    ).length,
    skippedImports: inspection.file.imports.filter((fact) => fact.resolution.status === 'skipped')
      .length,
  };
}

export const changeRiskDefinition: DecisionDefinition = {
  id: 'change-risk',
  version: 1,
  name: 'Structural change risk',
  questions: [
    {
      id: 'risk',
      type: 'choice',
      question:
        'Classify the structural change risk associated with modifying this file, using only the supplied verified dependency facts.',
      choices: ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'],
      probabilities: true,
    },
  ],
  extractState({ facts }) {
    if (!facts || typeof facts !== 'object' || Array.isArray(facts))
      throw new Error('Malformed change-risk state.');
    const expected = [
      'fanIn',
      'fanOut',
      'directDependents',
      'downstreamDependents',
      'cycleCount',
      'maxDependencyDepth',
      'linesOfCode',
      'coverage',
      'unresolvedImports',
      'skippedImports',
    ];
    if (Object.keys(facts).sort().join(',') !== expected.sort().join(','))
      throw new Error('Unexpected change-risk state fields.');

    for (const key of expected.filter(
      (key) => key !== 'coverage' && key !== 'maxDependencyDepth',
    )) {
      if (typeof facts[key] !== 'number' || !Number.isSafeInteger(facts[key]) || facts[key] < 0)
        throw new Error('Invalid verified change-risk metric.');
    }

    if (
      facts.maxDependencyDepth !== null &&
      (typeof facts.maxDependencyDepth !== 'number' ||
        !Number.isSafeInteger(facts.maxDependencyDepth) ||
        facts.maxDependencyDepth < 0)
    )
      throw new Error('Invalid dependency depth.');
    const coverage = facts.coverage;
    const fields = [
      'filesDiscovered',
      'filesParsed',
      'filesSkipped',
      'filesWithSyntaxErrors',
      'importsDiscovered',
      'internalResolved',
      'external',
      'skipped',
      'unresolved',
      'discoveryComplete',
    ];
    if (
      !coverage ||
      typeof coverage !== 'object' ||
      Array.isArray(coverage) ||
      Object.keys(coverage).sort().join(',') !== fields.sort().join(',') ||
      typeof coverage.discoveryComplete !== 'boolean' ||
      fields
        .filter((key) => key !== 'discoveryComplete')
        .some(
          (key) =>
            typeof coverage[key] !== 'number' ||
            !Number.isSafeInteger(coverage[key]) ||
            coverage[key] < 0,
        )
    )
      throw new Error('Invalid parser coverage.');

    return structuredClone(facts);
  },
};
