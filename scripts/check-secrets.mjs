import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const excluded = new Set([
  'node_modules',
  '.git',
  ...(process.argv.includes('--include-build') ? [] : ['dist', 'release']),
]);
const patterns = [
  /\bsk-(?:or-v1-|proj-|ant-api\d+-)?[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g,
  /\b(?:api[_-]?key|password|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*["'][A-Za-z0-9_+/=-]{20,}["']/gi,
];
let findings = 0;

function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || excluded.has(entry.name)) continue;
    const filename = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      scan(filename);
      continue;
    }

    if (
      !/\.(?:[cm]?[jt]sx?|json|map|md|ya?ml|toml|txt|env|pem|key)$/.test(filename) &&
      !entry.name.startsWith('.env')
    )
      continue;
    const text = readFileSync(filename, 'utf8');

    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        findings++;
        const line = text.slice(0, match.index).split('\n').length;
        console.error(
          `${path.relative(process.cwd(), filename)}:${line}: potential secret (value withheld)`,
        );
      }
    }
  }
}

scan(process.cwd());
console.log(
  findings
    ? `${findings} potential secrets require review.`
    : 'No recognized key tokens or private keys found in project files.',
);
process.exitCode = findings ? 1 : 0;
