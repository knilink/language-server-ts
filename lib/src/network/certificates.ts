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
  private _certificateReader: RootCertificateReader;

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

  async applyToRequestOptions(requestOptions: RequestOptions): Promise<void> {
    const certs = await this._certificateReader.getAllRootCAs();
    const options: SecureContextOptions & { _vscodeAdditionalCaCerts: readonly string[] } = {
      _vscodeAdditionalCaCerts: certs,
    }; // MARK
    requestOptions.secureContext = createSecureContext(options);
    requestOptions.ca = certs;
    requestOptions.cert = certs;
    for (const cert of certs) {
      requestOptions.secureContext.context.addCACert(cert);
    }
  }
}

export { RootCertificateConfigurator, RequestOptions };
