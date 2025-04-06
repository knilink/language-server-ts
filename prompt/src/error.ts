class CopilotPromptLoadFailure extends Error {
  code = 'CopilotPromptLoadFailure';
  constructor(
    message: string,
    readonly cause?: unknown // Error type
  ) {
    super(message);
  }
}

export { CopilotPromptLoadFailure };
