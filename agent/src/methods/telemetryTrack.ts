import { Type, type Static } from '@sinclair/typebox';
import { Payload } from '../../../lib/src/telemetry/failbot';
import { Context } from '../../../lib/src/context';
import { BuildInfo, EditorAndPluginInfo } from '../../../lib/src/config';
import { buildContext } from '../../../lib/src/telemetry/failbot';
import { telemetryException } from '../../../lib/src/telemetry';
import { addMethodHandlerValidation } from '../schemaValidation';
import { CancellationToken } from '../cancellation';

const Params = Type.Object({
  transaction: Type.Optional(Type.String()),
  stacktrace: Type.Optional(Type.String()),
  properties: Type.Optional(Type.Record(Type.String(), Type.String())),
  platform: Type.Optional(Type.String()),
  exception_detail: Type.Optional(
    Type.Array(
      Type.Object({
        type: Type.Optional(Type.String()),
        value: Type.Optional(Type.String()),
        stacktrace: Type.Optional(
          Type.Array(
            Type.Object({
              filename: Type.Optional(Type.String()),
              lineno: Type.Optional(Type.Union([Type.String(), Type.Integer()])),
              colno: Type.Optional(Type.Union([Type.String(), Type.Integer()])),
              function: Type.Optional(Type.String()),
              in_app: Type.Optional(Type.Boolean()),
            })
          )
        ),
      })
    )
  ),
});

const plugins: Record<
  EditorAndPluginInfo.EditorPluginInfo['name'],
  {
    app: 'copilot-intellij' | 'copilot-vim' | 'copilot-vs';
    catalog_service: 'CopilotIntelliJ' | 'CopilotVim' | 'CopilotVS';
  }
> = {
  'copilot-intellij': { app: 'copilot-intellij', catalog_service: 'CopilotIntelliJ' },
  'copilot.vim': { app: 'copilot-vim', catalog_service: 'CopilotVim' },
  'copilot-vs': { app: 'copilot-vs', catalog_service: 'CopilotVS' },
};

type Params = Static<typeof Params>;

class AgentEditorError extends Error {
  name = 'AgentEditorError';
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
  }
}

async function handleTelemetryExceptionChecked(
  ctx: Context,
  token: CancellationToken,
  params: Params
): Promise<[string | null, null]> {
  const buildInfo = ctx.get(BuildInfo);
  const pluginInfo = ctx.get(EditorAndPluginInfo).getEditorPluginInfo();
  const properties = params.properties || {};
  let failbotPayload: Payload | undefined;

  if (params.platform && params.exception_detail && pluginInfo.name in plugins) {
    failbotPayload = {
      rollup_id: 'auto',
      context: buildContext(ctx),
      sensitive_context: {},
      deployed_to: buildInfo.getBuildType(),
      platform: params.platform,
      exception_detail: params.exception_detail,
      ...plugins[pluginInfo.name],
    };

    if (params.transaction) {
      failbotPayload = { ...failbotPayload, transaction: params.transaction };
    }

    if (buildInfo.getBuildType() !== 'dev') {
      failbotPayload = { ...failbotPayload, release: `${failbotPayload.app}@${pluginInfo.version}` };
    }
  }

  const error = new AgentEditorError(params.stacktrace ?? 'N/A', pluginInfo.name);
  (error as any).stack = undefined;

  await telemetryException(ctx, error, undefined, properties, failbotPayload);
  return ['OK', null];
}

const handleTelemetryException = addMethodHandlerValidation(Params, handleTelemetryExceptionChecked);

export { Params, plugins, AgentEditorError, handleTelemetryException };
