import * as os from 'os';
import { URI } from 'vscode-uri';

class GitRemoteUrl {
  private url: string;
  private _scheme?: string;
  private _authority?: string;
  private _hostname?: string;
  private _path?: string;
  private _error?: Error;

  constructor(url: string) {
    this.url = url;
    if (this.isUrl()) {
      this.parseUrl();
    } else if (!this.tryParseSSHString()) {
      this._scheme = 'file';
    }
  }

  get scheme(): string | undefined {
    return this._scheme;
  }

  get authority(): string | undefined {
    return this._authority;
  }

  get hostname(): string | undefined {
    return this._hostname;
  }

  get path(): string | undefined {
    return this._path;
  }

  isInvalid(): boolean {
    return Boolean(this._error);
  }

  isRemote(): boolean {
    return this.scheme !== 'file' && Boolean(this.hostname);
  }

  isGitHub(): boolean {
    const hostname = this.hostname;
    return this.isRemote() && /(?:^|\.)(?:github\.com|ghe\.com)$/i.test(hostname ?? '');
  }

  isADO(): boolean {
    const hostname = this.hostname;
    return this.isRemote() && /(?:^|\.)(?:visualstudio\.com|azure\.com)$/i.test(hostname ?? '');
  }

  getUrlForApi(): string | null {
    if (!this.isRemote()) return null;
    if (this.isUrl() && !this.isInvalid()) {
      const uri = URI.from({
        scheme: this.scheme!,
        authority: this.authority?.replace(/^[^@]+@/, ''),
        path: this.path,
      });
      return uri.toString();
    }
    if (this.scheme === 'ssh' && this.isADO()) {
      const idx = this.url.indexOf(':');
      return this.url.substring(0, idx + 1) + this.path;
    }
    return this.url;
  }

  isUrl(): boolean {
    return /[A-Za-z0-9][A-Za-z0-9]+:\/\//.test(this.url);
  }

  parseUrl(): void {
    let uri: URI | undefined;
    try {
      uri = URI.parse(this.url);
    } catch (e) {
      this._error = e as Error;
      return;
    }
    this._scheme = uri.scheme;
    this.setAuthority(uri.authority);
    this.setPath(uri.path);
  }

  setAuthority(authority: string): void {
    this._authority = authority;
    const hostname = authority.replace(/^[^@]+@/, '').replace(/:\d*$/, '');
    this._hostname = hostname;
  }

  tryParseSSHString() {
    const match = /^(?<host>[^:/\\[]*(?:\[[^/\\\]]*\])?):/.exec(this.url);
    if (match && (os.platform() !== 'win32' || (match.groups?.host?.length ?? 0) > 1)) {
      const authority = match.groups!.host;
      this._scheme = 'ssh';
      this.setAuthority(authority);
      this.setPath(this.url.substring(authority.length + 1));
      return true;
    }
    return false;
  }

  setPath(path: string): void {
    if (this.isADO()) {
      try {
        this._path = decodeURIComponent(path);
        return;
      } catch { }
    }
    this._path = path;
  }
}

export { GitRemoteUrl };
