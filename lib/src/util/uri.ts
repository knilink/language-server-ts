import * as os from 'os';
import * as path from 'path';
import { URI, Utils } from 'vscode-uri';

type UriScheme = string;
type UriPath = string;
type FileSystemPath = string;

function isSupportedUriScheme(scheme: UriScheme): boolean {
  return isFsScheme(scheme);
}

function isFsScheme(scheme: UriScheme): boolean {
  return ['file', 'notebook', 'vscode-notebook', 'vscode-notebook-cell'].includes(scheme);
}

function isFsUri(uri: URI): boolean {
  return isFsScheme(uri.scheme) && (!uri.authority || os.platform() === 'win32');
}

function getFsPath(uri: URI): string | undefined {
  if (isFsUri(uri)) {
    if (os.platform() === 'win32') {
      let path = uri.path;
      return uri.authority ? `//${uri.authority}${path}` : /^\/[A-Za-z]:/.test(path) ? path.substring(1) : path;
    } else {
      return uri.authority ? undefined : uri.path;
    }
  }
}

function resolveFilePath(uri: URI, fileSystemPath: FileSystemPath): URI {
  return isFsUri(uri)
    ? URI.file(path.resolve(getFsPath(uri) ?? '', fileSystemPath))
    : Utils.resolvePath(uri, pathToURIPath(fileSystemPath));
}

function pathToURIPath(fileSystemPath: FileSystemPath): string {
  return isWinPath(fileSystemPath) ? fileSystemPath.replaceAll('\\', '/') : fileSystemPath;
}

function isWinPath(path: UriPath): boolean {
  return /^[^/\\]*\\/.test(path);
}

function dirname(uri: URI): URI {
  return ['notebook', 'vscode-notebook', 'vscode-notebook-cell'].includes(uri.scheme)
    ? Utils.dirname(uri).with({ scheme: 'file', fragment: '' })
    : Utils.dirname(uri);
}

export {
  URI,
  isSupportedUriScheme,
  isFsScheme,
  isFsUri,
  getFsPath,
  resolveFilePath,
  pathToURIPath,
  isWinPath,
  dirname,
};
