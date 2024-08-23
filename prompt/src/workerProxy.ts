import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as WorkerThread from 'node:worker_threads';
// import { install as registerSourceMapSupport } from 'source-map-support';
import { getSimilarSnippets } from './snippetInclusion/similarFiles';

function sleep(delay: number): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(`delay: ${delay}`), delay);
  });
}

type Methods = Readonly<{
  sleep: typeof sleep;
  getSimilarSnippets: typeof getSimilarSnippets;
}>;

const methods: Methods & { [key: string]: (...args: any[]) => Promise<any> } = {
  sleep,
  getSimilarSnippets,
};

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

class WorkerProxy {
  private nextHandlerId = 0;
  private pendingPromises = new Map<number, { resolve: (value: any) => void; reject: (reason?: unknown) => void }>();
  private port?: WorkerThread.MessagePort;
  private worker?: WorkerThread.Worker;
  private proxyEnabled: boolean = false;

  api: Methods = {
    sleep: this.proxy(methods, 'sleep'),
    getSimilarSnippets: this.proxy(methods, 'getSimilarSnippets'),
  };

  constructor() {
    if (!WorkerThread.isMainThread && WorkerThread.workerData?.port) {
      require('source-map-support/register'); // registerSourceMapSupport();
      process.cwd = () => WorkerThread.workerData.cwd;
      this.configureWorkerResponse(WorkerThread.workerData?.port);
    }
  }

  private initWorker() {
    const { port1, port2 } = new WorkerThread.MessageChannel();
    this.port = port1;
    this.worker = new WorkerThread.Worker(
      path.resolve(
        path.extname(__filename) !== '.ts' ? __dirname : path.resolve(__dirname, '../../dist'),
        'workerProxy.js'
      ),
      { workerData: { port: port2, cwd: process.cwd() }, transferList: [port2] }
    );

    this.port.on('message', (m: unknown) => this.handleMessage(m as any)); // MARK type casting
    this.port.on('error', (e: unknown) => this.handleError(e));
  }

  startThreading() {
    if (this.worker) throw new Error('Worker thread already initialized.');
    this.proxyFunctions();
    this.initWorker();
  }

  stopThreading() {
    if (this.worker) {
      this.worker.terminate();
      this.worker.removeAllListeners();
      this.worker = undefined;
      this.unproxyFunctions();
      this.pendingPromises.clear();
    }
  }

  proxyFunctions() {
    this.proxyEnabled = true;
  }

  unproxyFunctions() {
    this.proxyEnabled = false;
  }

  private configureWorkerResponse(port: WorkerThread.MessagePort) {
    this.port = port;
    this.port.on('message', async ({ id, fn, args }: { id: number; fn: string; args: any[] }) => {
      let method = methods[fn];
      if (!method) throw new Error(`Function not found: ${fn}`);
      try {
        let res = await method(args);
        this.port!.postMessage({ id: id, res: res }); // was this.port.postMessage({ id: id, res: res })
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        const code = typeof (err as any).code; // type casting
        typeof code === 'string' // type casting
          ? this.port!.postMessage({ id: id, err: err, code: code })
          : this.port!.postMessage({ id: id, err: err });
      }
    });
  }

  private handleMessage({ id, err, code, res }: { id: number; err: unknown; code: unknown; res: unknown }) {
    let pendingPromise = this.pendingPromises.get(id);
    if (pendingPromise) {
      this.pendingPromises.delete(id);
      if (err) {
        (err as any).code = code; // MARK: type cast
        pendingPromise.reject(err);
      } else {
        pendingPromise.resolve(res);
      }
    }
  }

  private handleError(maybeError: unknown) {
    console.log(maybeError);

    let err;
    if (maybeError instanceof Error) {
      err = maybeError;
      if (err.message === 'MODULE_NOT_FOUND' && err.message.endsWith("workerProxy.js'")) {
        err = new Error('Failed to load workerProxy.js');
        (err as any).code = 'CopilotPromptLoadFailure';
      }
      const ourStack = new Error().stack;
      if (err.stack && ourStack != null) {
        err.stack += ourStack?.replace(/^Error/, '');
      }
    } else if ((maybeError as any)?.name === 'ExitStatus' && typeof (maybeError as any).status == 'number') {
      err = new Error(`workerProxy.js exited with status ${(maybeError as any).status}`);
      (err as any).code = `CopilotPromptWorkerExit${(maybeError as any).status}`;
    } else {
      err = new Error(`Non-error thrown: ${maybeError}`);
    }

    for (let pendingPromise of this.pendingPromises.values()) {
      pendingPromise.reject(err);
    }
    throw err;
  }

  proxy<K extends keyof Methods>(methods: Methods, fn: K) {
    const self = this;
    return (...args: Parameters<Methods[K]>): Promise<Awaited<ReturnType<Methods[K]>>> => {
      return new Promise((resolve, reject) => {
        if (self.port && self.proxyEnabled) {
          const id = self.nextHandlerId++;
          this.pendingPromises.set(id, { resolve, reject });
          self.port.postMessage({ id, fn, args });
        } else {
          (methods[fn] as any)(...args)
            .then(resolve)
            .catch(reject);
        }
      });
    };
  }
}

const workerProxy = new WorkerProxy();

export { workerProxy, Methods, WorkerProxy };
