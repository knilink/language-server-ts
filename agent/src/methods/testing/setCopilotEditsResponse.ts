import { CancellationToken } from 'vscode-languageserver';
import type { Context } from '../../../../lib/src/context.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { Type, Static } from '@sinclair/typebox';

async function handleTestingSetCopilotEditsResponseChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  ctx.get(CopilotEditsMockManager).setMockEnabled(params.enableMock);
  return ['OK', null];
}

const Params = Type.Object({ enableMock: Type.Boolean() });

class CopilotEditsMockManager {
  enableMock = false;

  isMockEnabled() {
    return this.enableMock;
  }

  setMockEnabled(enableMock: boolean) {
    this.enableMock = enableMock;
  }
}

const handleTestingSetCopilotEditsResponse = addMethodHandlerValidation(
  Params,
  handleTestingSetCopilotEditsResponseChecked
);

export { CopilotEditsMockManager, handleTestingSetCopilotEditsResponse };
