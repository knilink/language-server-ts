// import dedent from 'dedent';

import { Type, type Static } from '@sinclair/typebox';

import { SingleStepReportingSkill } from '../prompt/conversationSkill.ts';
import { FileReader, statusFromTextDocumentResult } from '../../fileReader.ts';
import { elidableTextForSourceCode } from '../../../../prompt/src/elidableText/fromSourceCode.ts';
import { RangeSchema } from '../../../../types/src/index.ts';
import { ElidableText } from '../../../../prompt/src/elidableText/elidableText.ts';
import { Skill } from '../../types.ts';
import { TextDocument } from '../../textDocument.ts';
import { TurnContext } from '../turnContext.ts';

const TestFailuresSchema = Type.Object({
  failures: Type.Array(
    Type.Object({
      testName: Type.String(),
      testSuite: Type.Optional(Type.String()),
      testFileUri: Type.String(),
      failureReason: Type.Optional(Type.String()),
      testLocation: RangeSchema,
    })
  ),
});

type TestFailures = Static<typeof TestFailuresSchema>;

class TestFailuresSkillProcessor implements Skill.ISkillProcessor<TestFailures> {
  constructor(readonly turnContext: TurnContext) {}

  value(): number {
    return 0.9;
  }

  async processSkill(skill: TestFailures): Promise<ElidableText | undefined> {
    if (skill.failures.length > 0) {
      this.turnContext.collectLabel(TestFailuresSkillId, 'test failures');
      const elidableFailures = await this.createElidableFailures(skill.failures);
      if (elidableFailures) {
        const intro = new ElidableText(['The latest test run produced the following failures and errors:']);
        return new ElidableText([
          [intro, 1],
          [elidableFailures, 1],
        ]);
      }
    }
  }

  async createElidableFailures(failures: TestFailures['failures']): Promise<ElidableText | undefined> {
    const fileReader = this.turnContext.ctx.get(FileReader);
    let elidableFailures: [ElidableText, number][] = [];
    const failuresByFile = this.groupFailuresByFile(failures);

    for (const [fileUri, failuresInFile] of failuresByFile.entries()) {
      const documentResult = await fileReader.readFile(fileUri);
      await this.turnContext.collectFile(TestFailuresSkillId, fileUri, statusFromTextDocumentResult(documentResult));
      if (documentResult.status === 'valid') {
        const filePath = await fileReader.getRelativePath(documentResult.document);
        const elidableFailuresOfDocument = this.createElidableFailuresOfDoc(failuresInFile, filePath);
        const elidableFailure = this.appendCode(elidableFailuresOfDocument, filePath, documentResult.document);
        elidableFailures.push([elidableFailure, 1]);
      }
    }

    if (elidableFailures.length > 0) {
      return new ElidableText(elidableFailures);
    }
  }

  groupFailuresByFile(failures: TestFailures['failures']): Map<string, TestFailures['failures']> {
    const failuresByFile = new Map<string, TestFailures['failures']>();
    for (const failure of failures) {
      const failuresInFile = failuresByFile.get(failure.testFileUri) || [];
      failuresInFile.push(failure);
      failuresByFile.set(failure.testFileUri, failuresInFile);
    }
    return failuresByFile;
  }

  createElidableFailuresOfDoc(failuresInFile: TestFailures['failures'], filePath: string): ElidableText {
    const failureTexts: ElidableText.Chunk[] = failuresInFile.map((failure) => {
      const formattedTest = `\`${failure.testName}\``;
      const formattedSuite = `${failure.testSuite ? ` in suite \`${failure.testSuite}\`` : ''}`;
      const formattedFile = ` in file \`${filePath}\` `;
      let formattedFailure = '. ';
      if (failure.failureReason) {
        formattedFailure = ' with the following error:';
        if (failure.failureReason.includes(`\n`)) {
          formattedFailure += '\n```\n' + failure.failureReason + '\n```\n';
        } else {
          formattedFailure += ` \`${failure.failureReason}\`. `;
        }
      }
      const formattedLines = `${failure.testLocation.start.line == failure.testLocation.end.line ? 'on line ' + failure.testLocation.start.line : 'between lines ' + failure.testLocation.start.line + ' and ' + failure.testLocation.end.line}`;
      return [
        new ElidableText([
          `\n\n- Test ${formattedTest}${formattedSuite}${formattedFile}failed${formattedFailure}The failed test is ${formattedLines}.\n`,
        ]),
        1,
      ];
    });
    return new ElidableText(failureTexts);
  }

  appendCode(elidableFailuresOfDocument: ElidableText, filePath: string, document: TextDocument): ElidableText {
    const codeDescription: [ElidableText, number] = [
      new ElidableText([`\nThe code of file \`${filePath}\` is:\n`]),
      0.6,
    ];
    const code: [ElidableText, number] = [
      new ElidableText([
        ['```' + document.languageId, 1],
        [elidableTextForSourceCode(document.getText()), 0.9],
        ['```', 1],
      ]),
      0.7,
    ];
    return new ElidableText([[elidableFailuresOfDocument, 1], codeDescription, code]);
  }
}

const TestFailuresSkillId: 'test-failures' = 'test-failures';

class TestFailuresSkill extends SingleStepReportingSkill<typeof TestFailuresSkillId, TestFailures> {
  constructor(_resolver: Skill.ISkillResolver<TestFailures>) {
    super(
      TestFailuresSkillId,
      'Test failures and errors of the latest test run',
      'Collecting test failures',
      () => _resolver,
      (turnContext: TurnContext) => new TestFailuresSkillProcessor(turnContext)
    );
  }
}

export { TestFailuresSchema, TestFailuresSkillProcessor, TestFailuresSkillId, TestFailuresSkill };
