import * as os from 'node:os';
import * as path from 'node:path';
import { URI, Utils } from 'vscode-uri';

type UriScheme = string;
type UriPath = string;
type FileSystemPath = string;

function parseUri(uri: string, strict = false): URI {
  try {
    let match = uri.match(/^(?:([^:/?#]+?:)?\/\/)(\/\/.*)$/);
    return match ? URI.parse(match[1] + match[2], strict) : URI.parse(uri, strict);
  } catch (e) {
    let wrapped = new Error(`Could not parse <${uri}>`);
    throw ((wrapped.cause = e), wrapped);
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

function resolveFilePath(arg: FileSystemPath, fileSystemPath: FileSystemPath): string;
function resolveFilePath(arg: URI, fileSystemPath: FileSystemPath): URI;
function resolveFilePath(arg: URI | FileSystemPath, fileSystemPath: FileSystemPath): URI | string;
function resolveFilePath(arg: URI | FileSystemPath, fileSystemPath: FileSystemPath): URI | string {
  let uri = typeof arg == 'string' ? parseUri(arg, true) : arg;
  let resolved;
  if (isFsUri(uri)) {
    resolved = URI.file(
      path.resolve(
        getFsPath(uri) ?? '', // MARK idk how should it handler undefeind
        fileSystemPath
      )
    );
  } else {
    resolved = Utils.resolvePath(uri, pathToURIPath(fileSystemPath));
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
  return decodeURIComponent(
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

export {
  URI,
  parseUri,
  isSupportedUriScheme,
  isFsScheme,
  isFsUri,
  getFsPath,
  resolveFilePath,
  joinPath,
  pathToURIPath,
  isWinPath,
  basename,
  dirname,
};
