class PartialAsyncTextReader {
  _source: AsyncIterator<string>;
  _buffer: string = '';
  _atEnd: boolean = false;

  constructor(source: AsyncIterator<string>) {
    this._source = source;
  }

  get endOfStream(): boolean {
    return this._buffer.length === 0 && this._atEnd;
  }

  async extendBuffer(): Promise<void> {
    if (this._atEnd) return;
    const { value, done } = await this._source.next();
    if (done) {
      this._atEnd = true;
    } else {
      this._buffer += value;
    }
  }

  async waitForLength(n: number): Promise<void> {
    for (; this._buffer.length < n && !this._atEnd; ) {
      await this.extendBuffer();
    }
  }

  async peek(n: number): Promise<string> {
    await this.waitForLength(n);
    return this._buffer.substring(0, n);
  }

  async read(n: number): Promise<string> {
    await this.waitForLength(n);
    const result = this._buffer.substring(0, n);
    this._buffer = this._buffer.substring(n);
    return result;
  }

  async readUntil(char: string): Promise<string> {
    let result = '';
    for (; !this.endOfStream; ) {
      const piece = this.readImmediateExcept(char);
      result += piece;
      if ((await this.peek(1)) === char) break;
    }
    return result;
  }

  async readLineIncludingLF(): Promise<string> {
    let line = await this.readUntil('\n');
    line += await this.read(1);
    return line;
  }

  async readLine(): Promise<string> {
    const line = await this.readUntil('\n');
    await this.read(1);
    return line;
  }

  readImmediateExcept(char: string): string {
    const endIndex = this._buffer.indexOf(char);
    return this.readImmediate(endIndex === -1 ? this._buffer.length : endIndex);
  }

  readImmediate(n: number): string {
    const result = this._buffer.substring(0, n);
    this._buffer = this._buffer.substring(n);
    return result;
  }
}

export { PartialAsyncTextReader };
