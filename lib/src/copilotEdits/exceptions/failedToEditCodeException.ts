class FailedToEditCodeException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FailedToEditCodeException';
  }
}

export { FailedToEditCodeException };
