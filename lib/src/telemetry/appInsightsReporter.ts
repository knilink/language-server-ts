import os from 'node:os';
import { BreezeChannelIdentifier } from '@microsoft/applicationinsights-common';
import { ApplicationInsights } from '@microsoft/applicationinsights-web-basic';
import { Disposable } from 'vscode-languageserver/node.js';

import { IReporter, TelemetryProperties, TelemetryMeasurements } from '../types.ts';
import { Context } from '../context.ts';
import { onCopilotToken } from '../auth/copilotTokenNotifier.ts';

import { logger } from '../logger.ts';
// import { } from '../telemetry';
import { EditorSession, BuildInfo } from '../config.ts';
import { Fetcher, Request, Response } from '../networking.ts';
import { NetworkConfiguration } from '../networkConfiguration.ts';

import { TelemetryUserConfig } from '../telemetry/userConfig.ts';
import { CopilotToken } from '../auth/copilotToken.ts';

type Tags = Partial<{
  'ai.user.id': string;
  'ai.session.id': string;
  'ai.cloud.roleInstance': string;
  'ai.device.osVersion': string;
  'ai.device.osArchitecture': string;
  'ai.device.osPlatform': string;
  'ai.cloud.role': 'Web';
  'ai.application.ver': string;
}>;

function getTags(ctx: Context): Tags {
  let tags: Tags = {};
  const editorSession = ctx.get(EditorSession);
  tags['ai.session.id'] = editorSession.sessionId;

  const telemetryConfig = ctx.get(TelemetryUserConfig);
  if (telemetryConfig.trackingId) {
    tags['ai.user.id'] = telemetryConfig.trackingId;
  }

  tags['ai.cloud.roleInstance'] = 'REDACTED';
  tags['ai.device.osVersion'] = `${os.type()} ${os.release()}`;
  tags['ai.device.osArchitecture'] = os.arch();
  tags['ai.device.osPlatform'] = os.platform();
  tags['ai.cloud.role'] = 'Web';
  tags['ai.application.ver'] = ctx.get(BuildInfo).getVersion();

  return tags;
}

function getCommonProperties(ctx: Context): Record<string, string> {
  const properties: Record<string, string> = {};
  properties.common = os.platform();
  properties.common_platformversion = os.release();
  properties.common_arch = os.arch();
  properties.common_cpu = Array.from(new Set(os.cpus().map((c) => c.model))).join();

  const editorSession = ctx.get(EditorSession);
  properties.common_vscodemachineid = editorSession.machineId;
  properties.common_vscodesessionid = editorSession.sessionId;
  properties.common_uikind = editorSession.uiKind;
  properties.common_remotename = editorSession.remoteName;
  properties.common_isnewappinstall = '';

  return properties;
}

class AppInsightsReporter implements IReporter {
  // explicitly private
  private client: ApplicationInsights;
  private tags: Tags;
  private commonProperties: Record<string, string>;
  private token?: CopilotToken;
  private onCopilotToken: (token: CopilotToken) => void;
  private _onCopilotToken: Disposable;

  constructor(
    private ctx: Context,
    private namespace: string,
    key: string,
    private includeAuthorizationHeader: boolean = false
  ) {
    this.onCopilotToken = (copilotToken: CopilotToken) => {
      this.token = copilotToken;
      const userId = copilotToken.getTokenValue('tid');
      if (userId) {
        this.tags['ai.user.id'] = userId;
      }
    };

    this.client = new ApplicationInsights({
      instrumentationKey: key,
      disableAjaxTracking: true,
      disableExceptionTracking: true,
      disableFetchTracking: true,
      disableCorrelationHeaders: true,
      disableCookiesUsage: true,
      autoTrackPageVisitTime: false,
      emitLineDelimitedJson: false,
      disableInstrumentationKeyValidation: true,
      endpointUrl: ctx.get(NetworkConfiguration).getTelemetryUrl(),
      extensionConfig: {
        [BreezeChannelIdentifier]: { alwaysUseXhrOverride: true, httpXHROverride: this.xhrOverride },
      },
    });

    this.tags = getTags(ctx);
    this.commonProperties = getCommonProperties(ctx);
    this._onCopilotToken = onCopilotToken(ctx, this.onCopilotToken);
  }

  private xhrOverride = {
    sendPOST: (
      payload: { data: unknown; urlString: string; headers?: Request['headers'] },
      oncomplete: (responseStatus: Response['status'], responseHeaders?: Record<string, string>, text?: string) => void
    ) => {
      if (typeof payload.data !== 'string')
        throw new Error(`AppInsightsReporter only supports string payloads, received ${typeof payload.data}`);
      let headers = payload.headers ?? {};
      headers['Content-Type'] = 'application/json';
      if (this.includeAuthorizationHeader && this.token) {
        headers.Authorization = `Bearer ${this.token.token}`;
      }
      let options: Request = { method: 'POST', headers: headers, body: payload.data };
      this.ctx
        .get(Fetcher)
        .fetch(payload.urlString, options)
        .then((response) =>
          response.text().then((text: string) => {
            oncomplete(response.status, Object.fromEntries(response.headers), text);
          })
        )
        .catch((err: unknown) => {
          logger.errorWithoutTelemetry(this.ctx, 'Error sending telemetry', err);
          oncomplete(0); // was oncomplete(0, {});
        });
    },
  };

  sendTelemetryEvent(eventName: string, properties?: TelemetryProperties, measurements?: TelemetryMeasurements): void {
    properties = { ...properties, ...this.commonProperties };
    const name = this.qualifyEventName(eventName);
    this.client.track({
      name,
      tags: this.tags,
      data: { ...properties, ...this.commonProperties, ...measurements },
      baseType: 'EventData',
      baseData: { name, properties, measurements },
    });
  }

  sendTelemetryErrorEvent(
    eventName: string,
    properties?: TelemetryProperties,
    measurements?: TelemetryMeasurements
  ): void {
    this.sendTelemetryEvent(this.qualifyEventName(eventName), properties, measurements);
  }

  async dispose(): Promise<void> {
    this._onCopilotToken.dispose();
    await this.client.unload(true, undefined, 200);
  }

  private qualifyEventName(eventName: string): string {
    return eventName.startsWith(this.namespace) ? eventName : `${this.namespace}/${eventName}`;
  }
}

export { AppInsightsReporter };
