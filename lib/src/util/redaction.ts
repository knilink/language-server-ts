import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as os from 'node:os';
// @ts-ignore
import { SystemError, FetchError } from '@adobe/helix-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { Replacement } from '../types.ts';

type AdobeError = SystemError | FetchError;

function redactPaths(input: string): string {
  return input
    .replace(/(file:\/\/)([^\s<>]+)/gi, '$1[redacted]')
    .replace(/(^|[\s|:=(<'"`])((?:\/(?=[^/])|\\|[a-zA-Z]:[\\/])[^\s:)>'"`]+)/g, '$1[redacted]');
}

function redactMessage(input: string): string {
  if (knownErrorLiterals.has(input)) return input;
  for (let pattern of knownErrorPatterns) if (pattern.test(input)) return input;
  return redactPaths(input).replace(/\bDNS:(?:\*\.)?[\w.-]+/gi, 'DNS:[redacted]');
}

function escapeForRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const knownErrorLiterals = new Set([
  'Maximum call stack size exceeded',
  'Set maximum size exceeded',
  'Invalid arguments',
]);

const knownErrorPatterns = [
  /^[\p{L}\p{Nl}$\p{Mn}\p{Mc}\p{Nd}\p{Pc}.]+ is not a function[ \w]*$/u,
  /^Cannot read properties of undefined \(reading '[\p{L}\p{Nl}$\p{Mn}\p{Mc}\p{Nd}\p{Pc}]+'\)$/u,
];

const relativePathSuffix = '[\\\\/]?([^:)]*)(?=:\\d)';

const homedirRegExp = new RegExp(
  '(?<=^|[\\s|("\'`]|file://)' + escapeForRegExp(os.homedir()) + '(?=$|[\\\\/:"\'`])',
  'gi'
);

const pathSepRegExp = new RegExp(escapeForRegExp(path.sep), 'g');

const rootDirRegExp = new RegExp(
  escapeForRegExp(__dirname.replace(/[\\/]lib[\\/]src[\\/]util$|[\\/]dist$/, '')) + relativePathSuffix,
  'gi'
);

function redactHomeDir(input: string): string {
  return input.replace(homedirRegExp, '~');
}

function cloneError(
  original: any,
  prepareMessage: (original: any) => string,
  allowUnknownPaths: boolean = false,
  replacements: Replacement[] = []
): Error {
  const error: any = new Error(prepareMessage(original));
  error.name = original.name;
  if (typeof original.syscall === 'string') {
    error.syscall = original.syscall;
  }
  if (typeof original.code === 'string') {
    error.code = original.code;
  }
  if (typeof original.errno === 'number') {
    error.errno = original.errno;
  }
  error.stack = undefined;

  const originalStack = original.stack?.replace(/^.*?:\d+\n.*\n *\^?\n\n/, '');
  let stackFrames: string[] | undefined;

  for (const stackPrefix of [original.toString(), `${original.name}: ${original.message}`]) {
    if (originalStack?.startsWith(`${stackPrefix}\n`)) {
      stackFrames = originalStack.slice(stackPrefix.length + 1).split(/\n/);
      break;
    }
  }

  if (stackFrames) {
    error.stack = `${error}`;
    for (const frame of stackFrames) {
      if (rootDirRegExp.test(frame)) {
        error.stack += `\n${redactPaths(
          frame.replace(rootDirRegExp, (_: string, relative: string) => './' + relative.replace(pathSepRegExp, '/'))
        )}`;
      } else if (/[ (]node:|[ (]wasm:\/\/wasm\/| \(<anonymous>\)$/.test(frame)) {
        error.stack += `\n${redactPaths(frame)}`;
      } else {
        let found = false;
        for (const { prefix, path: dir } of replacements) {
          const dirRegExp = new RegExp(`${escapeForRegExp(dir.replace(/[\\/]$/, ''))}\\b`, 'gi');
          if (dirRegExp.test(frame)) {
            error.stack += `\n${redactPaths(
              frame.replace(
                dirRegExp,
                (_: string, relative: string) => `${prefix}${relative.replace(pathSepRegExp, '/')}`
              )
            )}`;
            found = true;
            break;
          }
        }
        if (found) continue;
        error.stack += allowUnknownPaths ? `\n${redactHomeDir(frame)}` : '\n    at [redacted]:0:0';
      }
    }
  } else if (allowUnknownPaths && originalStack) {
    error.stack = redactHomeDir(originalStack);
  }

  if (original.cause instanceof Error) {
    error.cause = cloneError(original.cause, prepareMessage, allowUnknownPaths, replacements);
  }

  return error;
}

function errorMessageWithoutPath(error: AdobeError): string {
  let message = error.message;
  if ('path' in error && typeof error.path === 'string' && error.path.length > 0) {
    message = message.replaceAll(error.path, '<path>');
  }
  return message;
}

function prepareErrorForRestrictedTelemetry(original: any, replacements?: Replacement[]) {
  function prepareMessage(e: any) {
    return redactHomeDir(errorMessageWithoutPath(e));
  }
  return cloneError(original, prepareMessage, true, replacements);
}

function redactError(original: any, replacements?: Replacement[], telemetryOptIn: boolean = false): Error {
  function prepareMessage(e: AdobeError) {
    if (telemetryOptIn) return redactMessage(errorMessageWithoutPath(e));
    let message = '[redacted]';
    if (typeof e.syscall === 'string' && e.code !== undefined) {
      message = `${redactPaths(e.syscall)} ${e.code} ${message}`;
    } else if (e instanceof FetchError && e.erroredSysCall && e.code !== undefined) {
      message = `${e.erroredSysCall} ${e.code} ${message}`;
    } else if (e.code !== void 0) {
      message = `${e.code} ${message}`;
    }
    return message;
  }
  return cloneError(original, prepareMessage, false, replacements);
}

export { prepareErrorForRestrictedTelemetry, redactMessage, redactError };
