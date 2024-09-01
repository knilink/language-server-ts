import { type Static, Type } from '@sinclair/typebox';
import { URI } from 'vscode-uri';

import { statusFromTextDocumentResult, FileReader } from "../../fileReader.ts";
import { SingleStepReportingSkill } from "../prompt/conversationSkill.ts";
import { PromptForTestGeneration } from "../prompt/testPrompt.ts";
import { Skill } from "../../types.ts";
import { ElidableText } from "../../../../prompt/src/elidableText/index.ts";
import { TurnContext } from "../turnContext.ts";

export const TestContextSchema = Type.Object({
  currentFileUri: Type.String(),
  sourceFileUri: Type.Optional(Type.String()),
  testFileUri: Type.Optional(Type.String()),
});

type TestContext = Static<typeof TestContextSchema>;

class TestContextSkillProcessor implements Skill.ISkillProcessor<TestContext> {
  constructor(readonly turnContext: TurnContext) { }

  value(): number {
    return 0.9;
  }

  async processSkill(skill: TestContext): Promise<ElidableText | undefined> {
    const fileReader = this.turnContext.ctx.get(FileReader);
    const promptGenerator = new PromptForTestGeneration(this.turnContext);
    if (skill.sourceFileUri && skill.testFileUri) {
      if (skill.sourceFileUri !== skill.currentFileUri && skill.testFileUri !== skill.currentFileUri) return;
      if (skill.testFileUri === skill.currentFileUri) {
        const documentResult = await fileReader.readFile(skill.testFileUri);
        this.turnContext.collectFile(
          TestContextSkillId,
          skill.testFileUri,
          statusFromTextDocumentResult(documentResult)
        );
        if (documentResult.status === 'valid')
          return await promptGenerator.asImplFilePrompt(
            documentResult.document.languageId,
            URI.parse(skill.sourceFileUri)
          );
      } else if (skill.sourceFileUri === skill.currentFileUri) {
        const documentResult = await fileReader.readFile(skill.sourceFileUri);
        this.turnContext.collectFile(
          TestContextSkillId,
          skill.sourceFileUri,
          statusFromTextDocumentResult(documentResult)
        );
        if (documentResult.status === 'valid')
          return await promptGenerator.asTestFilePrompt(
            documentResult.document.languageId,
            URI.parse(skill.testFileUri)
          );
      }
    } else if (skill.sourceFileUri && skill.sourceFileUri === skill.currentFileUri) {
      const documentResult = await fileReader.readFile(skill.sourceFileUri);
      this.turnContext.collectFile(
        TestContextSkillId,
        skill.sourceFileUri,
        statusFromTextDocumentResult(documentResult)
      );
      if (documentResult.status === 'valid')
        return await promptGenerator.fromImplementationFile(documentResult.document);
    } else if (skill.testFileUri && skill.testFileUri === skill.currentFileUri) {
      const documentResult = await fileReader.readFile(skill.testFileUri);
      this.turnContext.collectFile(TestContextSkillId, skill.testFileUri, statusFromTextDocumentResult(documentResult));
      if (documentResult.status === 'valid') return await promptGenerator.fromTestFile(documentResult.document);
    }
  }
}

const TestContextSkillId: 'test-context' = 'test-context';

class TestContextSkill extends SingleStepReportingSkill<typeof TestContextSkillId, TestContext> {
  constructor(resolver: Skill.ISkillResolver<TestContext>) {
    super(
      TestContextSkillId,
      'Example tests useful for creating, adding and fixing tests, to detect available test frameworks as well as finding the corresponding implementation to existing tests',
      'Searching test examples',
      () => resolver,
      (turnContext: TurnContext) => new TestContextSkillProcessor(turnContext)
    );
  }
}

export { TestContextSkillProcessor, TestContextSkill, TestContextSkillId };
