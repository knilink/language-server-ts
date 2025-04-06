type StatusKind = 'Normal' | 'Warning' | 'Error' | 'Inactive' | 'InProgress';

interface StatusEvent {
  kind: StatusKind;
  message: string | undefined;
  busy: boolean;
  command: any; // Replace 'any' with a more specific type if possible
}

class StatusReporter {
  private _inProgressCount: number = 0;
  private _kind: StatusKind = 'Normal';
  private _message?: string;
  private _command: any; // Replace 'any' with a more specific type if possible
  private _startup: boolean = true;

  get busy(): boolean {
    return this._inProgressCount > 0;
  }

  async withProgress<T>(callback: () => Promise<T>): Promise<T> {
    if (this._kind === 'Warning') {
      this.forceNormal();
    }

    if (this._inProgressCount++ === 0) {
      this.didChange();
    }

    try {
      return await callback();
    } finally {
      if (--this._inProgressCount === 0) {
        this.didChange();
      }
    }
  }

  forceStatus(kind: StatusKind, message?: string, command?: any): void {
    if (!(this._kind === kind && this._message === message && !command && !this._command && !this._startup)) {
      this._kind = kind;
      this._message = message;
      this._command = command;
      this._startup = false;
      this.didChange();
    }
  }

  forceNormal(): void {
    if (this._kind !== 'Inactive') {
      this.forceStatus('Normal');
    }
  }

  setError(message: string, command?: any): void {
    this.forceStatus('Error', message, command);
  }

  setWarning(message: string): void {
    if (this._kind !== 'Error') {
      this.forceStatus('Warning', message);
    }
  }

  setInactive(message: string): void {
    if (!(this._kind === 'Error' || this._kind === 'Warning')) {
      this.forceStatus('Inactive', message);
    }
  }

  clearInactive(): void {
    if (this._kind === 'Inactive') {
      this.forceStatus('Normal');
    }
  }

  didChange(event?: StatusEvent): void {
    if (!event) {
      event = {
        kind: this._kind,
        message: this._message,
        busy: this.busy,
        command: this._command,
      };
    }
    // This method is meant to be overridden by subclasses
  }
}

class NoOpStatusReporter extends StatusReporter {
  didChange() {}
}

export { NoOpStatusReporter, StatusReporter, type StatusKind, type StatusEvent };
