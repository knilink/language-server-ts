import type { DocumentUri } from 'vscode-languageserver-types';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import type { Context } from '../../../../lib/src/context.ts';
import type { LanguageId } from '../../types.ts';

import { normalizeLanguageId } from '../../../../prompt/src/lib.ts';
import { OpenTabFiles } from './openTabFiles.ts';
import { getRelatedFilesAndTraits, relatedFilesLogger } from './relatedFiles.ts';
import { TextDocumentManager } from '../../textDocumentManager.ts';
import { TelemetryData } from '../../telemetry.ts';
import { Trait } from '../../../../types/src/index.ts';

function considerNeighborFile(languageId: LanguageId, neighborLanguageId: LanguageId) {
  return normalizeLanguageId(languageId) === normalizeLanguageId(neighborLanguageId);
}

namespace NeighborSource {
  export type Docs = { relativePath?: string; uri: DocumentUri; source: string };
  export type Result = {
    docs: Map<string, Docs>;
    neighborSource: Map<string, DocumentUri[]>;
    traits: Trait[];
  };
}

class NeighborSource {
  static instance?: OpenTabFiles;
  static readonly MAX_NEIGHBOR_FILES = 20;
  static readonly MAX_NEIGHBOR_AGGREGATE_LENGTH = 200_000;
  static readonly EXCLUDED_NEIGHBORS = ['node_modules', 'dist', 'site-packages'];

  static defaultEmptyResult(): NeighborSource.Result {
    return { docs: new Map(), neighborSource: new Map(), traits: [] };
  }

  static reset(): void {
    NeighborSource.instance = undefined;
  }

  static async getNeighborFilesAndTraits(
    ctx: Context,
    uri: DocumentUri,
    fileType: LanguageId,
    telemetryData: TelemetryData,
    cancellationToken: CancellationToken | undefined,
    data: unknown
  ): Promise<NeighborSource.Result> {
    const docManager = ctx.get(TextDocumentManager);
    NeighborSource.instance ??= new OpenTabFiles(docManager);

    const result: NeighborSource.Result = {
      ...(await NeighborSource.instance.getNeighborFiles(uri, fileType, NeighborSource.MAX_NEIGHBOR_FILES)),
      traits: [],
    };

    const doc = await docManager.getTextDocument({ uri });
    if (!doc) {
      relatedFilesLogger.debug(ctx, 'neighborFiles.getNeighborFilesAndTraits', 'Failed to get the document');
      return result;
    }

    const wksFolder = await docManager.getWorkspaceFolder(doc);

    if (wksFolder) {
      const relatedFiles = await getRelatedFilesAndTraits(ctx, doc, telemetryData, cancellationToken, data);

      if (relatedFiles.entries.size) {
        relatedFiles.entries.forEach((uriToContentMap, type) => {
          const addedDocs: { uri: DocumentUri; source: string; relativePath: string }[] = [];

          uriToContentMap.forEach((source, uri) => {
            let relativePath = NeighborSource.getRelativePath(uri, wksFolder.uri);
            if (!relativePath || result.docs.has(uri)) {
              return;
            }
            const relatedFileDocInfo = { relativePath, uri, source };
            addedDocs.unshift(relatedFileDocInfo);
            result.docs.set(uri, relatedFileDocInfo);
          });

          if (addedDocs.length > 0) {
            result.neighborSource.set(
              type,
              addedDocs.map((doc) => doc.uri.toString())
            );
          }
        });
      }

      result.traits.push(...relatedFiles.traits);
    } else {
      relatedFilesLogger.debug(ctx, 'neighborFiles.getNeighborFilesAndTraits', 'Failed to get the workspace folder');
    }

    return result;
  }

  static basename(uri: DocumentUri) {
    return decodeURIComponent(uri.replace(/[#?].*$/, '').replace(/^.*[/:]/, ''));
  }

  static getRelativePath(fileUri: DocumentUri, baseUri: DocumentUri): string {
    let parentURI = baseUri.replace(/[#?].*/, '').replace(/\/?$/, '/');
    return fileUri.startsWith(parentURI) ? fileUri.slice(parentURI.length) : NeighborSource.basename(fileUri);
  }
}

export { considerNeighborFile, NeighborSource };
