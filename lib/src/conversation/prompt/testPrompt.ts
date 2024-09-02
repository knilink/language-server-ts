import { URI } from 'vscode-uri';

import { TextDocumentManager } from '../../textDocumentManager.ts';
import { isTestFile, TestFileFinder } from './testFiles.ts';
import { FileReader, statusFromTextDocumentResult } from '../../fileReader.ts';
import { TestContextSkillId } from '../skills/TestContextSkill.ts';
import { elidableTextForSourceCode } from '../../../../prompt/src/elidableText/fromSourceCode.ts';
import { FileSystem } from '../../fileSystem.ts';
import { ElidableText } from '../../../../prompt/src/elidableText/elidableText.ts';
import { TurnContext } from '../turnContext.ts';
import { TextDocument } from '../../textDocument.ts';

const implPromptPrefix = 'Code excerpt from the implementation source file';
const testPromptPrefix = 'Code excerpt from the test file';
const testExamplePromptPrefix = 'Code excerpt from an example test file';

class PromptForTestGeneration {
  constructor(readonly turnContext: TurnContext) {}

  async fromImplementationFile(implFile: TextDocument): Promise<ElidableText | undefined> {
    const workspaceFolder = await this.turnContext.ctx.get(TextDocumentManager).getWorkspaceFolder(implFile);
    // const fileExists = this.fileExistFn();
    const finder = new TestFileFinder(this.turnContext.ctx, this.fileExists, workspaceFolder);
    const correspondingTestFile = await finder.findTestFileForSourceFile(implFile.vscodeUri);
    const activeDocumentIsTest = await isTestFile(implFile.vscodeUri);

    if (correspondingTestFile && !activeDocumentIsTest) {
      const languageId = implFile.languageId;
      if (await this.fileExists(correspondingTestFile)) {
        return await this.asTestFilePrompt(languageId, correspondingTestFile);
      } else {
        const exampleTestFile = finder.findExampleTestFile(implFile.vscodeUri);
        if (exampleTestFile) {
          return await this.asExampleFilePrompt(languageId, exampleTestFile);
        }
      }
    }
  }

  public async fromTestFile(testFile: TextDocument): Promise<ElidableText | undefined> {
    if (!(await isTestFile(testFile.vscodeUri))) return;

    const workspaceFolder = await this.turnContext.ctx.get(TextDocumentManager).getWorkspaceFolder(testFile);
    // const fileExists = this.fileExistFn();
    const correspondingImplFile = await new TestFileFinder(
      this.turnContext.ctx,
      this.fileExists,
      workspaceFolder
    ).findImplFileForTestFile(testFile.vscodeUri);

    if (correspondingImplFile) {
      const languageId = testFile.languageId;
      if (await this.fileExists(correspondingImplFile)) {
        return await this.asImplFilePrompt(languageId, correspondingImplFile);
      }
    }
  }

  async asImplFilePrompt(languageId: string, sourceFile: URI): Promise<ElidableText> {
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

  async asTestFilePrompt(languageId: string, testFile: URI): Promise<ElidableText> {
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

  private async asExampleFilePrompt(languageId: string, exampleTestFile: URI): Promise<ElidableText> {
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

  private async fileInfoForPrompt(file: URI): Promise<[ElidableText, string] | undefined> {
    if (!this.turnContext.isFileIncluded(file.toString())) {
      const fileReader = this.turnContext.ctx.get(FileReader);
      const documentResult = await fileReader.readFile(file.toString());
      this.turnContext.collectFile(TestContextSkillId, file.toString(), statusFromTextDocumentResult(documentResult));
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
  fileExists = async (file: URI): Promise<boolean> => {
    try {
      await this.turnContext.ctx.get(FileSystem).stat(file);
      return true;
    } catch {
      return false;
    }
  };
}

export { PromptForTestGeneration };
