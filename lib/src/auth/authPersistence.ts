import type { AuthRecord } from './types.ts';
import { type Context } from '../context.ts';

import { GitHubAppInfo } from '../config.ts';
import { NetworkConfiguration } from '../networkConfiguration.ts';
import { PersistenceManager } from '../persist.ts';

const AUTH_FILE = 'apps';
const LEGACY_AUTH_FILE = 'hosts';

class AuthPersistence {
  constructor(
    readonly ctx: Context,
    readonly persistenceManager: PersistenceManager
  ) {}

  async getAuthRecord(): Promise<AuthRecord> {
    let authRecord = await this.persistenceManager.read(AUTH_FILE, this.authRecordKey(this.ctx));
    return (authRecord || (await this.legacyAuthRecordMaybe())) as AuthRecord;
  }

  async legacyAuthRecordMaybe(): Promise<unknown> {
    let legacyAuthRecord = await this.persistenceManager.read(LEGACY_AUTH_FILE, this.legacyAuthRecordKey(this.ctx));
    if (legacyAuthRecord) {
      const fallbackAppId = this.ctx.get(GitHubAppInfo).fallbackAppId();
      return { ...legacyAuthRecord, githubAppId: fallbackAppId };
    }
  }

  async saveAuthRecord(authRecord: AuthRecord): Promise<void> {
    const effectiveAppId = this.ctx.get(GitHubAppInfo).findAppIdToAuthenticate();
    await this.persistenceManager.update(AUTH_FILE, this.authRecordKey(this.ctx), authRecord);
    const fallbackAppId = this.ctx.get(GitHubAppInfo).fallbackAppId();
    if (effectiveAppId === fallbackAppId) {
      await this.persistenceManager.delete(LEGACY_AUTH_FILE, this.legacyAuthRecordKey(this.ctx));
    }
  }

  async deleteAuthRecord(): Promise<void> {
    const authRecord = await this.getAuthRecord();
    if (authRecord) {
      const fallbackAppId = this.ctx.get(GitHubAppInfo).fallbackAppId();
      if (authRecord.githubAppId === fallbackAppId) {
        await this.persistenceManager.delete(LEGACY_AUTH_FILE, this.legacyAuthRecordKey(this.ctx));
      }
      await this.persistenceManager.delete(AUTH_FILE, this.authRecordKey(this.ctx));
    }
  }

  authRecordKey(ctx: Context): string {
    const authAuthority = ctx.get(NetworkConfiguration).getAuthAuthority();
    const githubAppId = ctx.get(GitHubAppInfo).findAppIdToAuthenticate();
    return `${authAuthority}:${githubAppId}`;
  }

  legacyAuthRecordKey(ctx: Context): string {
    return ctx.get(NetworkConfiguration).getAuthAuthority();
  }
}

export { AuthPersistence };
