function isCancellationError(error: unknown): boolean {
  return error instanceof CancellationError
    ? true
    : error instanceof Error && error.name === canceledName && error.message === canceledName;
}

class CancellationError extends Error {
  constructor() {
    super(canceledName);
    this.name = this.message;
  }
}

const canceledName = 'Canceled';

export { isCancellationError };
