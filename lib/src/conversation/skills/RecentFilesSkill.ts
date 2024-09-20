import type { Skill } from '../../types.ts';
import { Type, type Static } from '@sinclair/typebox';
import { type TurnContext } from '../turnContext.ts';

import { SingleStepReportingSkill } from '../prompt/conversationSkill.ts';

import { DocumentSchema } from '../schema.ts';
import { weighElidableList } from '../prompt/elidableList.ts';
import { FileReader, statusFromTextDocumentResult } from '../../fileReader.ts';
import { ModelConfigurationProvider } from '../modelConfigurations.ts';
import { getSupportedModelFamiliesForPrompt } from '../modelMetadata.ts';
import { ElidableDocument } from './ElidableDocument.ts';
import { ElidableText } from '../../../../prompt/src/elidableText/elidableText.ts';
import { TextDocument } from '../../textDocument.ts';

const RecentFilesSchema = Type.Object({ files: Type.Array(DocumentSchema) });
type RecentFiles = Static<typeof RecentFilesSchema>;

type Document = Static<typeof DocumentSchema>;

const MAX_FILES = 3;

class RecentFilesSkillProcessor implements Skill.ISkillProcessor<RecentFiles> {
  constructor(readonly turnContext: TurnContext) {}

  value(): number {
    return 0.7;
  }

  async processSkill(skill: RecentFiles): Promise<ElidableText | undefined> {
    const documents = await this.getDocuments(skill);
    if (documents.length > 0) {
      const elidableDocs = await this.toElidableDocs(documents);
      const asList = weighElidableList(elidableDocs, 'inversePositional');
      return await this.preElideDocuments(asList);
    }
  }

  async getDocuments(skill: RecentFiles): Promise<[TextDocument, Document][]> {
    const files = await this.filterIncludedDocs(this.sortFiles(skill.files));
    const fileReader = this.turnContext.ctx.get(FileReader);
    const documents: [TextDocument, Document][] = [];

    for (let file of files) {
      const documentResult = await fileReader.readFile(file.uri);
      const fileStatus = statusFromTextDocumentResult(documentResult);

      await this.turnContext.collectFile(RecentFilesSkillId, file.uri, fileStatus);
      if (documentResult.status === 'valid' && fileStatus !== 'empty') {
        documents.push([documentResult.document, file]);
        if (documents.length === MAX_FILES) break;
      }
    }
    return documents.reverse();
  }

  sortFiles(files: Document[]): Document[] {
    //return files
    //  .sort((a, b) => {
    //    if (a.activeAt && b.activeAt) {
    //      return new Date(a.activeAt).getTime() - new Date(b.activeAt).getTime();
    //    } else if (a.activeAt) {
    //      return -1;
    //    } else if (b.activeAt) {
    //      return 1;
    //    } else {
    //      return 0;
    //    }
    //  })
    //  .reverse();

    // EDITED
    return files.sort((a, b) => {
      const timeA = a.activeAt ? new Date(a.activeAt).getTime() : -Infinity;
      const timeB = b.activeAt ? new Date(b.activeAt).getTime() : -Infinity;
      return timeB - timeA;
    });
  }

  async filterIncludedDocs(files: Document[]): Promise<Document[]> {
    return files.filter((d) => !this.turnContext.isFileIncluded(d.uri));
  }

  async toElidableDocs(documents: Array<[TextDocument, Document]>): Promise<Array<ElidableText>> {
    const fileReader = this.turnContext.ctx.get(FileReader);
    return await Promise.all(
      documents.map(async (document) => {
        const [doc, openFile] = document;
        const filePath = await fileReader.getRelativePath(doc);
        const elidableDoc = new ElidableDocument(doc, undefined, openFile.visibleRange);
        return new ElidableText([
          [`Code excerpt from file \`${filePath}\`:`, 1],
          [elidableDoc.fromAllCode({ addLineNumbers: false }), 0.9],
        ]);
      })
    );
  }

  async preElideDocuments(elidableDocs: ElidableText): Promise<ElidableText> {
    const modelConfigProvider = this.turnContext.ctx.get(ModelConfigurationProvider);
    const { maxRequestTokens } = await modelConfigProvider.getBestChatModelConfig(
      getSupportedModelFamiliesForPrompt('user')
    );

    const elidedDocs = elidableDocs.makePrompt(Math.floor(maxRequestTokens * 0.1));
    return new ElidableText([elidedDocs]);
  }
}

const RecentFilesSkillId: 'recent-files' = 'recent-files';

class RecentFilesSkill extends SingleStepReportingSkill<typeof RecentFilesSkillId, RecentFiles> {
  constructor(_resolver: Skill.ISkillResolver<RecentFiles>) {
    super(
      RecentFilesSkillId,
      "Provides code examples helpful for creating, explaining, refactoring, or fixing code. It's based on the files the user has worked on in the editor.",
      'Resolving recent files',
      () => _resolver,
      (turnContext: TurnContext) => new RecentFilesSkillProcessor(turnContext)
    );
  }
}

export { RecentFilesSchema, MAX_FILES, RecentFilesSkillProcessor, RecentFilesSkillId, RecentFilesSkill, RecentFiles };
