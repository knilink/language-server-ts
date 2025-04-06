async function* stringToAsyncIterable(str: string): AsyncGenerator<string> {
  yield str;
}

export { stringToAsyncIterable };
