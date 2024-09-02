import { v4 as uuidv4 } from 'uuid';
import type { Model } from '../../../../types.ts';

import { Context } from '../../../../context.ts';
import { CancellationToken } from '../../../../../../agent/src/cancellation.ts';
import { getTokenizer } from '../../../../../../prompt/src/tokenization/tokenizer.ts';
import { NetworkConfiguration } from '../../../../networkConfiguration.ts';
import { CopilotTokenManager } from '../../../../auth/copilotTokenManager.ts';
import { postRequest, Response } from '../../../../networking.ts';

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
  const endpoint = ctx.get<NetworkConfiguration>(NetworkConfiguration).getEmbeddingsUrl(ctx);
  const secretKey = (await ctx.get<CopilotTokenManager>(CopilotTokenManager).getCopilotToken(ctx)).token;
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
    { input, model: modelId },
    cancellationToken
  );

  if (response.status === 200 && !cancellationToken.isCancellationRequested) {
    try {
      const responseData: any = await response.json();
      return responseData.data.map((embedding: any) => ({
        id: batch[embedding.index].id,
        embedding: embedding.embedding,
      }));
    } catch (error) {}
  }
}

export { fetchEmbeddings };
