import { Static, Type } from '@sinclair/typebox';

const CopilotCapabilities = Type.Object({
  fetch: Type.Optional(Type.Boolean()),
  redirectedTelemetry: Type.Optional(Type.Boolean()),
  token: Type.Optional(Type.Boolean()),
  related: Type.Optional(Type.Boolean()),
  watchedFiles: Type.Optional(Type.Boolean()),
});

type CopilotCapabilitiesType = Static<typeof CopilotCapabilities>;

const NameAndVersion = Type.Object({
  name: Type.String(),
  version: Type.String(),
  readableName: Type.Optional(Type.String()),
});

type NameAndVersionType = Static<typeof NameAndVersion>;

const CopilotInitializationOptions = Type.Object({
  editorInfo: Type.Optional(NameAndVersion),
  editorPluginInfo: Type.Optional(NameAndVersion),
  relatedPluginInfo: Type.Optional(Type.Array(NameAndVersion)),
  copilotCapabilities: Type.Optional(CopilotCapabilities),
  githubAppId: Type.Optional(Type.String()),
});

type CopilotInitializationOptionsType = Static<typeof CopilotInitializationOptions>;

export { CopilotInitializationOptions, CopilotInitializationOptionsType, CopilotCapabilitiesType, NameAndVersionType };
