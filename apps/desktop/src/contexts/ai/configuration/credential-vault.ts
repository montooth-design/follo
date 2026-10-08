import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';

/** Uses Electron's OS-backed encryption; no raw credential is returned by IPC. */
export class CredentialVault {
  constructor(
    private readonly filename: string,
    private readonly protection: {
      isEncryptionAvailable(): boolean;
      encryptString(value: string): Buffer;
      decryptString(value: Buffer): string;
      getSelectedStorageBackend?(): string;
    },
  ) {}
  available(): boolean {
    return (
      this.protection.isEncryptionAvailable() &&
      this.protection.getSelectedStorageBackend?.() !== 'basic_text'
    );
  }
  set(endpoint: string, credential: string): void {
    if (!this.available()) throw new Error('OS-protected credential storage is unavailable.');
    if (credential.length > 8192 || /[\r\n]/.test(credential))
      throw new Error('Invalid credential format.');
    const encrypted = this.protection.encryptString(JSON.stringify({ endpoint, credential }));
    writeFileSync(`${this.filename}.tmp`, encrypted, { mode: 0o600 });
    renameSync(`${this.filename}.tmp`, this.filename);
  }
  get(endpoint: string): string {
    if (!this.available()) throw new Error('OS-protected credential storage is unavailable.');
    if (!existsSync(this.filename)) throw new Error('Provider credential is missing.');
    let value: { endpoint?: unknown; credential?: unknown };

    try {
      value = JSON.parse(this.protection.decryptString(readFileSync(this.filename)));
    } catch {
      throw new Error('Stored credential cannot be decrypted. Re-enter it.');
    }

    if (value.endpoint !== endpoint || typeof value.credential !== 'string')
      throw new Error('Credential does not belong to this endpoint.');

    return value.credential;
  }
  clear(): void {
    if (existsSync(this.filename)) unlinkSync(this.filename);
  }
}
