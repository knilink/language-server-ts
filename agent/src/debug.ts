import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import {
  Message,
  Disposable,
  DataCallback,
  MessageWriter,
  MessageReader,
  AbstractMessageReader,
  AbstractMessageWriter,
} from 'vscode-languageserver';
import { DebugServer } from './debug/debugServer.ts';
import { default as open } from 'open';

async function wrapTransports(
  env: NodeJS.ProcessEnv,
  streamReader: MessageReader,
  streamWriter: MessageWriter
): Promise<[MessageReader, MessageWriter]> {
  let emitter: EventEmitter | null = null;
  const debugPort = parseInt((env.GH_COPILOT_DEBUG_UI_PORT ?? env.GITHUB_COPILOT_DEBUG_UI_PORT) as any);
  if (!isNaN(debugPort)) {
    emitter = new EventEmitter();
    let server = new DebugServer(debugPort, emitter).listen();

    if (debugPort === 0) {
      await open(`http://localhost:${server.getPort()}`);
    }
  }

  let logFile: number | null = null;
  const envRecord = env.GITHUB_COPILOT_RECORD ?? '';

  try {
    const stamp = Date.now().toString();
    if (envRecord === '1' || envRecord === 'true') {
      logFile = fs.openSync(`stdio${stamp}.log`, 'w');
    } else if (envRecord && envRecord !== '0' && envRecord !== 'false') {
      logFile = fs.openSync(envRecord.replaceAll('%s', stamp), 'w');
    }
  } catch (e) {
    console.error(e);
  }

  if (logFile) {
    const logData = (data: string) => {
      if (logFile) {
        fs.appendFile(logFile, data, (err) => {
          if (err) {
            console.error(err);
            logFile = null;
          }
        });
      }
    };

    emitter ??= new EventEmitter();
    emitter.on('read', (message: unknown) => {
      logData(`<-- ${JSON.stringify(message)}\n`);
    });
    emitter.on('write', (message: unknown) => {
      logData(`--> ${JSON.stringify(message)}\n`);
    });
  }

  if (emitter) {
    streamReader = new DebugMessageReader(streamReader, emitter);
    streamWriter = new DebugMessageWriter(streamWriter, emitter);
  }

  return [streamReader, streamWriter];
}

class DebugMessageWriter extends AbstractMessageWriter {
  private delegate: MessageWriter;
  private ev: EventEmitter;

  constructor(delegate: MessageWriter, ev: EventEmitter) {
    super();
    this.delegate = delegate;
    this.ev = ev;
  }

  async write(msg: Message): Promise<void> {
    this.ev.emit('write', msg);
    return this.delegate.write(msg);
  }

  end(): void {
    this.ev.emit('end');
    this.delegate.end();
  }
}

class DebugMessageReader extends AbstractMessageReader {
  private delegate: MessageReader;
  private ev: EventEmitter;

  constructor(delegate: MessageReader, ev: EventEmitter) {
    super();
    this.delegate = delegate;
    this.ev = ev;
  }

  listen(callback: DataCallback): Disposable {
    return this.delegate.listen((msg: Message) => {
      this.ev.emit('read', msg);
      callback(msg);
    });
  }
}
export { wrapTransports };
