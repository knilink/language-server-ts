export class Debouncer {
  private state?: { timer: NodeJS.Timeout; reject: (reason?: any) => void };

  async debounce(ms: number): Promise<void> {
    if (this.state) {
      clearTimeout(this.state.timer);
      this.state.reject();
      this.state = undefined;
    }

    return new Promise((resolve, reject) => {
      this.state = { timer: setTimeout(() => resolve(), ms), reject };
    });
  }
}
