import { DocumentUri } from 'vscode-languageserver-types';
import type { Skill } from '../../types.ts';
import type { Reference } from '../conversation.ts';

import { FileReader, statusFromTextDocumentResult } from '../../fileReader.ts';
import { ElidableText } from '../../../../prompt/src/elidableText/elidableText.ts';
import { ElidableDocument } from './ElidableDocument.ts';
import { TurnContext } from '../turnContext.ts';

class ReferencesSkillProcessor implements Skill.ISkillProcessor<Reference[]> {
  constructor(readonly turnContext: TurnContext) {}

  value(): number {
    return 1;
  }

  async processSkill(references: Reference[]): Promise<ElidableText | undefined> {
    const fileReader = this.turnContext.ctx.get(FileReader);
    const chunks: [ElidableText | string, number][] = [];
    const filteredReferences = await this.filterIncludedFiles(references);
    const fileChunks = (await this.toFileChunks(filteredReferences, fileReader)).filter((c) => c !== undefined).flat();
    if (fileChunks.length > 0) {
      chunks.push([
        new ElidableText(['The user wants you to consider the following referenced files when computing your answer.']),
        1,
      ]);
      chunks.push(...fileChunks);
      return new ElidableText(chunks);
    }
  }

  async filterIncludedFiles<T extends Reference>(files: T[]): Promise<T[]> {
    return files.filter((f) => f.type === 'file' && !this.turnContext.isFileIncluded(f.uri));
  }

  async toFileChunks(
    references: Reference[],
    fileReader: FileReader
  ): Promise<([ElidableText | string, number][] | undefined)[]> {
    return await Promise.all(
      references.map(async (ref) => {
        if (ref.type === 'file' && ref.uri) return await this.elideReferencedFiles(fileReader, ref);
      })
    );
  }

  async elideReferencedFiles(
    fileReader: FileReader,
    ref: Extract<Reference, { type: 'file' }>
  ): Promise<[ElidableText | string, number][] | undefined> {
    const documentResult = await fileReader.readFile(ref.uri);
    const fileStatus = statusFromTextDocumentResult(documentResult);
    await this.turnContext.collectFile(ReferencesSkillId, ref.uri, fileStatus);
    if (documentResult.status === 'valid') {
      const filePath = await fileReader.getRelativePath(documentResult.document);
      if (fileStatus === 'included') {
        const elidableDoc = new ElidableDocument(documentResult.document, ref.selection, ref.visibleRange);
        return [
          [`Code excerpt from referenced file \`${filePath}\`:`, 1],
          [elidableDoc.fromAllCode({ addLineNumbers: false }), 1],
        ];
      } else if (fileStatus === 'empty') {
        return [[new ElidableText([`The referenced file \`${filePath}\` is empty.`]), 1]];
      }
    }
  }
}

class ReferencesSkillResolver implements Skill.ISkillResolver<Reference[]> {
  async resolveSkill(turnContext: TurnContext): Promise<Reference[] | undefined> {
    if (turnContext.turn.request.references && turnContext.turn.request.references.length > 0)
      return turnContext.turn.request.references;
  }
}

const ReferencesSkillId: 'references' = 'references';

class ReferencesSkill implements Skill.ISkill<typeof ReferencesSkillId, Reference[]> {
  id = ReferencesSkillId;
  type: 'implicit' | 'explicit' = 'implicit';

  description(): string {
    return "The code from the user's referenced files";
  }

  resolver(): ReferencesSkillResolver {
    return new ReferencesSkillResolver();
  }

  processor(turnContext: TurnContext): ReferencesSkillProcessor {
    return new ReferencesSkillProcessor(turnContext);
  }
}

export { ReferencesSkillProcessor, ReferencesSkillResolver, ReferencesSkillId, ReferencesSkill, Reference };
