import type { Model } from '../../../../types.ts';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../../../context.ts';
import type { Response } from '../../../../networking.ts';

import { LocalSnippetProviderError } from './LocalSnippetProvider.ts';
import { CopilotTokenManager } from '../../../../auth/copilotTokenManager.ts';
import { NetworkConfiguration } from '../../../../networkConfiguration.ts';
import { postRequest } from '../../../../networking.ts';
import { telemetryException } from '../../../../telemetry.ts';
import { v4 as uuidv4 } from 'uuid';
import { getTokenizer } from '../../../../../../prompt/src/tokenization/tokenizer.ts';
import type {} from '../../../../../../prompt/src/tokenization/index.ts';

type Input = {
  id: string;
  text: string;
};

type Output = {
  id: string;
  embedding: number[];
};

async function fetchEmbeddings(
  ctx: Context,
  modelConfiguration: Model.EmbeddingModelConfig,
  inputs: Input[],
  cancellationToken: CancellationToken
): Promise<Output[] | undefined> {
  const tokenizer = getTokenizer(modelConfiguration.tokenizer);
  const validInputs = inputs.filter((input) => tokenizer.tokenLength(input.text) < modelConfiguration.maxTokens);

  if (validInputs.length === 0) return;

  const output: Output[] = [];
  const endpoint = ctx.get(NetworkConfiguration).getEmbeddingsUrl(ctx);
  const secretKey = (await ctx.get(CopilotTokenManager).getToken()).token;
  let idx = 0;

  while (idx < validInputs.length && !cancellationToken.isCancellationRequested) {
    const batch = validInputs.slice(idx, idx + modelConfiguration.maxBatchSize);
    const response = await sendEmbeddingsRequest(
      ctx,
      endpoint,
      secretKey,
      modelConfiguration.modelId,
      batch,
      cancellationToken
    );
    if (response) {
      output.push(...response);
    }
    idx += modelConfiguration.maxBatchSize;
  }

  return output.length ? output : undefined;
}

async function sendEmbeddingsRequest(
  ctx: Context,
  endpoint: string,
  secretKey: string,
  modelId: string,
  batch: Input[],
  cancellationToken: CancellationToken
): Promise<Output[] | undefined> {
  const requestId = uuidv4();
  const input = batch.map((item) => item.text);
  const response: Response = await postRequest(
    ctx,
    endpoint,
    secretKey,
    undefined,
    requestId,
    { input, model: modelId, dimensions: 1024 },
    cancellationToken
  );

  if (response.status !== 200 || cancellationToken.isCancellationRequested) {
    telemetryException(
      ctx,
      new LocalSnippetProviderError(`Failed to request dense embeddings, status: ${response.status}`),
      'LocalSnippetProvider.fetchEmbeddings'
    );
    return;
  }
  try {
    return ((await response.json()) as any).data.map((embedding: any) => ({
      id: batch[embedding.index].id,
      embedding: embedding.embedding,
    })) as Output[];
  } catch {
    return;
  }
}

export { fetchEmbeddings };
