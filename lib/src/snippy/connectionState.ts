import { type Context } from '../context.ts';
import { codeReferenceLogger } from './logger.ts';
import { Fetcher } from '../networking.ts';
import { NetworkConfiguration } from '../networkConfiguration.ts';

const InitialTimeout = 3_000;
const BaseRetryTime = 2;
const MaxRetryTime = 256;
const MaxAttempts = Math.log(MaxRetryTime) / Math.log(BaseRetryTime) / BaseRetryTime;

type ConnectionState = {
  connection: 'disabled' | 'connected' | 'disconnected' | 'retry' | 'disabled';
  maxAttempts: number;
  retryAttempts: number;
  initialWait: boolean;
};

let state: ConnectionState = {
  connection: 'disabled',
  maxAttempts: MaxAttempts,
  retryAttempts: 0,
  initialWait: false,
};

let handlers: (() => void)[] = [];

// let stateAPI: {
//   setConnected: () => void;
//   setDisconnected: () => void;
//   setRetrying: () => void;
//   setDisabled: () => void;
//   enableRetry: (ctx: Context, initialTimeout?: number) => Promise<void>;
//   listen: (cb: unknown) => { dispose: () => void };
//   isConnected: () => boolean;
//   isDisconnected: () => boolean;
//   isRetrying: () => boolean;
//   isDisabled: () => boolean;
//   isInitialWait: () => boolean;
// } | null = null;

function registerConnectionState(): typeof stateAPI {
  // if (stateAPI) return stateAPI;

  function subscribe(cb: () => void): () => void {
    handlers.push(cb);
    return () => {
      const index = handlers.indexOf(cb);
      if (index !== -1) handlers.splice(index, 1);
    };
  }

  function afterUpdateConnection(): void {
    for (const handler of handlers) handler();
  }

  function updateConnection(status: ConnectionState['connection']): void {
    if (state.connection !== status) {
      state.connection = status;
      afterUpdateConnection();
    }
  }

  function isConnected(): boolean {
    return state.connection === 'connected';
  }

  function isDisconnected(): boolean {
    return state.connection === 'disconnected';
  }

  function isRetrying(): boolean {
    return state.connection === 'retry';
  }

  function isDisabled(): boolean {
    return state.connection === 'disabled';
  }

  function setConnected(): void {
    updateConnection('connected');
    setInitialWait(false);
  }

  function setDisconnected(): void {
    updateConnection('disconnected');
  }

  function setRetrying(): void {
    updateConnection('retry');
  }

  function setDisabled(): void {
    updateConnection('disabled');
  }

  function setInitialWait(enabled: boolean): void {
    if (state.initialWait !== enabled) state.initialWait = enabled;
  }

  async function enableRetry(ctx: Context, initialTimeout: number = InitialTimeout): Promise<void> {
    if (!isRetrying()) {
      setRetrying();
      setInitialWait(true);
      attemptToPing(ctx, initialTimeout);
    }
  }

  function isInitialWait(): boolean {
    return state.initialWait;
  }

  // async function attemptToPing(ctx: Context, initialTimeout: number): Promise<void> {
  //   codeReferenceLogger.info(ctx, `Attempting to reconnect in ${initialTimeout}ms.`);
  //   await timeout(initialTimeout);
  //   setInitialWait(false);
  //   const fetcher = ctx.get(Fetcher);
  //
  //   async function succeedOrRetry(time: number, ctx: Context): Promise<void> {
  //     if (time > MaxRetryTime) {
  //       codeReferenceLogger.info(ctx, 'Max retry time reached, disabling.');
  //       setDisabled();
  //       return;
  //     }
  //     setTimeout(async () => {
  //       state.retryAttempts = Math.min(state.retryAttempts + 1, MaxAttempts);
  //       try {
  //         codeReferenceLogger.info(ctx, `Pinging service after ${time} second(s)`);
  //         const response = await fetcher.fetch(ctx.get(NetworkConfiguration).getOriginTrackingUrl(ctx, '/_ping'), {
  //           method: 'GET',
  //           headers: { 'content-type': 'application/json' },
  //         });
  //         if (response.status !== 200 || !response.ok) await succeedOrRetry(time ** 2, ctx);
  //         else {
  //           codeReferenceLogger.info(ctx, 'Successfully reconnected.');
  //           setConnected();
  //           return;
  //         }
  //       } catch {
  //         await succeedOrRetry(time ** 2, ctx);
  //       }
  //     }, time * 1000);
  //   }
  //
  //   codeReferenceLogger.info(ctx, 'Attempting to reconnect.');
  //   await succeedOrRetry(BaseRetryTime, ctx);
  // }

  async function attemptToPing(ctx: Context, initialTimeout: number): Promise<void> {
    codeReferenceLogger.info(ctx, `Attempting to reconnect in ${initialTimeout}ms.`);
    await timeout(initialTimeout);
    setInitialWait(false);
    const fetcher = ctx.get(Fetcher);

    codeReferenceLogger.info(ctx, 'Attempting to reconnect.');
    for (let time = BaseRetryTime; time <= MaxRetryTime; time **= 2) {
      await timeout(time * 1000);
      state.retryAttempts = Math.min(state.retryAttempts + 1, MaxAttempts);
      try {
        codeReferenceLogger.info(ctx, `Pinging service after ${time} second(s)`);
        const response = await fetcher.fetch(ctx.get(NetworkConfiguration).getOriginTrackingUrl(ctx, '/_ping'), {
          method: 'GET',
          headers: { 'content-type': 'application/json' },
        });
        if (response.status === 200 && response.ok) {
          codeReferenceLogger.info(ctx, 'Successfully reconnected.');
          setConnected();
          return;
        }
      } catch {}
    }
    codeReferenceLogger.info(ctx, 'Max retry time reached, disabling.');
    setDisabled();
  }

  function timeout(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function listen(cb: () => void): { dispose: () => void } {
    return { dispose: subscribe(cb) };
  }

  const stateAPI = {
    setConnected,
    setDisconnected,
    setRetrying,
    setDisabled,
    enableRetry,
    listen,
    isConnected,
    isDisconnected,
    isRetrying,
    isDisabled,
    isInitialWait,
  };

  return stateAPI;
}

const ConnectionState = registerConnectionState();

export { InitialTimeout, BaseRetryTime, MaxRetryTime, MaxAttempts, state, handlers, ConnectionState };
