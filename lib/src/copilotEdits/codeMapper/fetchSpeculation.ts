import type { Static } from '@sinclair/typebox';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../context.ts';

import { Features } from '../../experiments/features.ts';
import { getProxyURLWithPath } from '../../openai/config.ts';
import { OpenAIFetcher } from '../../openai/fetch.ts';
import { Type } from '@sinclair/typebox';

const SpeculationFetchParam = Type.Object({
  prompt: Type.String(),
  speculation: Type.String(),
  languageId: Type.String(),
  stops: Type.Array(Type.String()),
});

type SpeculationFetchParamType = Static<typeof SpeculationFetchParam>;

class SpeculationFetcher {
  constructor(readonly ctx: Context) {}
  async fetchSpeculation(params: SpeculationFetchParamType, ct: CancellationToken) {
    const engineUrl = getProxyURLWithPath(this.ctx, '/v1/engines/copilot-centralus-h100');
    const speculationParams: OpenAIFetcher.SpeculationParams = {
      prompt: params.prompt,
      speculation: params.speculation,
      engineUrl,
      uiKind: 'editsPanel',
      temperature: 0,
      stream: true,
      stops: params.stops,
    };
    const telemetryWithExp = await this.ctx.get(Features).updateExPValuesAndAssignments();
    const res = await this.ctx
      .get(OpenAIFetcher)
      .fetchAndStreamSpeculation(this.ctx, speculationParams, telemetryWithExp, async (text, delta) => undefined, ct);
    if (res.type != 'success') {
      throw new Error(`Failed to fetch speculation: ${res.type} - ${res.reason || 'Unknown error'}`);
    }
    return res;
  }
}

export { SpeculationFetcher };
