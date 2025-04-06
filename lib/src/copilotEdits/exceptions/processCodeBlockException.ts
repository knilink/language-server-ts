class CopilotEditsProcessCodeBlockException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CopilotEditsProcessCodeBlockException';
  }
}

export { CopilotEditsProcessCodeBlockException };
