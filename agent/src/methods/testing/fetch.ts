import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from '../../cancellation.ts';

import { Context } from '../../../../lib/src/context.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { EditorFetcher } from '../../editorFeatures/fetcher.ts';

import type { Response } from '../../../../lib/src/networking.ts';

const Params = Type.Object({
  url: Type.String(),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  body: Type.Optional(Type.String()),
  timeout: Type.Optional(Type.Number()),
  method: Type.Optional(Type.Union([Type.Literal('GET'), Type.Literal('POST')])),
  cancelBeforeRequest: Type.Optional(Type.Boolean()),
  cancelAfterRequest: Type.Optional(Type.Boolean()),
  cancelAfterFirstChunk: Type.Optional(Type.Boolean()),
});

type FetchResult = [{ status: number; headers: Record<string, string>; body: string } | { error: string }, null];

async function handleTestingFetchChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<FetchResult> {
  const fetcher = new EditorFetcher(ctx);
  const abortController = fetcher.makeAbortController();
  const signal = abortController.signal;

  const { url, cancelBeforeRequest, cancelAfterRequest, cancelAfterFirstChunk, ...options } = params;

  if (cancelBeforeRequest) {
    abortController.abort();
  }

  const responsePromise = fetcher.fetch(url, { signal, ...options });

  if (cancelAfterRequest) {
    abortController.abort();
  }

  let response: Response;
  try {
    response = await responsePromise;
  } catch (e: any) {
    return [{ error: `Fetch request error: ${e.message}` }, null];
  }

  const { status } = response;
  const headers = Object.fromEntries(Array.from(response.headers));

  try {
    if (cancelAfterFirstChunk) {
      const stream = await response.body();
      for await (const chunk of stream) {
        const body = chunk.toString();
        abortController.abort();
        return [{ status, headers, body }, null];
      }
    }

    const body = await response.text();
    return [{ status, headers, body }, null];
  } catch (e: any) {
    return [{ error: `Fetch stream error: ${e.message}` }, null];
  }
}

const handleTestingFetch = addMethodHandlerValidation(Params, handleTestingFetchChecked);

export { handleTestingFetch };
