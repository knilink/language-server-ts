import { type SecureContext, type SecureContextOptions, createSecureContext } from 'node:tls';

import { Context } from '../context.ts';
import { RootCertificateReader } from './certificateReaders.ts';
import { Fetcher } from '../networking.ts';

type RequestOptions = {
  secureContext: SecureContext;
  ca?: readonly string[];
  cert?: readonly string[];
  // ./helix.ts
  rejectUnauthorized?: boolean;
  // ./helix.ts
  timeout?: number;
};

class RootCertificateConfigurator {
  private _cache: Promise<{ secureContext: SecureContext; certs: readonly string[] }> | undefined;
  readonly _certificateReader: RootCertificateReader;

  constructor(ctx: Context) {
    this._certificateReader = ctx.get(RootCertificateReader);
  }

  async enhanceProxySettings(proxySettings: Fetcher.ProxySetting): Promise<Fetcher.ProxySetting> {
    const certs = await this.getCertificates();
    return { ...proxySettings, ca: certs };
  }

  async getCertificates(): Promise<readonly string[] | undefined> {
    const certificates = await this._certificateReader.getAllRootCAs();
    if (certificates.length !== 0) return certificates;
  }

  async createSecureContext() {
    const certs = await this._certificateReader.getAllRootCAs();
    const options: SecureContextOptions & { _vscodeAdditionalCaCerts: readonly string[] } = {
      _vscodeAdditionalCaCerts: certs,
    };
    const secureContext = createSecureContext(options);
    for (const cert of certs) secureContext.context.addCACert(cert);
    return { secureContext, certs };
  }

  async applyToRequestOptions(requestOptions: RequestOptions): Promise<void> {
    if (!this._cache) {
      this._cache = this.createSecureContext();
    }
    const cache = await this._cache;
    requestOptions.secureContext = cache.secureContext;
    requestOptions.ca = cache.certs;
    requestOptions.cert = cache.certs;
  }
}

export { RootCertificateConfigurator, RequestOptions };
