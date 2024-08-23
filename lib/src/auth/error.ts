class CopilotAuthError extends Error {
  name = 'CopilotAuthError';
  cause?: Error;

  constructor(
    message: string,
    // Error ../../../agent/src/auth/copilotTokenManager.ts
    cause?: Error
  ) {
    super(message);
    this.cause = cause;
  }
}

export { CopilotAuthError };
