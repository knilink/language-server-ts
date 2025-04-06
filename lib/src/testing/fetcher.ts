import type { AbortController } from '@adobe/helix-fetch';

import { RootCertificateReader } from '../network/certificateReaders.ts';
import { Response, Fetcher } from '../networking.ts';

function createFakeResponse(statusCode: number, response?: string, headers: Record<string, string> = {}): Response {
  const fakeHeaders = new FakeHeaders();
  fakeHeaders.set('x-github-request-id', '1');
  for (const [key, value] of Object.entries(headers)) {
    fakeHeaders.set(key, value);
  }

  return new Response(
    statusCode,
    'status text',
    fakeHeaders,
    async () => response ?? '',
    () => null! // MARK IDK
  );
}

function createFakeJsonResponse(statusCode: number, response?: unknown, headers?: Record<string, string>): Response {
  let text: string;
  if (typeof response === 'string') {
    text = response;
  } else {
    text = JSON.stringify(response);
  }

  return createFakeResponse(statusCode, text, Object.assign({ 'content-type': 'application/json' }, headers));
}

class TestCertificateReader extends RootCertificateReader {
  constructor(readonly certificates: string[]) {
    super();
  }
  async getAllRootCAs() {
    return this.certificates;
  }
}
const createTestCertificateReader = (certificates: string[]) => new TestCertificateReader(certificates);

abstract class FakeFetcher extends Fetcher {
  readonly name = 'FakeFetcher';
  proxySettings?: never;

  disconnectAll(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  makeAbortController(): AbortController {
    return new FakeAbortController();
  }
}

class NoFetchFetcher extends FakeFetcher {
  fetch(url: unknown, options: unknown): Promise<never> {
    throw new Error('NoFetchFetcher does not support fetching');
  }
}

class FakeHeaders {
  headers = new Map<string, string>();

  append(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  delete(name: string): void {
    this.headers.delete(name.toLowerCase());
  }

  get(name: string): string | null {
    const value = this.headers.get(name.toLowerCase());
    return value ?? null;
  }

  has(name: string): boolean {
    return this.headers.has(name.toLowerCase());
  }

  set(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  entries(): IterableIterator<[string, string]> {
    return this.headers.entries();
  }

  keys(): IterableIterator<string> {
    return this.headers.keys();
  }

  values(): IterableIterator<string> {
    return this.headers.values();
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.headers.entries();
  }

  // EDITED, to be compatible with helix Headers
  raw(): Record<string, string> {
    return Object.fromEntries(this.entries());
  }
}

class FakeAbortController {
  readonly signal: any = { aborted: false, addEventListener: () => {}, removeEventListener: () => {} };
  constructor() {}
  abort() {
    this.signal.aborted = true;
  }
}

export { FakeFetcher, NoFetchFetcher, createFakeJsonResponse, createFakeResponse, createTestCertificateReader };
