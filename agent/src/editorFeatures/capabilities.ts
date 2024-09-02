import { Type, type Static } from '@sinclair/typebox';

const CopilotCapabilitiesParam = Type.Object({
  fetch: Type.Optional(Type.Boolean()),
  redirectedTelemetry: Type.Optional(Type.Boolean()),
  token: Type.Optional(Type.Boolean()),
  related: Type.Optional(Type.Boolean()),
  watchedFiles: Type.Optional(Type.Boolean()),
});

type CopilotCapabilitiesParamType = Static<typeof CopilotCapabilitiesParam>;

class CopilotCapabilitiesProvider {
  private capabilities: CopilotCapabilitiesParamType = {};

  setCapabilities(capabilities: CopilotCapabilitiesParamType): void {
    this.capabilities = capabilities;
  }

  getCapabilities(): CopilotCapabilitiesParamType {
    return this.capabilities;
  }
}

export { CopilotCapabilitiesParam, CopilotCapabilitiesProvider };
