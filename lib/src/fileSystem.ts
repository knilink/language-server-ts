import fs from 'node:fs';
import { type DocumentUri } from 'vscode-languageserver-types';
import { type URI } from 'vscode-uri';
import { isSupportedUriScheme, getFsPath, parseUri } from './util/uri.ts';

type FileStat = {
  ctime: number;
  mtime: number;
  size: number;
  type: number;
};

abstract class FileSystem {
  abstract readFileString(uri: URI | DocumentUri): Promise<string>;
  abstract stat(uri: URI | DocumentUri): Promise<FileStat>;
}

class LocalFileSystem extends FileSystem {
  getFsPath(uri: URI | DocumentUri): string | undefined {
    if (typeof uri == 'string') {
      uri = parseUri(uri, true);
    }

    const path = getFsPath(uri);
    if (path !== undefined) return path;
    throw isSupportedUriScheme(uri.scheme)
      ? new Error('Unsupported remote file path')
      : new Error(`Unsupported scheme: ${uri.scheme}`);
  }

  async readFileString(uri: URI | DocumentUri): Promise<string> {
    const fsPath = this.getFsPath(uri);
    if (fsPath !== undefined) {
      return (await fs.promises.readFile(fsPath)).toString();
    } else {
      throw new Error('Invalid file path');
    }
  }

  async stat(uri: URI | DocumentUri): Promise<FileStat> {
    const fsPath = this.getFsPath(uri);
    if (fsPath !== undefined) {
      const { targetStat, lstat, stat } = await this.statWithLink(fsPath);
      return {
        ctime: targetStat.ctimeMs,
        mtime: targetStat.mtimeMs,
        size: targetStat.size,
        type: this.getFileType(targetStat, lstat, stat),
      };
    } else {
      throw new Error('Invalid file path');
    }
  }

  async statWithLink(fsPath: string): Promise<{ lstat: fs.Stats; targetStat: fs.Stats; stat?: fs.Stats }> {
    const lstat = await fs.promises.lstat(fsPath);
    if (lstat.isSymbolicLink()) {
      try {
        const stat = await fs.promises.stat(fsPath);
        return { lstat, targetStat: stat, stat };
      } catch {}
    }
    return { lstat, targetStat: lstat };
  }

  getFileType(targetStat: fs.Stats, lstat: fs.Stats, stat?: fs.Stats): number {
    let type = 0;
    if (targetStat.isFile()) type |= 1;
    if (targetStat.isDirectory()) type |= 2;
    if (lstat.isSymbolicLink() && stat) type |= 64;
    return type;
  }
}

export { FileSystem, LocalFileSystem, FileStat };
