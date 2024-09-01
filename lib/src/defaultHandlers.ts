import { Context } from "./context.ts";
import { isAbortError } from "./networking.ts";
import { StatusReporter } from "./progress.ts";
import { logger } from "./logger.ts";

const oomCodes = new Set(['ERR_WORKER_OUT_OF_MEMORY', 'ENOMEM']);

function isOomError(error: Error): boolean {
  return oomCodes.has(
    ((error as any).code ?? '') ||
    (error.name === 'RangeError' && error.message === 'WebAssembly.Memory(): could not allocate memory')
  );
}

function handleException(ctx: Context, err: unknown, origin: string, _logger = logger): void {
  if (!isAbortError(err)) {
    if (err instanceof Error) {
      const error: any = err;
      if (isOomError(error)) {
        ctx.get(StatusReporter).setError('Out of memory');
      } else if (error.code === 'EMFILE' || error.code === 'ENFILE') {
        ctx.get(StatusReporter).setError('Too many open files');
      } else if (error.code === 'CopilotPromptLoadFailure') {
        ctx.get(StatusReporter).setError('Corrupted Copilot installation');
      } else if (error.code?.startsWith('CopilotPromptWorkerExit')) {
        ctx.get(StatusReporter).setError('Worker unexpectedly exited');
      } else if (error.syscall === 'uv_cwd' && error.code === 'ENOENT') {
        ctx.get(StatusReporter).setError('Current working directory does not exist');
      }
    }
    _logger.exception(ctx, err, origin);
  }
}

function registerDefaultHandlers(ctx: Context): void {
  process.addListener('uncaughtException', (err) => {
    handleException(ctx, err, 'uncaughtException');
  });

  let isHandlingRejection = false;
  process.addListener('unhandledRejection', (reason: unknown) => {
    if (!isHandlingRejection) {
      try {
        isHandlingRejection = true;
        handleException(ctx, reason, 'unhandledRejection');
      } finally {
        isHandlingRejection = false;
      }
    }
  });
}

export { registerDefaultHandlers };
