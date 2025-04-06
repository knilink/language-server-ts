abstract class EditProgressReporter {
  abstract report(partialResultToken: string | number, resultItem: unknown): Promise<void>;
  // ../services/copilotEditsService.ts
  abstract reportTurn(turnCtx: unknown, resultItem: unknown): Promise<void>;
  constructor(public ctx: unknown) {}
}

class LibTestEditProgressReporter extends EditProgressReporter {
  async report(partialResultToken: unknown, resultItem: unknown): Promise<void> {}
  async reportTurn(turnCtx: unknown, resultItem: unknown): Promise<void> {}
}

export { EditProgressReporter, LibTestEditProgressReporter };
