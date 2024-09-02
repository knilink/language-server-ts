import { Type } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { v4 as uuidv4 } from 'uuid';
import SHA256 from "crypto-js/sha256.js";
import Utf16 from "crypto-js/enc-utf16.js";
import { ConnectionError, ResponseError } from 'vscode-languageserver-protocol';

import {
  Replacement,
  TelemetryProperties,
  TelemetryMeasurements,
  TelemetryStore,
  IReporter,
  OpenAIRequestId,
  JsonData,
  TelemetryRawProperties,
} from './types.ts';
import { Prompt } from '../../prompt/src/types.ts';

import { Context } from './context.ts';

import { buildPayload, Payload } from './telemetry/failbot.ts';
import { ExceptionRateLimiter } from './telemetry/rateLimiter.ts';
import { FilterSettings } from './experiments/filters.ts';
import { TelemetryUserConfig } from './telemetry/userConfig.ts';
import { CopilotAuthError } from './auth/error.ts';
import { FailingTelemetryReporter } from './testing/telemetry.ts';
import { PromiseQueue } from './util/promiseQueue.ts';
// import { } from './experiments/telemetryNames';
import {
  EditorAndPluginInfo,
  formatNameAndVersion,
  EditorSession,
  getVersion,
  dumpForTelemetry,
  getBuild,
  getBuildType,
} from './config.ts';
import { redactMessage, redactError, prepareErrorForRestrictedTelemetry } from './util/redaction.ts';
import { shouldFailForDebugPurposes } from './testing/runtimeMode.ts';
import { isNetworkError, Fetcher } from './networking.ts';
import { Features } from './experiments/features.ts';
import { ExpConfig } from './experiments/expConfig.ts';

type IncludeExp = 'SkipExp' | 'IncludeExp';

const propertiesSchema = Type.Object({}, { additionalProperties: Type.String() });

const measurementsSchema = Type.Object(
  {
    meanLogProb: Type.Optional(Type.Number()),
    meanAlternativeLogProb: Type.Optional(Type.Number()),
  },
  {
    additionalProperties: Type.Number(),
  }
);

const ftTelemetryEvents = [
  'engine.prompt',
  'engine.completion',
  'ghostText.capturedAfterAccepted',
  'ghostText.capturedAfterRejected',
];

const oomCodes = new Set(['ERR_WORKER_OUT_OF_MEMORY', 'ENOMEM']);

function isRestricted(store: TelemetryStore) {
  return store === TelemetryStore.RESTRICTED;
}

function isOomError(error: any) {
  return (
    oomCodes.has(error.code ?? '') ||
    (error.name === 'RangeError' && error.message === 'WebAssembly.Memory(): could not allocate memory')
  );
}

function getErrorType(error: any): 'network' | 'local' | 'exception' {
  if (isNetworkError(error)) {
    return 'network';
  }
  const code: string | undefined = error.code;
  if (
    isOomError(error) ||
    code === 'EMFILE' ||
    code === 'ENFILE' ||
    (error.syscall === 'uv_cwd' && (code === 'ENOENT' || code == 'EIO')) ||
    code === 'CopilotPromptLoadFailure' ||
    code?.startsWith('CopilotPromptWorkerExit')
  ) {
    return 'local';
  }
  return 'exception';
}

function sendTelemetryEvent(
  ctx: Context,
  store: TelemetryStore,
  name: string,
  data: { properties: TelemetryRawProperties; measurements: TelemetryMeasurements }
): void {
  ctx
    .get(TelemetryReporters)
    .getReporter(ctx, store)
    ?.sendTelemetryEvent(
      name,
      TelemetryData.maybeRemoveRepoInfoFromPropertiesHack(store, data.properties),
      data.measurements
    );
}

function sendTelemetryErrorEvent(
  ctx: Context,
  store: TelemetryStore,
  name: string,
  data: { properties: TelemetryProperties; measurements: TelemetryMeasurements }
): void {
  ctx
    .get(TelemetryReporters)
    .getReporter(ctx, store)
    ?.sendTelemetryErrorEvent(
      name,
      TelemetryData.maybeRemoveRepoInfoFromPropertiesHack(store, data.properties),
      data.measurements
    );
}

function sendFTTelemetryEvent(
  ctx: Context,
  store: TelemetryStore,
  name: string,
  data: { properties: TelemetryProperties; measurements: TelemetryMeasurements }
): void {
  ctx
    .get(TelemetryReporters)
    .getFTReporter(ctx)
    ?.sendTelemetryEvent(
      name,
      TelemetryData.maybeRemoveRepoInfoFromPropertiesHack(store, data.properties),
      data.measurements
    );
}

function telemetrizePromptLength(prompt: {
  prefix: string;
  suffix: string;
  isFimEnabled: boolean;
}): TelemetryMeasurements {
  return prompt.isFimEnabled
    ? { promptPrefixCharLen: prompt.prefix.length, promptSuffixCharLen: prompt.suffix.length }
    : { promptCharLen: prompt.prefix.length };
}

function now() {
  return Date.now();
}

function nowSeconds() {
  return Math.floor(now() / 1000);
}

function shouldSendRestricted(ctx: Context) {
  return ctx.get(TelemetryUserConfig).optedIn;
}

function shouldSendFinetuningTelemetry(ctx: Context) {
  return ctx.get(TelemetryUserConfig).ftFlag !== '';
}

// telemetry(ctx, 'networking.disconnectAll');
async function telemetry(ctx: Context, name: string, telemetryData?: TelemetryData, store?: TelemetryStore) {
  await ctx.get(PromiseQueue).register(_telemetry(ctx, name, telemetryData, store));
}

async function _telemetry(
  ctx: Context,
  name: string,
  telemetryData?: TelemetryData,
  store: TelemetryStore = TelemetryStore.RESTRICTED
) {
  let definedTelemetryData = telemetryData || TelemetryData.createAndMarkAsIssued({}, {});
  await definedTelemetryData.makeReadyForSending(ctx, store ?? false, 'IncludeExp'); // TODO store ?? false ???
  if (!isRestricted(store) || shouldSendRestricted(ctx)) {
    sendTelemetryEvent(ctx, store, name, definedTelemetryData);
  }
  if (isRestricted(store) && ftTelemetryEvents.includes(name) && shouldSendFinetuningTelemetry(ctx)) {
    sendFTTelemetryEvent(ctx, store, name, definedTelemetryData);
  }
}

async function telemetryExpProblem(ctx: Context, telemetryProperties: TelemetryProperties) {
  await ctx.get(PromiseQueue).register(_telemetryExpProblem(ctx, telemetryProperties));
}

async function _telemetryExpProblem(ctx: Context, telemetryProperties: TelemetryProperties) {
  const definedTelemetryData = TelemetryData.createAndMarkAsIssued(telemetryProperties, {});
  await definedTelemetryData.makeReadyForSending(ctx, TelemetryStore.OPEN, 'SkipExp');
  sendTelemetryEvent(ctx, TelemetryStore.OPEN, 'expProblem', definedTelemetryData);
}

async function telemetryRaw(
  ctx: Context,
  name: string,
  properties: TelemetryRawProperties,
  measurements: TelemetryMeasurements
) {
  await ctx.get(PromiseQueue).register(_telemetryRaw(ctx, name, properties, measurements));
}

async function _telemetryRaw(
  ctx: Context,
  name: string,
  properties: TelemetryRawProperties,
  measurements: TelemetryMeasurements
) {
  addRequiredProperties(ctx, properties);
  sendTelemetryEvent(ctx, TelemetryStore.OPEN, name, { properties, measurements });
}

function addRequiredProperties(ctx: Context, properties: TelemetryRawProperties) {
  properties.unique = uuidv4();
  let editorInfo = ctx.get(EditorAndPluginInfo);
  properties.common_extname = editorInfo.getEditorPluginInfo().name;
  properties.common_extversion = editorInfo.getEditorPluginInfo().version;
  properties.common_vscodeversion = formatNameAndVersion(editorInfo.getEditorInfo());
}

async function telemetryException(
  ctx: Context,
  maybeError: unknown,
  transaction?: string,
  properties?: TelemetryProperties,
  failbotPayload?: Payload
) {
  let error;
  if (maybeError instanceof Error) {
    error = maybeError;
    if (
      (error.name === 'Canceled' && error.message === 'Canceled') ||
      error.name === 'CodeExpectedError' ||
      error instanceof CopilotAuthError ||
      error instanceof ConnectionError ||
      error instanceof ResponseError
    )
      return;
  } else {
    error = new CopilotNonError(maybeError);
    if ((maybeError as any)?.name === 'ExitStatus') return;
    if (error.stack?.startsWith(`${error}\n`)) {
      let frames = error.stack.slice(`${error}\n`.length).split(`\n`);
      if (/^\s*(?:at )?(?:\w+\.)*telemetryException\b/.test(frames[0])) {
        frames.shift();
      }
      error.stack = `${error}\n${frames.join(`\n`)}`;
    }
  }
  await ctx.get(PromiseQueue).register(_telemetryException(ctx, error, transaction, properties, failbotPayload));
}

async function _telemetryException(
  ctx: Context,
  error: unknown,
  transaction?: string,
  properties?: TelemetryProperties,
  failbotPayload?: Payload
) {
  const editorInfo = ctx.get(EditorAndPluginInfo).getEditorInfo();
  let stackPaths: Replacement[] | undefined;
  if (editorInfo.root) {
    stackPaths = [{ prefix: `${editorInfo.name}:`, path: editorInfo.root }];
  }
  const redactedError = redactError(error, stackPaths);
  const sendRestricted = shouldSendRestricted(ctx);
  const errorType = getErrorType(error);
  const sendAsException = errorType === 'exception';
  const definedTelemetryDataStub = TelemetryData.createAndMarkAsIssued({
    origin: transaction ?? '',
    type: (error as any).name,
    code: `${(error as any).code ?? ''}`,
    reason: redactedError.stack || redactedError.toString(),
    message: redactedError.message,
    ...properties,
  });
  await definedTelemetryDataStub.makeReadyForSending(ctx, 0, 'IncludeExp');
  if (failbotPayload?.exception_detail) {
    for (let ed of failbotPayload.exception_detail) {
      if (ed.value) {
        if (sendRestricted) {
          ed.value = redactMessage(ed.value);
        } else {
          ed.value = '[redacted]';
        }
      }
    }
  }
  if (!failbotPayload) {
    failbotPayload = buildPayload(ctx, redactError(error, stackPaths, sendRestricted));
  }

  failbotPayload.context = {
    ...failbotPayload.context,
    'copilot_event.unique_id': definedTelemetryDataStub.properties.unique,
    '#restricted_telemetry': sendRestricted ? 'true' : 'false',
  };
  if (transaction) {
    failbotPayload.context['#origin'] = transaction;
    failbotPayload.transaction = transaction;
  }
  if (failbotPayload.rollup_id !== 'auto') {
    definedTelemetryDataStub.properties.errno = failbotPayload.rollup_id;
  }

  failbotPayload.created = new Date(definedTelemetryDataStub.issuedTime).toISOString();

  if (sendRestricted) {
    let restrictedError = prepareErrorForRestrictedTelemetry(error, stackPaths);
    let definedTelemetryDataRestricted = TelemetryData.createAndMarkAsIssued({
      origin: transaction != null ? transaction : '',
      type: (error as any).name,
      code: `${(error as any).code ?? ''}`,
      reason: restrictedError.stack || restrictedError.toString(),
      message: restrictedError.message,
      ...properties,
    });
    if (failbotPayload.rollup_id !== 'auto') {
      definedTelemetryDataRestricted.properties.errno = failbotPayload.rollup_id;
    }
    await definedTelemetryDataRestricted.makeReadyForSending(ctx, 1, 'IncludeExp'); // TODO 1 -> Store.RESTRICTED
    definedTelemetryDataRestricted.properties.unique = definedTelemetryDataStub.properties.unique;
    definedTelemetryDataStub.properties.restricted_unique = definedTelemetryDataRestricted.properties.unique;
    sendTelemetryEvent(ctx, TelemetryStore.RESTRICTED, `error.${errorType}`, definedTelemetryDataRestricted);
  }
  let cacheKey = failbotPayload.rollup_id === 'auto' ? ((error as any).stack ?? '') : failbotPayload.rollup_id;
  if (sendAsException && !ctx.get(ExceptionRateLimiter).isThrottled(cacheKey)) {
    definedTelemetryDataStub.properties.failbot_payload = JSON.stringify(failbotPayload);
  }
  sendTelemetryEvent(ctx, TelemetryStore.OPEN, `error.${errorType}`, definedTelemetryDataStub);
}

async function telemetryError(ctx: Context, name: string, telemetryData?: TelemetryData, store?: TelemetryStore) {
  await ctx.get(PromiseQueue).register(_telemetryError(ctx, name, telemetryData, store));
}

async function _telemetryError(ctx: Context, name: string, telemetryData?: TelemetryData, store = TelemetryStore.OPEN) {
  if (isRestricted(store) && !shouldSendRestricted(ctx)) return;
  let definedTelemetryData = telemetryData || TelemetryData.createAndMarkAsIssued({}, {});
  await definedTelemetryData.makeReadyForSending(ctx, store, 'IncludeExp');
  sendTelemetryErrorEvent(ctx, store, name, definedTelemetryData);
}

async function logEngineCompletion(
  ctx: Context,
  completionText: string,
  jsonData: JsonData,
  requestId: OpenAIRequestId,
  // ./openai/openai.ts
  choiceIndex: number
) {
  let telemetryData = TelemetryData.createAndMarkAsIssued({
    completionTextJson: JSON.stringify(completionText),
    choiceIndex: choiceIndex.toString(),
  });
  if (jsonData.logprobs)
    for (let [key, value] of Object.entries(jsonData.logprobs)) {
      // telemetryData.properties['logprobs_' + key] = (_a = JSON.stringify(value)) != null ? _a : 'unset'; // MARK ???
      telemetryData.properties['logprobs_' + key] = JSON.stringify(value);
    }

  telemetryData.extendWithRequestId(requestId);
  await telemetry(ctx, 'engine.completion', telemetryData, TelemetryStore.RESTRICTED);
}

async function logEnginePrompt(ctx: Context, prompt: Prompt, telemetryData: TelemetryData) {
  const promptTelemetry: TelemetryProperties = prompt.isFimEnabled
    ? {
      promptPrefixJson: JSON.stringify(prompt.prefix),
      promptSuffixJson: JSON.stringify(prompt.suffix),
      promptElementRanges: JSON.stringify(prompt.promptElementRanges),
    }
    : {
      promptJson: JSON.stringify(prompt.prefix),
      promptElementRanges: JSON.stringify(prompt.promptElementRanges),
    };

  const telemetryDataWithPrompt = telemetryData.extendedBy(promptTelemetry);
  await telemetry(ctx, 'engine.prompt', telemetryDataWithPrompt, 1);
}

class TelemetryReporters {
  reporter?: IReporter;
  reporterRestricted?: IReporter;
  reporterFT?: IReporter;

  getReporter(ctx: Context, store: TelemetryStore = TelemetryStore.OPEN) {
    return isRestricted(store) ? this.getRestrictedReporter(ctx) : this.reporter;
  }
  getRestrictedReporter(ctx: Context) {
    if (shouldSendRestricted(ctx)) return this.reporterRestricted;
    if (shouldFailForDebugPurposes(ctx)) return new FailingTelemetryReporter();
  }
  getFTReporter(ctx: Context) {
    if (shouldSendFinetuningTelemetry(ctx)) return this.reporterFT;
    if (shouldFailForDebugPurposes(ctx)) return new FailingTelemetryReporter();
  }
  setReporter(reporter: IReporter) {
    this.reporter = reporter;
  }
  setRestrictedReporter(reporter: IReporter) {
    this.reporterRestricted = reporter;
  }
  setFTReporter(reporter: IReporter) {
    this.reporterFT = reporter;
  }
  async deactivate() {
    const promises = [this.reporter?.dispose(), this.reporterRestricted?.dispose(), this.reporterFT?.dispose()];
    this.reporter = undefined;
    this.reporterRestricted = undefined;
    this.reporterFT = undefined;
    await Promise.all(promises);
  }
}

class TelemetryData {
  static validateTelemetryProperties = TypeCompiler.Compile(propertiesSchema);

  static validateTelemetryMeasurements = TypeCompiler.Compile(measurementsSchema);

  static keysExemptedFromSanitization = ['abexp.assignmentcontext', 'VSCode.ABExp.Features'];

  static keysToRemoveFromStandardTelemetryHack = [
    'gitRepoHost',
    'gitRepoName',
    'gitRepoOwner',
    'gitRepoUrl',
    'gitRepoPath',
    'repo',
    'request_option_nwo',
    'userKind',
  ];

  displayedTime?: number;

  constructor(
    public properties: TelemetryProperties,
    public measurements: TelemetryMeasurements,
    public issuedTime: number
  ) { }

  static createAndMarkAsIssued(properties?: TelemetryProperties, measurements?: TelemetryMeasurements) {
    return new TelemetryData(properties || {}, measurements || {}, now());
  }

  // ghostText/ghostText.ts optional properties? measurements?
  extendedBy(properties?: TelemetryProperties, measurements?: TelemetryMeasurements) {
    const newProperties = { ...this.properties, ...properties };
    const newMeasurements = { ...this.measurements, ...measurements };
    const newData = new TelemetryData(newProperties, newMeasurements, this.issuedTime);
    newData.displayedTime = this.displayedTime;
    return newData;
  }
  markAsDisplayed() {
    if (!this.displayedTime) this.displayedTime = now();
  }
  async extendWithExpTelemetry(ctx: Context) {
    let { filters: filters, exp: exp } = await ctx.get(Features).getFallbackExpAndFilters();
    exp.addToTelemetry(this);
    filters.addToTelemetry(this);
  }
  extendWithEditorAgnosticFields(ctx: Context) {
    this.properties.editor_version = formatNameAndVersion(ctx.get(EditorAndPluginInfo).getEditorInfo());
    this.properties.editor_plugin_version = formatNameAndVersion(ctx.get(EditorAndPluginInfo).getEditorPluginInfo());
    const editorSession = ctx.get(EditorSession);
    this.properties.client_machineid = editorSession.machineId;
    this.properties.client_sessionid = editorSession.sessionId;
    this.properties.copilot_version = `copilot/${getVersion(ctx)}`;
    this.properties.runtime_version = `node/${process.versions.node}`;
    const editorInfo = ctx.get(EditorAndPluginInfo);
    this.properties.common_extname = editorInfo.getEditorPluginInfo().name;
    this.properties.common_extversion = editorInfo.getEditorPluginInfo().version;
    this.properties.common_vscodeversion = formatNameAndVersion(editorInfo.getEditorInfo());
    const fetcher = ctx.get(Fetcher);
    this.properties.fetcher = fetcher.name;
    const proxySettings = fetcher.proxySettings;
    this.properties.proxy_enabled = proxySettings ? 'true' : 'false';
    this.properties.proxy = proxySettings?.proxyAuth ? 'true' : 'false';
    this.properties.proxy_kerberos = proxySettings?.kerberosServicePrincipal ? 'true' : 'false';
    this.properties.reject_unauthorized = fetcher.rejectUnauthorized ? 'true' : 'false';
  }
  extendWithConfigProperties(ctx: Context) {
    let configProperties = dumpForTelemetry(ctx);
    configProperties['copilot.build'] = getBuild(ctx);
    configProperties['copilot.buildType'] = getBuildType(ctx);
    let telemetryConfig = ctx.get(TelemetryUserConfig);
    if (telemetryConfig.trackingId) {
      configProperties['copilot.trackingId'] = telemetryConfig.trackingId;
    }
    if (telemetryConfig.organizationsList) {
      configProperties.organizations = telemetryConfig.organizationsList;
    }
    if (telemetryConfig.enterpriseList) {
      configProperties.enterprise = telemetryConfig.enterpriseList;
    }
    if (telemetryConfig.sku) {
      configProperties.sku = telemetryConfig.sku;
    }
    this.properties = { ...this.properties, ...configProperties };
  }
  extendWithRequestId(requestId: OpenAIRequestId) {
    let requestProperties = {
      completionId: requestId.completionId,
      created: requestId.created.toString(),
      headerRequestId: requestId.headerRequestId,
      serverExperiments: requestId.serverExperiments,
      deploymentId: requestId.deploymentId,
    };
    this.properties = { ...this.properties, ...requestProperties };
  }
  static maybeRemoveRepoInfoFromPropertiesHack<T>(store: TelemetryStore, map: Record<string, T>): Record<string, T> {
    if (isRestricted(store)) return map;
    let returnValue: Record<string, T> = {};
    for (let key in map) {
      if (!TelemetryData.keysToRemoveFromStandardTelemetryHack.includes(key)) {
        returnValue[key] = map[key];
      }
    }
    return returnValue;
  }
  sanitizeKeys() {
    this.properties = TelemetryData.sanitizeKeys(this.properties);
    this.measurements = TelemetryData.sanitizeKeys(this.measurements);
    for (let key in this.measurements) {
      // MARK
      if (isNaN(this.measurements[key])) {
        delete this.measurements[key];
      }
    }
  }
  static sanitizeKeys<T>(map: Record<string, T>): Record<string, T> {
    map = map || {};
    let returnValue: Record<string, T> = {};
    for (let key in map) {
      let newKey = TelemetryData.keysExemptedFromSanitization.includes(key) ? key : key.replaceAll('.', '_');
      returnValue[newKey] = map[key];
    }
    return returnValue;
  }
  updateMeasurements() {
    let timeSinceIssued = now() - this.issuedTime;
    this.measurements.timeSinceIssuedMs = timeSinceIssued;
    if (this.displayedTime) {
      const timeSinceDisplayed = now() - this.displayedTime;
      this.measurements.timeSinceDisplayedMs = timeSinceDisplayed;
    }
    if (!this.measurements.current) {
      this.measurements.current = nowSeconds();
    }
  }
  validateData(ctx: Context, store: TelemetryStore) {
    let invalid: { problem: string; error: string } | undefined;
    if (!TelemetryData.validateTelemetryProperties.Check(this.properties)) {
      invalid = {
        problem: 'properties',
        error: JSON.stringify([...TelemetryData.validateTelemetryProperties.Errors(this.properties)]),
      };
    }
    if (!TelemetryData.validateTelemetryMeasurements.Check(this.measurements)) {
      let m_err = JSON.stringify([...TelemetryData.validateTelemetryMeasurements.Errors(this.measurements)]);
      if (!invalid) {
        invalid = { problem: 'measurements', error: m_err };
      } else {
        invalid.problem = 'both';
        invalid.error += `; ${m_err}`;
      }
    }
    if (!invalid) return true;
    if (shouldFailForDebugPurposes(ctx)) {
      throw new Error(
        `Invalid telemetry data: ${invalid.problem} ${invalid.error} properties=${JSON.stringify(this.properties)} measurements=${JSON.stringify(this.measurements)}`
      );
    }
    telemetryError(
      ctx,
      'invalidTelemetryData',
      // TODO wtf
      TelemetryData.createAndMarkAsIssued({
        // MARK, recursive and causing overflow if the result of this.makeReadyForSending fail the validation
        properties: JSON.stringify(this.properties),
        measurements: JSON.stringify(this.measurements),
        problem: invalid.problem,
        validationError: invalid.error,
      }),
      store
    );
    if (isRestricted(store)) {
      telemetryError(
        ctx,
        'invalidTelemetryData_in_secure',
        TelemetryData.createAndMarkAsIssued({
          problem: invalid.problem,
          requestId: this.properties.requestId ?? 'unknown',
        }),
        TelemetryStore.OPEN
      );
    }
    return false;
  }
  async makeReadyForSending(ctx: Context, store: TelemetryStore, includeExp: IncludeExp) {
    this.extendWithConfigProperties(ctx);
    this.extendWithEditorAgnosticFields(ctx);
    this.sanitizeKeys();
    if (includeExp === 'IncludeExp') {
      await this.extendWithExpTelemetry(ctx);
    }
    this.updateMeasurements();
    if (!this.validateData(ctx, store)) {
      this.properties.telemetry_failed_validation = 'true';
    }
    addRequiredProperties(ctx, this.properties);
  }
}

class TelemetryWithExp extends TelemetryData {
  filtersAndExp: {
    filters: FilterSettings;
    exp: ExpConfig;
  };

  constructor(
    properties: TelemetryProperties,
    measurements: TelemetryMeasurements,
    issuedTime: number,
    filtersAndExp: {
      filters: FilterSettings;
      exp: ExpConfig;
    }
  ) {
    super(properties, measurements, issuedTime);
    this.filtersAndExp = filtersAndExp;
  }
  extendedBy(properties?: TelemetryProperties, measurements?: TelemetryMeasurements) {
    const newProperties = { ...this.properties, ...properties };
    const newMeasurements = { ...this.measurements, ...measurements };
    const newData = new TelemetryWithExp(newProperties, newMeasurements, this.issuedTime, this.filtersAndExp);
    newData.displayedTime = this.displayedTime;
    return newData;
  }
  async extendWithExpTelemetry(ctx: Context) {
    this.filtersAndExp.exp.addToTelemetry(this);
    this.filtersAndExp.filters.addToTelemetry(this);
  }
  static createEmptyConfigForTesting() {
    return new TelemetryWithExp({}, {}, 0, {
      filters: new FilterSettings({}),
      exp: ExpConfig.createEmptyConfig(),
    });
  }
}

class CopilotNonError extends Error {
  name: string;
  code: string;

  constructor(thrown: unknown) {
    let message: string;
    try {
      message = JSON.stringify(thrown);
    } catch {
      // EDITED
      // message = thrown.toString();
      message = String(thrown);
    }
    super(message);
    this.name = 'CopilotNonError';
    this.code = SHA256(Utf16.parse(this.message)).toString().slice(0, 16);
  }
}
export {
  telemetryExpProblem,
  telemetryException,
  telemetryError,
  telemetry,
  TelemetryReporters,
  TelemetryData,
  TelemetryWithExp,
  logEngineCompletion,
  telemetrizePromptLength,
  now,
  logEnginePrompt,
  telemetryRaw,
};
