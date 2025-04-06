class NotSupportedEditCodeResponseTypeException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotSupportedEditCodeResponseTypeException';
  }
}

export { NotSupportedEditCodeResponseTypeException };
