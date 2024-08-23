import { Type } from '@sinclair/typebox';

type CopilotCapabilitiesParam = {
  fetch?: boolean;
  redirectedTelemetry?: boolean;
  token?: boolean;
  related?: boolean;
  watchedFiles?: boolean;
};

const CopilotCapabilitiesParam = Type.Object({
  fetch: Type.Optional(Type.Boolean()),
  redirectedTelemetry: Type.Optional(Type.Boolean()),
  token: Type.Optional(Type.Boolean()),
  related: Type.Optional(Type.Boolean()),
  watchedFiles: Type.Optional(Type.Boolean()),
});

class CopilotCapabilitiesProvider {
  private capabilities: CopilotCapabilitiesParam = {};

  setCapabilities(capabilities: CopilotCapabilitiesParam): void {
    this.capabilities = capabilities;
  }

  getCapabilities(): CopilotCapabilitiesParam {
    return this.capabilities;
  }
}

export { CopilotCapabilitiesParam, CopilotCapabilitiesProvider };
