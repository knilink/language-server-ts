import type { TurnContext } from '../turnContext.ts';
import type { CopilotTextDocument } from '../../textDocument.ts';

import { TestFileFinder, isTestFile } from './testFiles.ts';
import { TestContextSkillId } from '../skills/TestContextSkill.ts';
import { FileReader, statusFromTextDocumentResult } from '../../fileReader.ts';
import { FileSystem } from '../../fileSystem.ts';
import { TextDocumentManager } from '../../textDocumentManager.ts';
import { ElidableText } from '../../../../prompt/src/elidableText/elidableText.ts';
import { elidableTextForSourceCode } from '../../../../prompt/src/elidableText/fromSourceCode.ts';
import type {} from '../../../../prompt/src/elidableText/index.ts';

const implPromptPrefix = 'Code excerpt from the implementation source file';
const testPromptPrefix = 'Code excerpt from the test file';
const testExamplePromptPrefix = 'Code excerpt from an example test file';

class PromptForTestGeneration {
  constructor(readonly turnContext: TurnContext) {}

  async fromImplementationFile(implFile: CopilotTextDocument): Promise<ElidableText | undefined> {
    const workspaceFolder = await this.turnContext.ctx.get(TextDocumentManager).getWorkspaceFolder(implFile);
    // const fileExists = this.fileExistFn();
    const finder = new TestFileFinder(this.turnContext.ctx, this.fileExists, workspaceFolder?.uri);
    const correspondingTestFile = await finder.findTestFileForSourceFile(implFile.uri);
    const activeDocumentIsTest = await isTestFile(implFile.uri);

    if (correspondingTestFile && !activeDocumentIsTest) {
      const languageId = implFile.languageId;
      if (await this.fileExists(correspondingTestFile)) {
        return await this.asTestFilePrompt(languageId, correspondingTestFile);
      } else {
        const exampleTestFile = finder.findExampleTestFile(implFile.uri);
        if (exampleTestFile) {
          return await this.asExampleFilePrompt(languageId, exampleTestFile);
        }
      }
    }
  }

  public async fromTestFile(testFile: CopilotTextDocument): Promise<ElidableText | undefined> {
    if (!(await isTestFile(testFile.uri))) return;

    const workspaceFolder = await this.turnContext.ctx.get(TextDocumentManager).getWorkspaceFolder(testFile);
    // const fileExists = this.fileExistFn();
    const correspondingImplFile = await new TestFileFinder(
      this.turnContext.ctx,
      this.fileExists,
      workspaceFolder?.uri
    ).findImplFileForTestFile(testFile.uri);

    if (correspondingImplFile) {
      const languageId = testFile.languageId;
      if (await this.fileExists(correspondingImplFile)) {
        return await this.asImplFilePrompt(languageId, correspondingImplFile);
      }
    }
  }

  async asImplFilePrompt(languageId: string, sourceFile: string): Promise<ElidableText> {
    const fileInfo = await this.fileInfoForPrompt(sourceFile);
    if (fileInfo) {
      const [code, filePath] = fileInfo;
      return new ElidableText([
        [`${implPromptPrefix} \`${filePath}\`:`, 1],
        ['```' + languageId, 1],
        [code, 0.9],
        ['```', 1],
      ]);
    }
    return new ElidableText([]);
  }

  async asTestFilePrompt(languageId: string, testFile: string): Promise<ElidableText> {
    const fileInfo = await this.fileInfoForPrompt(testFile);
    if (fileInfo) {
      const [code, filePath] = fileInfo;
      return new ElidableText([
        [`${testPromptPrefix} \`${filePath}\`:`, 1],
        ['```' + languageId, 1],
        [code, 0.9],
        ['```', 1],
      ]);
    }
    return new ElidableText([]);
  }

  private async asExampleFilePrompt(languageId: string, exampleTestFile: string): Promise<ElidableText> {
    const fileInfo = await this.fileInfoForPrompt(exampleTestFile);
    if (fileInfo) {
      const [code, filePath] = fileInfo;
      return new ElidableText([
        [`${testExamplePromptPrefix} \`${filePath}\`:`, 1],
        ['```' + languageId, 1],
        [code, 0.9],
        ['```', 1],
      ]);
    }
    return new ElidableText([]);
  }

  private async fileInfoForPrompt(file: string): Promise<[ElidableText, string] | undefined> {
    if (!this.turnContext.isFileIncluded(file.toString())) {
      const fileReader = this.turnContext.ctx.get(FileReader);
      const documentResult = await fileReader.readFile(file.toString());
      await this.turnContext.collectFile(
        TestContextSkillId,
        file.toString(),
        statusFromTextDocumentResult(documentResult)
      );
      if (documentResult.status === 'valid') {
        const filePath = await fileReader.getRelativePath(documentResult.document);
        return [elidableTextForSourceCode(documentResult.document.getText()), filePath];
      }
    }
  }

  // private fileExistFn(): (file: URI) => Promise<boolean> {
  //   return async (file: URI): Promise<boolean> => {
  //     try {
  //       await this.turnContext.ctx.get(FileSystem).stat(file);
  //       return true;
  //     } catch {
  //       return false;
  //     }
  //   };
  // }
  fileExists = async (file: string): Promise<boolean> => {
    try {
      await this.turnContext.ctx.get(FileSystem).stat(file);
      return true;
    } catch {
      return false;
    }
  };
}

export { PromptForTestGeneration };
