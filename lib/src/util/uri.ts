import * as os from 'node:os';
import * as path from 'node:path';
import { URI, Utils } from 'vscode-uri';

type UriScheme = string;
type UriPath = string;
type FileSystemPath = string;

function decodeURIComponentGraceful(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str.length > 3 ? str.substring(0, 3) + decodeURIComponentGraceful(str.substring(3)) : str;
  }
}

function percentDecode(str: string): string {
  return str.match(_rEncodedAsHex) ? str.replace(_rEncodedAsHex, (match) => decodeURIComponentGraceful(match)) : str;
}

function parseUri(uri: string, strict = false): URI {
  try {
    let match = uri.match(/^(?:([^:/?#]+?:)?\/\/)(\/\/.*)$/);
    return match ? URI.parse(match[1] + match[2], strict) : URI.parse(uri, strict);
  } catch (cause) {
    let wrapped = new Error(`Could not parse <${uri}>`);
    wrapped.cause = cause;
    throw wrapped;
  }
}

function normalizeUri(uri: string) {
  try {
    return parseUri(uri, false).toString();
  } catch {
    return uri;
  }
}

function isSupportedUriScheme(schemeOrUri: UriScheme | URI): boolean {
  return isFsScheme(schemeOrUri.toString().split(':')[0]);
}

function isFsScheme(scheme: UriScheme): boolean {
  return ['file', 'notebook', 'vscode-notebook', 'vscode-notebook-cell'].includes(scheme);
}

function isFsUri(uri: URI): boolean {
  return isFsScheme(uri.scheme) && (!uri.authority || os.platform() === 'win32');
}

function getFsPath(uri: FileSystemPath | URI): FileSystemPath | undefined {
  try {
    if (typeof uri === 'string') {
      uri = parseUri(uri, true);
    }
  } catch {
    return;
  }
  if (isFsUri(uri))
    if (os.platform() === 'win32') {
      let path = uri.path;
      if (uri.authority) {
        path = `//${uri.authority}${uri.path}`;
      } else if (/^\/[A-Za-z]:/.test(path)) {
        path = path.substring(1);
      }
      return path.normalize(path);
    } else return uri.authority ? undefined : uri.path;
}

function resolveFilePath(arg: FileSystemPath, ...fileSystemPaths: FileSystemPath[]): string;
function resolveFilePath(arg: URI, ...fileSystemPaths: FileSystemPath[]): URI;
function resolveFilePath(arg: URI | FileSystemPath, ...fileSystemPaths: FileSystemPath[]): URI | string;
function resolveFilePath(arg: URI | FileSystemPath, ...fileSystemPaths: FileSystemPath[]): URI | string {
  let uri = typeof arg == 'string' ? parseUri(arg, true) : arg;
  let resolved;
  if (isFsUri(uri)) {
    resolved = URI.file(
      path.resolve(
        getFsPath(uri) ?? '', // MARK idk how should it handler undefeind
        ...fileSystemPaths
      )
    );
  } else {
    resolved = Utils.resolvePath(uri, ...fileSystemPaths.map((p) => pathToURIPath(p)));
  }
  return typeof arg == 'string' ? resolved.toString() : resolved;
}

function joinPath(arg: FileSystemPath, ...paths: FileSystemPath[]): FileSystemPath;
function joinPath(arg: URI, ...paths: FileSystemPath[]): URI;
function joinPath(arg: FileSystemPath | URI, ...paths: FileSystemPath[]): FileSystemPath | URI;
function joinPath(arg: FileSystemPath | URI, ...paths: FileSystemPath[]): FileSystemPath | URI {
  const uri = typeof arg === 'string' ? parseUri(arg, true) : arg;
  const joined = Utils.joinPath(uri, ...paths.map(pathToURIPath));
  return typeof arg === 'string' ? joined.toString() : joined;
}

function pathToURIPath(fileSystemPath: FileSystemPath): string {
  return isWinPath(fileSystemPath) ? fileSystemPath.replaceAll('\\', '/') : fileSystemPath;
}

function isWinPath(path: UriPath): boolean {
  return /^[^/\\]*\\/.test(path);
}

function basename(
  uri:
    | URI
    // ../textDocumentManager.ts
    | FileSystemPath
): FileSystemPath {
  return percentDecode(
    uri
      .toString()
      .replace(/[#?].*$/, '')
      .replace(/\/$/, '')
      .replace(/^.*[/:]/, '')
  );
}

function dirname(arg: FileSystemPath): FileSystemPath;
function dirname(arg: URI): URI;
function dirname(arg: URI | FileSystemPath): URI | FileSystemPath;
function dirname(arg: URI | FileSystemPath): URI | FileSystemPath {
  let uri = typeof arg == 'string' ? parseUri(arg, true) : arg;
  let dir;
  if (['notebook', 'vscode-notebook', 'vscode-notebook-cell'].includes(uri.scheme)) {
    dir = Utils.dirname(uri).with({ scheme: 'file', fragment: '' });
  } else {
    dir = Utils.dirname(uri);
  }
  return typeof arg == 'string' ? dir.toString() : dir;
}

const _rEncodedAsHex = /(%[0-9A-Za-z][0-9A-Za-z])+/g;

export {
  basename,
  dirname,
  getFsPath,
  isSupportedUriScheme,
  joinPath,
  normalizeUri,
  parseUri,
  percentDecode,
  resolveFilePath,
};
