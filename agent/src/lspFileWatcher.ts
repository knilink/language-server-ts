import type { Connection } from 'vscode-languageserver/node.js';
import type { Context } from '../../lib/src/context.ts';
import type { DocumentUri } from 'vscode-languageserver-types';
import type { CopilotTextDocument } from '../../lib/src/textDocument.ts';

import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { DidChangeWatchedFilesNotification, ProtocolRequestType } from 'vscode-languageserver/node.js';
import { CopilotCapabilitiesProvider } from './editorFeatures/capabilities.ts';
import { Service } from './service.ts';
import { FileReader } from '../../lib/src/fileReader.ts';
import { knownFileExtensions } from '../../lib/src/language/languages.ts';

const didChangeWatchedFilesEvent = 'didChangeWatchedFiles';

type Info = {
  uri: DocumentUri;
  document?: CopilotTextDocument;
  isRestricted: boolean;
  isUnknownFileExtension: boolean;
};

type WatchedFilesResponse = {
  watchedFiles: CopilotTextDocument[];
  contentRestrictedFiles: { uri: string }[];
  unknownFileExtensions: { uri: string }[];
};

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
    workspaceFolder: { uri: string };
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

  constructor(readonly ctx: Context) {}

  get connection(): Connection {
    return this.ctx.get(Service).connection;
  }

  init() {
    if (this.ctx.get(CopilotCapabilitiesProvider).getCapabilities().watchedFiles) {
      this.connection.onNotification(DidChangeWatchedFilesNotification.type, (event) => {
        if ('workspaceUri' in event && typeof event.workspaceUri == 'string') {
          this.didChangeWatchedFilesHandler(event);
        }
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

    for (const uri of files) {
      const extension = path.extname(uri).toLowerCase();
      if (!knownFileExtensions.includes(extension)) {
        res.unknownFileExtensions.push({ uri });
        continue;
      }
      let doc = await this.getValidDocument(uri);
      if (doc === undefined) {
        res.contentRestrictedFiles.push({ uri });
        continue;
      }
      res.watchedFiles.push(doc);
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
      workspaceFolder: { uri: event.workspaceUri },
      created: [],
      changed: [],
      deleted: [],
    };

    for (const change of event.changes) {
      const uri = change.uri;
      const extension = path.extname(change.uri).toLowerCase();
      const info: Info = {
        uri,
        isRestricted: false,
        isUnknownFileExtension: !knownFileExtensions.includes(extension),
      };
      if (!info.isUnknownFileExtension) {
        let doc = await this.getValidDocument(uri);

        if (doc === undefined) {
          info.isRestricted = true;
        } else {
          info.document = doc;
        }
      }

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

  async getValidDocument(uri: string) {
    let documentResult = await this.ctx.get(FileReader).readFile(uri);
    return documentResult.status === 'valid' ? documentResult.document : undefined;
  }
}

export { LspFileWatcher };
