import * as fs from 'node:fs';
import * as tls from 'node:tls';
import { Context } from '../context.ts';
import { Logger, LogLevel } from '../logger.ts';

const certLogger = new Logger(LogLevel.INFO, 'certificates');

abstract class RootCertificateReader {
  abstract getAllRootCAs(): Promise<readonly string[]>;
}

class ErrorHandlingCertificateReader extends RootCertificateReader {
  constructor(
    readonly ctx: Context,
    readonly delegate: RootCertificateReader
  ) {
    super();
  }

  async getAllRootCAs(): Promise<readonly string[]> {
    try {
      return await this.delegate.getAllRootCAs();
    } catch (ex: unknown) {
      certLogger.warn(this.ctx, `Failed to read root certificates: ${ex}`);
      return [];
    }
  }
}

class CachingRootCertificateReader extends RootCertificateReader {
  readonly delegates: ErrorHandlingCertificateReader[];
  certificates?: string[];

  constructor(ctx: Context, delegates: RootCertificateReader[]) {
    super();
    this.delegates = delegates.map((d) => new ErrorHandlingCertificateReader(ctx, d));
  }

  async getAllRootCAs(): Promise<string[]> {
    if (!this.certificates) {
      this.certificates = (await Promise.all(this.delegates.map((d) => d.getAllRootCAs()))).flat();
    }
    return this.certificates;
  }
}

class NodeTlsRootCertificateReader extends RootCertificateReader {
  async getAllRootCAs(): Promise<readonly string[]> {
    return tls.rootCertificates;
  }
}

class EnvironmentVariableRootCertificateReader extends RootCertificateReader {
  async getAllRootCAs(): Promise<readonly string[]> {
    const extraCertsFile = process.env.NODE_EXTRA_CA_CERTS;
    return extraCertsFile ? await readCertsFromFile(extraCertsFile) : [];
  }
}

class LinuxRootCertificateReader extends RootCertificateReader {
  constructor(readonly ctx: Context) {
    super();
  }

  async getAllRootCAs(): Promise<readonly string[]> {
    const rootCAs: string[] = [];
    for (const certPath of ['/etc/ssl/certs/ca-certificates.crt', '/etc/ssl/certs/ca-bundle.crt']) {
      const certs = await readCertsFromFile(certPath);
      certLogger.debug(this.ctx, `Read ${certs.length} certificates from ${certPath}`);
      rootCAs.push(...certs);
    }
    return rootCAs;
  }
}

class MacRootCertificateReader extends RootCertificateReader {
  private ctx: Context;

  constructor(ctx: Context) {
    super();
    this.ctx = ctx;
  }

  async getAllRootCAs(): Promise<readonly string[]> {
    // @ts-ignore
    const macCa: any = await import('@roamhq/mac-ca');
    const certs: string[] = macCa.all(macCa.der2.pem).filter((c: string) => c !== undefined);
    certLogger.debug(this.ctx, `Read ${certs.length} certificates from Mac keychain`);
    return certs;
  }
}

class WindowsRootCertificateReader extends RootCertificateReader {
  constructor(readonly ctx: Context) {
    super();
  }

  async getAllRootCAs(): Promise<readonly string[]> {
    // @ts-ignore
    const winCa: any = await import('windows-ca-certs');
    const certs: string[] = winCa.all();
    certLogger.debug(this.ctx, `Read ${certs.length} certificates from Windows store`);
    return certs;
  }
}

class UnsupportedPlatformRootCertificateReader extends RootCertificateReader {
  async getAllRootCAs(): Promise<readonly string[]> {
    throw new Error('No certificate reader available for unsupported platform');
  }
}

function createPlatformReader(ctx: Context, platform: NodeJS.Platform): RootCertificateReader {
  switch (platform) {
    case 'linux':
      return new LinuxRootCertificateReader(ctx);
    case 'darwin':
      return new MacRootCertificateReader(ctx);
    case 'win32':
      return new WindowsRootCertificateReader(ctx);
    default:
      return new UnsupportedPlatformRootCertificateReader();
  }
}

function getRootCertificateReader(ctx: Context, platform: NodeJS.Platform = process.platform): RootCertificateReader {
  return new CachingRootCertificateReader(ctx, [
    new NodeTlsRootCertificateReader(),
    new EnvironmentVariableRootCertificateReader(),
    createPlatformReader(ctx, platform),
  ]);
}

async function readCertsFromFile(certFilePath: string): Promise<string[]> {
  try {
    const nonEmptyCerts = (await fs.promises.readFile(certFilePath, { encoding: 'utf8' }))
      .split(/(?=-----BEGIN CERTIFICATE-----)/g)
      .filter((pem) => pem.length > 0);
    const uniqueCerts = new Set<string>(nonEmptyCerts);
    return Array.from(uniqueCerts);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return [];
}

export { RootCertificateReader, getRootCertificateReader };
