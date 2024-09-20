import { type Static } from '@sinclair/typebox';
import { Skill } from '../../types.ts';
import { type TurnContext } from '../turnContext.ts';

import { DocumentSchema } from '../schema.ts';

import { FileReader, statusFromTextDocumentResult } from '../../fileReader.ts';
import { isEmptyRange, ElidableDocument } from './ElidableDocument.ts';
import { ElidableText } from '../../../../prompt/src/elidableText/elidableText.ts';

type Document = Static<typeof DocumentSchema>;

class CurrentEditorSkillProcessor implements Skill.ISkillProcessor<Document> {
  constructor(readonly turnContext: TurnContext) {}

  value(): number {
    return 1;
  }

  async processSkill(skill: Document): Promise<ElidableText | undefined> {
    const fileReader = this.turnContext.ctx.get(FileReader);
    const documentResult = await fileReader.readFile(skill.uri);
    const fileStatus = statusFromTextDocumentResult(documentResult);
    await this.turnContext.collectFile(CurrentEditorSkillId, skill.uri, fileStatus);
    if (documentResult.status === 'valid') {
      const isInline = this.turnContext.conversation.source === 'inline';
      const elidableDoc = new ElidableDocument(documentResult.document, skill.selection, skill.visibleRange);
      const filePath = await fileReader.getRelativePath(documentResult.document);

      if (fileStatus === 'empty') {
        return new ElidableText([`The currently open file \`${filePath}\` is empty.`]);
      }

      const editorExcerpt: ElidableText.Chunk[] = [
        [`Code excerpt from the currently open file \`${filePath}\`:`, 1],
        [elidableDoc.fromAllCode({ addLineNumbers: isInline }), 1],
      ];
      let selectionExcerpt: ElidableText.Chunk[] = [];
      if (elidableDoc.selectionIsDocument()) {
        selectionExcerpt = [['The user is selecting the entire file.', 1]];
      } else if (isInline) {
        const [selectionText, selectionRange] = elidableDoc.fromSelectedCode({ trimNewLines: true });
        const startLine = selectionRange.start.line + 1;
        if (isEmptyRange(selectionRange)) {
          selectionExcerpt = [[`The user is selecting line ${startLine}, which is empty.`, 1]];
        } else {
          const endLine = selectionRange.end.line + 1;
          selectionExcerpt = [
            [
              'The user is selecting' +
                (startLine === endLine ? ` line ${startLine}:` : ` lines ${startLine} to ${endLine} (inclusive):`),
              1,
            ],
            [selectionText, 1],
          ];
        }
      } else if (!elidableDoc.selectionIsEmpty()) {
        selectionExcerpt = [
          ['The user is selecting this code:', 1],
          [elidableDoc.fromSelectedCode({ trimNewLines: false })[0], 1],
        ];
      }

      return new ElidableText([...editorExcerpt, ...selectionExcerpt]);
    }
  }
}

const CurrentEditorSkillId: 'current-editor' = 'current-editor';
namespace CurrentEditorSkill {
  export type Skill = Document;
}

class CurrentEditorSkill implements Skill.ISkill<typeof CurrentEditorSkillId, Document> {
  readonly id = CurrentEditorSkillId;
  readonly type = 'explicit';

  constructor(private _resolver: Skill.ISkillResolver<Document>) {}

  description(): string {
    return "The code from the user's currently open file";
  }

  resolver(): Skill.ISkillResolver<Document> {
    return this._resolver;
  }

  processor(turnContext: TurnContext): CurrentEditorSkillProcessor {
    return new CurrentEditorSkillProcessor(turnContext);
  }
}

export { CurrentEditorSkill, CurrentEditorSkillId, DocumentSchema as CurrentEditorSchema, Document as CurrentEditor };
