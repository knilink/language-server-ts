import { Response, Fetcher } from "../networking.ts";

function createFakeResponse(statusCode: number, response?: string, headers: Record<string, string> = {}): Response {
  const fakeHeaders = new FakeHeaders();
  for (const [key, value] of Object.entries(headers)) {
    fakeHeaders.set(key, value);
  }

  return new Response(
    statusCode,
    'status text',
    fakeHeaders,
    async () => response ?? '',
    async () => null! // MARK IDK
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

abstract class FakeFetcher extends Fetcher {
  readonly name = 'FakeFetcher';

  disconnectAll(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  makeAbortController(): AbortController {
    throw new Error('Method not implemented.');
  }
}

class FakeHeaders {
  private headers = new Map<string, string>();

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
}

export { FakeFetcher, FakeHeaders, createFakeJsonResponse, createFakeResponse };
