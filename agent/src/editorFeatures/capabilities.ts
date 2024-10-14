type CopilotCapabilitiesParamType = {
  fetch?: boolean;
  redirectedTelemetry?: boolean;
  token?: boolean;
  related?: boolean;
  watchedFiles?: boolean;
};

class CopilotCapabilitiesProvider {
  private capabilities: CopilotCapabilitiesParamType = {};

  setCapabilities(capabilities: CopilotCapabilitiesParamType): void {
    this.capabilities = capabilities;
  }

  getCapabilities(): CopilotCapabilitiesParamType {
    return this.capabilities;
  }
}

export { CopilotCapabilitiesProvider };
