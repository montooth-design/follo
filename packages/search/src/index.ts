/** Literal keyword search: renderer input never becomes SQL or FTS operators. */
export function literalSearchQuery(input: unknown): string {
  if (typeof input !== 'string' || input.length > 200)
    throw new Error('Search must be a string of up to 200 characters.');
  const tokens = input.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (!tokens.length || tokens.length > 20) throw new Error('Enter 1–20 search words.');

  return tokens.map((token) => `"${token}"*`).join(' AND ');
}
