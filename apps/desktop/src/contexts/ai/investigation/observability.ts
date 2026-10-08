import type { LocalDatabase } from '@follo/database';
import type { AskState, PrivacyPolicy } from '@follo/shared';
import { createHash } from 'node:crypto';

export interface InvestigationTrace {
  id: string;
  createdAt: string;
  analysisId: string;
  provider: string;
  model: string;
  permission: PrivacyPolicy['level'];
  questionHash: string;
  questionCharacters: number;
  answerHash: string;
  answerCharacters: number;
  status: AskState['status'];
  stats: AskState['stats'];
  activity: AskState['activity'];
  evidence: AskState['evidence'];
  evaluation: AskState['evaluation'];
  error: string | null;
}
export interface InvestigationObserver {
  record(trace: InvestigationTrace): void;
}
export const textHash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Metadata only: no question/answer/source text, credentials or raw tool arguments are persisted. */
export class LocalInvestigationObserver implements InvestigationObserver {
  constructor(private readonly database: LocalDatabase) {}
  record(trace: InvestigationTrace): void {
    const previous = this.database.readConfiguration('investigation-traces');
    const records = Array.isArray(previous) ? previous.slice(-49) : [];
    this.database.saveConfiguration('investigation-traces', [...records, trace]);
  }
}
