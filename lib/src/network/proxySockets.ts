import * as http from 'node:http';
import type { Socket } from 'node:net';
import { type Fetcher } from '../networking.ts';

import { Context } from '../context.ts';
import { telemetry } from '../telemetry.ts';
import { Logger, LogLevel } from '../logger.ts';
import { LRUCacheMap } from '../common/cache.ts';

const PROXY_AUTHORIZATION_REQUIRED = 407;
const logger = new Logger(LogLevel.DEBUG, 'proxySocketFactory');

function getProxySocketFactory(ctx: Context) {
  return new KerberosProxySocketFactory(ctx, new TunnelingProxySocketFactory(ctx));
}

class ProxySocketError extends Error {
  code?: string;
  syscall?: string;
  errno?: number;

  constructor(message: string, cause?: unknown, code?: string) {
    super(message);
    this.code = (cause as any)?.code;
    this.syscall = (cause as any).syscall;
    this.errno = (cause as any).errno;

    const causeMessage = (cause as any)?.message;
    if (code !== undefined) {
      this.code = code;
    } else if (causeMessage) {
      if (/^Failed to establish a socket connection to proxies:/.test(causeMessage)) {
        this.code = 'ProxyFailedToEstablishSocketConnection';
      } else if (/^InitializeSecurityContext:/.test(causeMessage)) {
        this.code = 'ProxyInitializeSecurityContext';
      } else if (causeMessage === 'Miscellaneous failure (see text): Server not found in Kerberos database') {
        this.code = 'ProxyKerberosServerNotFound';
      } else if (
        /^Unspecified GSS failure. {2}Minor code may provide more information: No Kerberos credentials available/.test(
          causeMessage
        )
      ) {
        this.code = 'ProxyGSSFailureNoKerberosCredentialsAvailable';
      }
    }
  }
}

// export interface KerberosClient {
//   step(challenge: string): Promise<string>;
// }
//
// type Kerberos = {
//   initializeClient(hostname: string, service?: string): Promise<KerberosClient>;
// };

class KerberosLoader {
  async load() {
    // @ts-ignore
    return await import('kerberos');
  }
}

type ConnectOptions = http.RequestOptions &
  Fetcher.ProxySetting & {
    headers: { 'Proxy-Authorization'?: http.OutgoingHttpHeader[] } & http.OutgoingHttpHeaders;
  };

abstract class ProxySocketFactory {
  abstract createSocket(requestOptions: http.RequestOptions, proxySettings: Fetcher.ProxySetting): Promise<unknown>;
}

class KerberosProxySocketFactory extends ProxySocketFactory {
  private successfullyAuthorized = new LRUCacheMap<string, boolean>(20);

  constructor(
    readonly ctx: Context,
    readonly delegate: TunnelingProxySocketFactory,
    readonly kerberosLoader: KerberosLoader = new KerberosLoader(),
    readonly platform: NodeJS.Platform = process.platform
  ) {
    super();
  }

  async createSocket(requestOptions: http.RequestOptions, proxySettings: Fetcher.ProxySetting): Promise<unknown> {
    if (this.successfullyAuthorized.get(this.getProxyCacheKey(proxySettings))) {
      logger.debug(this.ctx, 'Proxy authorization already successful once, skipping 407 rountrip');
      await this.reauthorize(requestOptions, proxySettings);
    }
    try {
      return await this.delegate.createSocket(requestOptions, proxySettings);
    } catch (error) {
      if (error instanceof ProxySocketError && error.code === `ProxyStatusCode${PROXY_AUTHORIZATION_REQUIRED}`) {
        logger.debug(this.ctx, 'Proxy authorization required, trying to authorize first time');
        const socket = await this.authorizeAndCreateSocket(requestOptions, proxySettings);
        if (socket) {
          logger.debug(this.ctx, 'Proxy authorization successful, caching result');
          telemetry(this.ctx, 'proxy.kerberosAuthorized');
          this.successfullyAuthorized.set(this.getProxyCacheKey(proxySettings), true);
          return socket;
        }
      }
      throw error;
    }
  }

  async reauthorize(requestOptions: http.RequestOptions, proxySettings: Fetcher.ProxySetting): Promise<void> {
    const proxyAuthorization = await this.authorize(proxySettings);
    if (proxyAuthorization) {
      logger.debug(this.ctx, 'Proxy re-authorization successful, received token');
      requestOptions.headers ??= {};
      requestOptions.headers['Proxy-Authorization'] = 'Negotiate ' + proxyAuthorization;
    }
  }

  async authorizeAndCreateSocket(
    requestOptions: http.RequestOptions,
    proxySettings: Fetcher.ProxySetting
  ): Promise<unknown> {
    const proxyAuthorization = await this.authorize(proxySettings);
    logger.debug(this.ctx, 'Proxy authorization successful, received token');
    if (proxyAuthorization) {
      logger.debug(this.ctx, 'Trying to create socket with proxy authorization');
      requestOptions.headers ??= {};
      requestOptions.headers['Proxy-Authorization'] = 'Negotiate ' + proxyAuthorization;
      return await this.delegate.createSocket(requestOptions, proxySettings);
    }
  }

  async authorize(proxySettings: Fetcher.ProxySetting): Promise<string> {
    logger.debug(this.ctx, 'Loading kerberos module');
    const kerberos = await this.kerberosLoader.load();
    const spn = this.computeSpn(proxySettings);
    logger.debug(this.ctx, 'Initializing kerberos client using spn', spn);
    const client = await kerberos.initializeClient(spn);
    logger.debug(this.ctx, 'Perform client side kerberos step');
    const response = await client.step('');
    logger.debug(this.ctx, 'Received kerberos server response');
    return response;
  }

  computeSpn(proxySettings: Fetcher.ProxySetting): string {
    const configuredSpn = proxySettings.kerberosServicePrincipal;
    if (configuredSpn) {
      logger.debug(this.ctx, 'Using configured kerberos spn', configuredSpn);
      return configuredSpn;
    }
    const defaultSpn = this.platform === 'win32' ? `HTTP/${proxySettings.host}` : `HTTP@${proxySettings.host}`;
    logger.debug(this.ctx, 'Using default kerberos spn', defaultSpn);
    return defaultSpn;
  }

  getProxyCacheKey(proxySettings: Fetcher.ProxySetting): string {
    return `${proxySettings.host}:${proxySettings.port}`;
  }
}

class TunnelingProxySocketFactory extends ProxySocketFactory {
  constructor(readonly ctx: Context) {
    super();
  }

  async createSocket(requestOptions: http.RequestOptions, proxySettings: Fetcher.ProxySetting): Promise<Socket> {
    const connectOptions = this.createConnectRequestOptions(requestOptions, proxySettings);
    return new Promise((resolve, reject) => {
      logger.debug(this.ctx, 'Attempting to establish connection to proxy');
      const connectRequest = http.request(connectOptions);
      connectRequest.useChunkedEncodingByDefault = false;
      connectRequest.once('connect', (res: http.IncomingMessage, socket: Socket, head: Buffer) => {
        logger.debug(this.ctx, 'Socket Connect returned status code', res.statusCode);
        connectRequest.removeAllListeners();
        socket.removeAllListeners();
        if (res.statusCode !== 200) {
          socket.destroy();
          reject(
            new ProxySocketError(
              `tunneling socket could not be established, statusCode=${res.statusCode}`,
              undefined,
              `ProxyStatusCode${res.statusCode}`
            )
          );
        } else if (head.length > 0) {
          socket.destroy();
          reject(
            new ProxySocketError(
              'got non-empty response body from proxy, length=' + head.length,
              undefined,
              'ProxyNonEmptyResponseBody'
            )
          );
        } else {
          logger.debug(this.ctx, 'Successfully established tunneling connection to proxy');
          resolve(socket);
        }
      });
      connectRequest.once('error', (cause: Error) => {
        logger.debug(this.ctx, 'Proxy socket connection error', cause.message);
        connectRequest.removeAllListeners();
        reject(new ProxySocketError(`tunneling socket could not be established, cause=${cause.message}`, cause));
      });
      connectRequest.on('timeout', () => {
        logger.debug(this.ctx, 'Proxy socket connection timeout');
        reject(
          new ProxySocketError(
            `tunneling socket could not be established, proxy socket connection timeout while connecting to ${connectOptions.host}:${connectOptions.port}`,
            undefined,
            'ProxyTimeout'
          )
        );
      });
      connectRequest.end();
    });
  }

  createConnectRequestOptions(
    requestOptions: http.RequestOptions,
    proxySettings: Fetcher.ProxySetting
  ): http.RequestOptions {
    const path = `${requestOptions.hostname}:${requestOptions.port}`;
    const connectOptions: ConnectOptions = {
      ...proxySettings,
      method: 'CONNECT',
      path: path,
      agent: false,
      headers: { host: path, 'Proxy-Connection': 'keep-alive' },
      timeout: requestOptions.timeout,
    };
    if (requestOptions.localAddress) connectOptions.localAddress = requestOptions.localAddress;
    this.configureProxyAuthorization(connectOptions, requestOptions);
    return connectOptions;
  }

  configureProxyAuthorization(connectOptions: ConnectOptions, requestOptions: http.RequestOptions): void {
    connectOptions.headers['Proxy-Authorization'] = [];
    if (connectOptions.proxyAuth) {
      connectOptions.headers['Proxy-Authorization'].push(
        'Basic ' + Buffer.from(connectOptions.proxyAuth).toString('base64')
      );
    }
    if (requestOptions.headers && requestOptions.headers['Proxy-Authorization']) {
      connectOptions.headers['Proxy-Authorization'].push(requestOptions.headers['Proxy-Authorization']);
    }
  }
}

export {
  http,
  PROXY_AUTHORIZATION_REQUIRED,
  logger,
  ProxySocketFactory,
  ProxySocketError,
  KerberosProxySocketFactory,
  TunnelingProxySocketFactory,
  KerberosLoader,
  getProxySocketFactory,
};
