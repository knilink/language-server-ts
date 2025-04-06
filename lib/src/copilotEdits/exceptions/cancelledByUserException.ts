class CopilotEditsCancelledByUserException extends Error {
  constructor() {
    super('Operation cancelled by user');
    this.name = 'CopilotEditsCancelledByUserException';
  }
}

export { CopilotEditsCancelledByUserException };
