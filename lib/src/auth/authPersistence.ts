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

  async getAuthRecord(githubAppId?: string): Promise<AuthRecord | undefined> {
    let authRecord = await this.persistenceManager.read(AUTH_FILE, this.authRecordKey(this.ctx, githubAppId));

    if (!githubAppId && !authRecord) {
      authRecord = await this.persistenceManager.read(
        AUTH_FILE,
        this.authRecordKey(this.ctx, this.ctx.get(GitHubAppInfo).fallbackAppId())
      );
    }

    return (authRecord || (await this.legacyAuthRecordMaybe())) as AuthRecord | undefined;
  }

  async legacyAuthRecordMaybe(): Promise<AuthRecord | undefined> {
    const legacyAuthRecord = await this.persistenceManager.read(LEGACY_AUTH_FILE, this.legacyAuthRecordKey(this.ctx));
    if (legacyAuthRecord) {
      const fallbackAppId = this.ctx.get(GitHubAppInfo).fallbackAppId();
      return { ...legacyAuthRecord, githubAppId: fallbackAppId } as AuthRecord;
    }
  }

  async saveAuthRecord(authRecord: AuthRecord): Promise<void> {
    const effectiveAppId = this.ctx.get(GitHubAppInfo).findAppIdToAuthenticate();
    await this.persistenceManager.update(AUTH_FILE, this.authRecordKey(this.ctx, authRecord.githubAppId), authRecord);
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
      await this.persistenceManager.delete(AUTH_FILE, this.authRecordKey(this.ctx, fallbackAppId));
    }
  }

  authRecordKey(ctx: Context, githubAppId?: string): string {
    const authAuthority = ctx.get(NetworkConfiguration).getAuthAuthority();
    const appId = githubAppId ?? ctx.get(GitHubAppInfo).findAppIdToAuthenticate();
    return `${authAuthority}:${appId}`;
  }

  legacyAuthRecordKey(ctx: Context): string {
    return ctx.get(NetworkConfiguration).getAuthAuthority();
  }
}

export { AuthPersistence };
