import type { GroundednessReport, GraphSnapshot } from '@follo/shared';
import type { ToolEvidence } from './tools';
import type { DecisionResult } from '@follo/decisions';

export function evaluateGroundedness(
  answer: string,
  evidence: ToolEvidence,
  graph: GraphSnapshot,
  decisions: DecisionResult[],
): GroundednessReport {
  const files = new Map(graph.nodes.map((file) => [file.id, file.path]));
  const paths = new Map(graph.nodes.map((file) => [file.path, file.id]));
  const seen = new Set(evidence.files.map((file) => file.id));
  const returned = new Set(evidence.decisionIds);
  const fileReferences = [
    ...new Set([...answer.matchAll(/\[file:([^\]\n]+)\]/g)].map((match) => match[1])),
  ];
  const decisionReferences = [
    ...new Set([...answer.matchAll(/\[decision:([^\]\n]+)\]/g)].map((match) => match[1])),
  ];
  const unsupported: GroundednessReport['unsupported'] = [];
  let validFiles = 0;
  let validDecisions = 0;

  for (const id of fileReferences) {
    if (!files.has(id))
      unsupported.push({ reference: id, reason: 'File ID is absent from the saved analysis.' });
    else if (!seen.has(id))
      unsupported.push({
        reference: files.get(id)!,
        reason: 'File was not returned by a successful tool.',
      });
    else validFiles++;
  }

  const mentionedPaths = [
    ...new Set(
      [
        ...answer.matchAll(
          /(?:[A-Za-z]:[\\/])?(?:[\w@.+-]+[\\/])*[\w@.+-]+\.(?:tsx?|jsx?|mjs|cjs|json)\b/g,
        ),
      ].map((match) => match[0].replaceAll('\\', '/')),
    ),
  ];
  let validPaths = 0;

  for (const path of mentionedPaths) {
    const fileId = paths.get(path);
    // A token may be the suffix of a path containing spaces; require the complete known path in the answer.
    const spaced = graph.nodes.find(
      (file) => file.path.includes(' ') && file.path.endsWith(path) && answer.includes(file.path),
    );
    const id = fileId ?? spaced?.id;
    if (!id)
      unsupported.push({
        reference: path,
        reason:
          'Path is absent from the saved analysis (possibly nonexistent, excluded or unparsed).',
      });
    else if (!seen.has(id))
      unsupported.push({
        reference: path,
        reason: 'File path was not returned by a successful tool.',
      });
    else validPaths++;
  }

  for (const reference of decisionReferences) {
    const [id, outcome, ...extra] = reference.split('=');
    const result = decisions.find((result) => result.decisionId === id);
    if (extra.length || !returned.has(id) || !result)
      unsupported.push({
        reference,
        reason: 'Decision was not returned by the registered decision tool.',
      });
    else if (outcome && !result.answers.some((answer) => String(answer.value) === outcome))
      unsupported.push({
        reference,
        reason: 'Claimed outcome differs from the registered decision result.',
      });
    else validDecisions++;
  }

  const warnings: string[] = [];
  if (!fileReferences.length && !mentionedPaths.length && !decisionReferences.length)
    warnings.push('No checkable repository references were provided.');
  if (/\b(?:low|moderate|high|critical)[ -](?:change[ -])?risk\b/i.test(answer) && !validDecisions)
    warnings.push('Risk language has no valid registered decision citation; inspect this claim.');

  return {
    fileReferences: fileReferences.length + mentionedPaths.length,
    validFileReferences: validFiles + validPaths,
    decisionReferences: decisionReferences.length,
    validDecisionReferences: validDecisions,
    unsupported,
    warnings,
    scope:
      'Checks reference existence, returned evidence and explicit decision outcomes. Freeform claim semantics and implied relationships are not automatically verified.',
  };
}
