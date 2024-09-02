import { EventEmitter } from 'events';
import { extname } from 'path';
import { type Connection, ProtocolRequestType } from "vscode-languageserver/node.js";
import { URI } from 'vscode-uri';

import { Context } from '../../lib/src/context.ts';
import { Service } from './service.ts';
import { CopilotCapabilitiesProvider } from './editorFeatures/capabilities.ts';
import { knownFileExtensions } from '../../lib/src/language/languages.ts';
import { getFsPath } from '../../lib/src/util/uri.ts';
import { FileReader } from '../../lib/src/fileReader.ts';

const didChangeWatchedFilesEvent = 'didChangeWatchedFiles';

type Info = {
  uri: URI;
  isRestricted: boolean;
  isUnknownFileExtension: boolean;
};

type WatchedFilesResponse = { watchedFiles: URI[]; contentRestrictedFiles: URI[]; unknownFileExtensions: URI[] };

type GetWatchedFilesParams = {
  workspaceUri: string;
  excludeGitignoredFiles: boolean;
  excludeIDEIgnoredFiles: boolean;
};

const EmptyWatchedFilesResponse: WatchedFilesResponse = {
  watchedFiles: [],
  contentRestrictedFiles: [],
  unknownFileExtensions: [],
};

namespace LspFileWatcher {
  export type ChangeWatchedFilesEvent = {
    workspaceFolder: URI;
    created: Info[];
    changed: Info[];
    deleted: Info[];
  };
}

class LspFileWatcher {
  static readonly requestType = new ProtocolRequestType<
    GetWatchedFilesParams,
    { files: string[] },
    unknown,
    unknown,
    unknown
  >('copilot/watchedFiles');
  private emitter = new EventEmitter<{ [didChangeWatchedFilesEvent]: [LspFileWatcher.ChangeWatchedFilesEvent] }>();

  constructor(readonly ctx: Context) { }

  get connection(): Connection {
    return this.ctx.get(Service).connection;
  }

  init() {
    const capabilitiesProvider = this.ctx.get(CopilotCapabilitiesProvider);
    if (capabilitiesProvider.getCapabilities().watchedFiles) {
      this.connection.onNotification('workspace/didChangeWatchedFiles', (event) => {
        this.didChangeWatchedFilesHandler(event);
      });
    }
  }

  async getWatchedFiles(
    // ./workspaceWatcher/agentWatcher.ts
    params: GetWatchedFilesParams
  ): Promise<WatchedFilesResponse> {
    if (!this.ctx.get(CopilotCapabilitiesProvider).getCapabilities().watchedFiles) return EmptyWatchedFilesResponse;

    const files = (await this.connection.sendRequest(LspFileWatcher.requestType, params)).files;
    const res: WatchedFilesResponse = {
      watchedFiles: [],
      contentRestrictedFiles: [],
      unknownFileExtensions: [],
    };

    for (const filepath of files) {
      const uri = URI.parse(filepath);
      const extension = extname(filepath).toLowerCase();

      if (!knownFileExtensions.includes(extension)) {
        res.unknownFileExtensions.push(uri);
        continue;
      }

      if (!(await this.isValid(uri))) {
        res.contentRestrictedFiles.push(uri);
        continue;
      }

      res.watchedFiles.push(uri);
    }

    return res;
  }

  onDidChangeWatchedFiles(listener: (event: LspFileWatcher.ChangeWatchedFilesEvent) => void): void {
    this.emitter.on(didChangeWatchedFilesEvent, listener);
  }

  offDidChangeWatchedFiles(listener: (event: LspFileWatcher.ChangeWatchedFilesEvent) => void): void {
    this.emitter.off(didChangeWatchedFilesEvent, listener);
  }

  async didChangeWatchedFilesHandler(
    event: any // MARK event.workspaceUri doesn't seem to align with workspace/didChangeWatchedFiles in protocol
  ): Promise<void> {
    const res: LspFileWatcher.ChangeWatchedFilesEvent = {
      workspaceFolder: URI.parse(event.workspaceUri),
      created: [],
      changed: [],
      deleted: [],
    };

    for (let change of event.changes) {
      const uri = URI.parse(change.uri);
      const extension = extname(change.uri).toLowerCase();
      const info = {
        uri,
        isRestricted: !(await this.isValid(uri)),
        isUnknownFileExtension: !knownFileExtensions.includes(extension),
      };
      switch (change.type) {
        case 1:
          res.created.push(info);
          break;
        case 2:
          res.changed.push(info);
          break;
        case 3:
          res.deleted.push(info);
          break;
      }
    }

    this.emitter.emit(didChangeWatchedFilesEvent, res);
  }

  async isValid(uri: URI): Promise<boolean> {
    let filepath = getFsPath(uri);
    return !!filepath && (await this.ctx.get(FileReader).readFile(filepath)).status === 'valid';
  }
}

export { LspFileWatcher };
