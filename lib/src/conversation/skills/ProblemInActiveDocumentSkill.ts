import { Range } from 'vscode-languageserver-types';
import { type Static, Type } from '@sinclair/typebox';

import type { Skill } from '../../types.ts';

import {} from '../modelMetadata.ts';
import { SingleStepReportingSkill } from '../prompt/conversationSkill.ts';
import { FileReader, statusFromTextDocumentResult } from '../../fileReader.ts';
import { weighElidableList } from '../prompt/elidableList.ts';
import { elidableTextForSourceCode } from '../../../../prompt/src/elidableText/fromSourceCode.ts';
import { RangeSchema } from '../../../../types/src/index.ts';
import { ModelConfigurationProvider } from '../modelConfigurations.ts';
import { getSupportedModelFamiliesForPrompt } from '../modelMetadata.ts';
import { ElidableText } from '../../../../prompt/src/elidableText/elidableText.ts';

import { TurnContext } from '../turnContext.ts';
import { ValidDocumentResult } from '../../util/documentEvaluation.ts';

const ProblemsInActiveDocumentSchema = Type.Object({
  uri: Type.String(),
  problems: Type.Array(Type.Object({ message: Type.String(), range: RangeSchema })),
});

type ProblemsInActiveDocument = Static<typeof ProblemsInActiveDocumentSchema>;

class ProblemsInActiveDocumentSkillProcessor implements Skill.ISkillProcessor<ProblemsInActiveDocument> {
  constructor(readonly turnContext: TurnContext) {}

  value() {
    return 1;
  }

  async processSkill(skill: ProblemsInActiveDocument): Promise<ElidableText | undefined> {
    const fileReader = this.turnContext.ctx.get(FileReader);
    const documentResult = await fileReader.readFile(skill.uri);

    await this.turnContext.collectFile(
      ProblemsInActiveDocumentSkillId,
      skill.uri,
      statusFromTextDocumentResult(documentResult)
    );

    if (documentResult.status === 'valid') {
      const filePath = await fileReader.getRelativePath(documentResult.document);
      this.turnContext.collectLabel(ProblemsInActiveDocumentSkillId, `problems in ${filePath}`);
      const elidableProblems = this.getElidableProblems(skill, documentResult, filePath);
      return await this.preElideDocuments(elidableProblems);
    } else {
      this.turnContext.collectLabel(ProblemsInActiveDocumentSkillId, 'problem markers');
    }
  }

  getElidableProblems(
    skill: ProblemsInActiveDocument,
    documentResult: ValidDocumentResult,
    filePath: string
  ): ElidableText {
    const chunks = [];
    chunks.push(new ElidableText([`Problems and errors in the active document (\`${filePath}\`):`]));
    chunks.push(...this.createElidableProblems(skill, documentResult));
    return weighElidableList(chunks, 'linear');
  }

  createElidableProblems(skill: ProblemsInActiveDocument, documentResult: ValidDocumentResult): ElidableText[] {
    return skill.problems.map((problem) => {
      const elidableProblem = [];
      elidableProblem.push(
        new ElidableText([
          `- "${problem.message}" at line ${problem.range.start.line}.` +
            (documentResult.document ? ' Excerpt from the code:' : ''),
        ])
      );
      const problemRange = problem.range;
      let problemText: string | undefined;
      if (problemRange && this.isEmpty(problemRange)) {
        problemText = documentResult.document.lineAt(problemRange.start).text;
      } else {
        problemText = documentResult.document.getText(problemRange);
      }

      if (problemText) {
        const languageId = documentResult.document.languageId;
        elidableProblem.push(
          new ElidableText([
            ['```' + languageId, 1],
            [elidableTextForSourceCode(problemText), 0.8],
            ['```', 1],
          ])
        );
      }

      return new ElidableText(elidableProblem);
    });
  }

  isEmpty(range: Range): boolean {
    return range.start.line === range.end.line && range.start.character === range.end.character;
  }

  async preElideDocuments(elidableDocs: ElidableText): Promise<ElidableText> {
    const { maxRequestTokens } = await this.turnContext.ctx
      .get(ModelConfigurationProvider)
      .getBestChatModelConfig(getSupportedModelFamiliesForPrompt('user'));
    const elidedDocs = elidableDocs.makePrompt(Math.floor(maxRequestTokens * 0.1));
    return new ElidableText([elidedDocs]);
  }
}

const ProblemsInActiveDocumentSkillId: 'problems-in-active-document' = 'problems-in-active-document';

class ProblemsInActiveDocumentSkill extends SingleStepReportingSkill<
  typeof ProblemsInActiveDocumentSkillId,
  ProblemsInActiveDocument
> {
  constructor(_resolver: Skill.ISkillResolver<ProblemsInActiveDocument>) {
    super(
      ProblemsInActiveDocumentSkillId,
      'List of problems and errors in the active document, useful when the user question is about finding and fixing errors, non-functioning code, compilation issues, etc.',

      'Analyzing problems and errors',
      () => _resolver,
      (turnContext) => new ProblemsInActiveDocumentSkillProcessor(turnContext),
      'explicit',
      [
        'How can I fix the errors?',
        'Why is my app not working?',
        'Why am I getting compilation errors?',
        'Raw error messages or stack traces',
      ]
    );
  }
}

export {
  ProblemsInActiveDocumentSkillProcessor,
  ProblemsInActiveDocumentSkill,
  ProblemsInActiveDocumentSkillId,
  ProblemsInActiveDocumentSchema,
};
