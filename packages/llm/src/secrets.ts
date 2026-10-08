/** Defense in depth for outbound model context; preserves original line numbers. */
export function redactSecrets(text: string): string {
  const mask = (value: string) => value.replace(/[^\r\n]/g, '*');

  return text
    .replace(
      /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g,
      mask,
    )
    .replace(
      /\b(?:sk-(?:or-v1-|proj-|ant-api\d+-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g,
      mask,
    )
    .replace(
      /\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}/gi,
      (value, prefix: string) => prefix + mask(value.slice(prefix.length)),
    )
    .replace(
      /((?:["']?)(?:[\w-]*(?:api[_-]?key|secret|password|access[_-]?token|auth[_-]?token|private[_-]?key)[\w-]*)(?:["']?)\s*[:=]\s*)(["'`])([^\r\n]*?)\2/gi,
      (value, prefix: string, quote: string, secret: string) =>
        secret.length >= 12 && !secret.includes('${')
          ? prefix + quote + mask(secret) + quote
          : value,
    );
}
