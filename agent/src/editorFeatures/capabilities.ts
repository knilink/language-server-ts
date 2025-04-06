import { CopilotCapabilitiesType } from '../../../types/src/index.ts';

class CopilotCapabilitiesProvider {
  private capabilities: CopilotCapabilitiesType = {};

  setCapabilities(capabilities: CopilotCapabilitiesType): void {
    this.capabilities = capabilities;
  }

  getCapabilities(): CopilotCapabilitiesType {
    return this.capabilities;
  }
}

export { CopilotCapabilitiesProvider };
