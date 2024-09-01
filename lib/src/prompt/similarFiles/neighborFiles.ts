import path from 'node:path';
import { Context } from "../../../../lib/src/context.ts";
import { URI } from 'vscode-uri';

import { LanguageId } from "../../types.ts";

import { normalizeLanguageId, Document } from "../../../../prompt/src/lib.ts";
import { OpenTabFiles } from "./openTabFiles.ts";
import { TextDocumentManager } from "../../textDocumentManager.ts";
import { telemetry, TelemetryData } from "../../telemetry.ts";
import { relatedFilesLogger, getRelatedFilesList } from "./relatedFiles.ts";

function considerNeighborFile(languageId: LanguageId, neighborLanguageId: LanguageId) {
  return normalizeLanguageId(languageId) === normalizeLanguageId(neighborLanguageId);
}

class NeighborSource {
  static instance?: OpenTabFiles;
  static readonly MAX_NEIGHBOR_FILES = 20;
  static readonly MAX_NEIGHBOR_AGGREGATE_LENGTH = 200_000;
  static readonly EXCLUDED_NEIGHBORS = ['node_modules', 'dist', 'site-packages'];

  public static reset(): void {
    NeighborSource.instance = undefined;
  }

  public static async getNeighborFiles(ctx: Context, uri: URI, fileType: LanguageId, telemetryData: TelemetryData) {
    const docManager = ctx.get(TextDocumentManager);
    NeighborSource.instance ??= new OpenTabFiles(docManager);

    const result = await NeighborSource.instance.getNeighborFiles(uri, fileType, NeighborSource.MAX_NEIGHBOR_FILES);

    const doc = await docManager.getTextDocument(uri);
    if (!doc) {
      relatedFilesLogger.debug(ctx, 'neighborFiles.getNeighborFiles', 'Failed to get the document');
      return result;
    }

    const wksFolder = await docManager.getWorkspaceFolder(doc);

    if (wksFolder) {
      const folder = wksFolder.toString();
      const docInfo: Document = {
        relativePath: path.relative(folder, doc.uri),
        uri: doc.uri,
        languageId: doc.languageId,
        source: doc.getText(),
      };

      let relatedFiles = await getRelatedFilesList(ctx, docInfo, wksFolder, telemetryData);

      if (!relatedFiles) {
        await telemetry(ctx, 'getNeighborFiles.getRelatedFilesList.nullOrUndefined', telemetryData);
        relatedFilesLogger.debug(ctx, '.getRelatedFilesList', 'Failed to get the relatedFiles, it is undefined/null');
      } else if (relatedFiles.size > 0) {
        relatedFiles.forEach((uriToContentMap, type) => {
          const addedDocs: Document[] = [];
          uriToContentMap.forEach((value, key) => {
            if (result.docs.has(key)) return;
            const relatedFileDocInfo: Document = {
              relativePath: path.relative(folder, key),
              uri: key,
              languageId: docInfo.languageId,
              source: value,
            };
            addedDocs.unshift(relatedFileDocInfo);
            result.docs.set(key, relatedFileDocInfo);
          });
          if (addedDocs.length > 0) {
            result.neighborSource.set(
              type,
              addedDocs.map((doc) => doc.uri.toString())
            );
          }
        });
      }
    } else {
      relatedFilesLogger.debug(ctx, 'neighborFiles.getNeighborFiles', 'Failed to get the workspace folder');
    }

    return result;
  }
}

export { considerNeighborFile, NeighborSource };
