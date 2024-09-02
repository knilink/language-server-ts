import os from 'os';

import SHA256 from 'crypto-js/sha256.js';
import Utf16 from 'crypto-js/enc-utf16.js';

import { Context } from '../context.ts';
import { TelemetryUserConfig } from './userConfig.ts';
import { EditorAndPluginInfo, BuildInfo, EditorSession, formatNameAndVersion } from '../config.ts';

// Params from ../../../agent/src/methods/telemetryTrack.ts
type ExceptionDetail = {
  type?: string;
  value?: string;
  stacktrace?: {
    filename?: string;
    function?: string;
    lineno?: string | number;
    colno?: string | number;
    in_app?: boolean;
  }[];
};

// ../../../agent/src/methods/telemetryTrack.ts
type Payload = {
  app: 'copilot-client' | 'copilot-intellij' | 'copilot-vim' | 'copilot-vs';
  rollup_id: 'auto' | string; // sha256
  platform: 'node' | string; // ../../../agent/src/methods/telemetryTrack.ts
  release?: string;
  deployed_to: string;
  catalog_service:
    | 'CopilotCompletionsVSCode'
    | 'CopilotLanguageServer'
    | 'CopilotIntelliJ'
    | 'CopilotVim'
    | 'CopilotVS';
  context: {
    '#editor': string;
    '#editor_version': string;
    '#plugin': string;
    '#plugin_version': string;
    '#session_id': string;
    '#machine_id': string;
    '#architecture': string;
    '#os_platform': string;
    user?: string; // '#tracking_id'
    '#tracking_id'?: string;
    '#origin'?: string;
    'copilot_event.unique_id'?: string;
    '#restricted_telemetry'?: 'true' | 'false';
  };
  exception_detail?: ExceptionDetail[];
  sensitive_context: {};
  transaction?: string;
  created?: string; // ISOString
};

const frameRegexp = /^(\s+at)?(.*?)(@|\s\(|\s)([^(\n]+?)(:\d+)?(:\d+)?(\)?)$/;

function buildExceptionDetail(error: Error): ExceptionDetail {
  let exceptionDetail: ExceptionDetail = { type: error.name, value: error.message };
  const originalStack = error.stack?.replace(/^.*?:\d+\n.*\n *\^?\n\n/, '');

  if (originalStack?.startsWith(error.toString() + '\n')) {
    exceptionDetail.stacktrace = [];
    const stackLines = originalStack.split('\n').reverse();

    for (const line of stackLines) {
      const match = line.match(frameRegexp);
      if (match) {
        const [, , functionName, , filePath, lineNumber, columnNumber] = match;
        const filename = filePath?.trim() || '';
        exceptionDetail.stacktrace?.push({
          filename,
          function: functionName?.trim().replace(/^[^.]{1,2}(\.|$)/, '_$1') || '',
          lineno: lineNumber !== ':0' ? lineNumber.slice(1) : undefined,
          colno: lineNumber !== ':0' ? columnNumber.slice(1) : undefined,
          in_app: !/[[<:]|(?:^|\/)node_modules\//.test(filename),
        });
      }
    }
  }

  return exceptionDetail;
}

function buildContext(ctx: Context, extraProperties?: Record<string, string>): Payload['context'] {
  const epInfo = ctx.get(EditorAndPluginInfo);
  const editorInfo = epInfo.getEditorInfo();
  const telemetryConfig = ctx.get(TelemetryUserConfig);
  const session = ctx.get(EditorSession) as EditorSession;

  const context: Payload['context'] = {
    '#editor': editorInfo.devName ?? editorInfo.name,
    '#editor_version': formatNameAndVersion({
      name: editorInfo.devName ?? editorInfo.name,
      version: editorInfo.version,
    }),
    '#plugin': epInfo.getEditorPluginInfo().name,
    '#plugin_version': formatNameAndVersion(epInfo.getEditorPluginInfo()),
    '#session_id': session.sessionId,
    '#machine_id': session.machineId,
    '#architecture': os.arch(),
    '#os_platform': os.platform(),
    ...extraProperties,
  };

  if (telemetryConfig.trackingId) {
    context.user = telemetryConfig.trackingId;
    context['#tracking_id'] = telemetryConfig.trackingId;
  }

  return context;
}

function buildPayload(ctx: Context, redactedError: unknown) {
  const buildInfo = ctx.get<BuildInfo>(BuildInfo);
  const editorInfo = ctx.get<EditorAndPluginInfo>(EditorAndPluginInfo).getEditorInfo();

  const payload: Payload = {
    app: 'copilot-client',
    rollup_id: 'auto',
    platform: 'node',
    release: buildInfo.getBuildType() !== 'dev' ? `copilot-client@${buildInfo.getVersion()}` : undefined,
    deployed_to: buildInfo.getBuildType(),
    catalog_service: editorInfo.name === 'vscode' ? 'CopilotCompletionsVSCode' : 'CopilotLanguageServer',
    context: buildContext(ctx, { '#node_version': process.versions.node }),
    sensitive_context: {},
  };

  const exceptionsWithDetails: [Error, ExceptionDetail][] = [];
  payload.exception_detail = [];
  let i = 0;
  let exception: any = redactedError; // MARK: any

  while (exception instanceof Error && i < 10) {
    const detail = buildExceptionDetail(exception);
    payload.exception_detail.unshift(detail);
    exceptionsWithDetails.unshift([exception, detail]);
    i += 1;
    exception = (exception as any).cause as any; // MARK: any
  }

  const rollup: string[] = [];
  for (let [exception, detail] of exceptionsWithDetails) {
    if (detail.stacktrace && detail.stacktrace.length > 0) {
      rollup.push(`${detail.type}: ${(exception as any).code ?? ''}`);
      let stacktrace = [...detail.stacktrace].reverse();
      for (let frame of stacktrace) if (frame.filename?.startsWith('./dist/')) return payload;
      for (let frame of stacktrace)
        if (frame.in_app) {
          rollup.push(`${frame.filename?.replace(/^\.\//, '')}:${frame.lineno}:${frame.colno}`);
          break;
        }
      rollup.push(`${stacktrace[0].filename?.replace(/^\.\//, '')}`);
    } else return payload;
  }

  if (payload.exception_detail.length > 0) {
    payload.rollup_id = SHA256(Utf16.parse(rollup.join('\n'))).toString();
  }

  return payload;
}

export { buildPayload, Payload, buildContext };
