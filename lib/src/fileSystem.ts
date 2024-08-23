import fs from 'node:fs';
import { URI, isSupportedUriScheme, getFsPath } from './util/uri';

type FileStat = {
  ctime: number;
  mtime: number;
  size: number;
  type: number;
};

abstract class FileSystem {
  abstract readFileString(uri: URI): Promise<string>;
  abstract stat(uri: URI): Promise<FileStat>;
}

class LocalFileSystem extends FileSystem {
  getFsPath(uri: URI): string | undefined {
    const path = getFsPath(uri);
    if (path !== undefined) return path;
    throw isSupportedUriScheme(uri.scheme)
      ? new Error('Unsupported remote file path')
      : new Error(`Unsupported scheme: ${uri.scheme}`);
  }

  async readFileString(uri: URI): Promise<string> {
    const fsPath = this.getFsPath(uri);
    if (fsPath !== undefined) {
      return (await fs.promises.readFile(fsPath)).toString();
    } else {
      throw new Error('Invalid file path');
    }
  }

  async stat(uri: URI): Promise<FileStat> {
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
      } catch { }
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
