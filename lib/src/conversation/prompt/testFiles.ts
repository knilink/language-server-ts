import * as fs from 'fs';
import * as path from 'path';
import { URI, Utils } from 'vscode-uri';

import { Context } from "../../context.ts";
import { logger } from "../../logger.ts";

const TestSuffixTypes: string[] = ['.test', '.spec', '_test', 'Test', '_spec', '_test', 'Tests', '.Tests', 'Spec'];
const TestPrefixTypes: string = 'test_';
const testFileHints: {
  [key: string]: ({ suffix: string[]; prefix?: never } | { suffix?: never; prefix: string }) & {
    location: 'sameFolder' | 'testFolder';
  };
} = {
  js: { suffix: ['.test', '.spec'], location: 'sameFolder' },
  ts: { suffix: ['.test', '.spec'], location: 'sameFolder' },
  go: { suffix: ['_test'], location: 'sameFolder' },
  java: { suffix: ['Test'], location: 'testFolder' },
  php: { suffix: ['Test'], location: 'testFolder' },
  dart: { suffix: ['_test'], location: 'testFolder' },
  cs: { suffix: ['Test'], location: 'testFolder' },
  rb: { suffix: ['_test', '_spec'], location: 'testFolder' },
  py: { prefix: 'test_', location: 'testFolder' },
  ps1: { suffix: ['.Tests'], location: 'testFolder' },
  kt: { suffix: ['Test'], location: 'testFolder' },
};

export async function isTestFile(potentialTestFile: URI): Promise<boolean> {
  const sourceFileName = Utils.basename(potentialTestFile);
  const sourceFileExtension = Utils.extname(potentialTestFile).replace('.', '');
  const testHint = testFileHints[sourceFileExtension];
  return testHint
    ? !(
      (testHint.suffix && !testHint.suffix.some((suffix) => sourceFileName.endsWith(suffix + sourceFileExtension))) ||
      (testHint.prefix && !sourceFileName.startsWith(testHint.prefix))
    )
    : !!(
      TestSuffixTypes.some((suffix) => sourceFileName.endsWith(suffix + sourceFileExtension)) ||
      sourceFileName.startsWith(TestPrefixTypes)
    );
}

class TestFileFinder {
  constructor(
    readonly ctx: Context,
    readonly fileExists: (filePath: URI) => Promise<boolean>,
    readonly basePath?: URI
  ) { }

  public async findTestFileForSourceFile(sourceFile: URI): Promise<URI | undefined> {
    const sourceFileName = Utils.basename(sourceFile);
    const sourceFileExtension = Utils.extname(sourceFile).replace('.', '');
    const fileHint = testFileHints[sourceFileExtension] ?? {
      location: 'sameFolder',
      prefix: TestPrefixTypes,
      suffix: TestSuffixTypes,
    };
    const testFileNames: string[] = [];

    if (fileHint.prefix) {
      testFileNames.push(fileHint.prefix + sourceFileName);
    }
    if (fileHint.suffix) {
      for (const suffix of fileHint.suffix ?? []) {
        const testName = sourceFileName.replace(`.${sourceFileExtension} `, `${suffix}.${sourceFileExtension}`);
        testFileNames.push(testName);
      }
    }

    const location = fileHint.location ?? 'sameFolder';
    let testFolder: string;

    if (location === 'sameFolder') {
      testFolder = Utils.dirname(sourceFile).fsPath;
    } else {
      testFolder = this.determineTestFolder(sourceFile.fsPath, location);
    }

    for (const testFileName of testFileNames) {
      const testFilePath = path.join(testFolder, testFileName);
      const candidate = this.parseTestFilePath(testFilePath);
      if (candidate && (await this.fileExists(candidate))) return candidate;
    }

    if (await this.fileExists(URI.file(testFolder))) {
      const testFilePath = path.join(testFolder, testFileNames[0]);
      return URI.file(testFilePath);
    }
  }

  private parseTestFilePath(testFilePath: string): URI | undefined {
    try {
      return URI.file(testFilePath);
    } catch (e) {
      logger.error(this.ctx, `Failed to parse test file path: ${testFilePath} `, e);
      return;
    }
  }

  public async findImplFileForTestFile(sourceFile: URI): Promise<URI | undefined> {
    const testFileName = Utils.basename(sourceFile);
    const testFileExtension = Utils.extname(sourceFile).replace('.', '');
    const fileHint = testFileHints[testFileExtension] ?? {
      location: 'sameFolder',
      prefix: TestPrefixTypes,
      suffix: TestSuffixTypes,
    };
    const implFileNames: string[] = [];

    if (fileHint.prefix) {
      implFileNames.push(testFileName.substring(fileHint.prefix.length));
    }
    if (fileHint.suffix) {
      for (const suffix of fileHint.suffix ?? []) {
        const implName =
          testFileName.substring(0, testFileName.length - suffix.length - 1 - testFileExtension.length) +
          `.${testFileExtension}`;
        implFileNames.push(implName);
      }
    }

    const location = fileHint.location ?? 'sameFolder';
    let implFolder: URI;

    if (location === 'sameFolder') {
      implFolder = Utils.dirname(sourceFile);
    } else {
      implFolder = this.determineImplFolder(sourceFile);
    }

    for (const implFileName of implFileNames) {
      const implFile = Utils.joinPath(implFolder, implFileName);
      if (await this.fileExists(implFile)) return implFile;
    }
  }

  public findExampleTestFile(sourceFile: URI): URI | undefined {
    const sourceFilePath = sourceFile.fsPath;
    const sourceFileExtension = Utils.extname(sourceFile).replace('.', '');
    let testFolder: string;
    const location = testFileHints[sourceFileExtension]?.location ?? 'sameFolder';

    if (location === 'sameFolder') {
      testFolder = path.dirname(sourceFilePath);
    } else {
      testFolder = this.determineTestFolder(sourceFilePath, location);
    }

    const testFiles = this.findFiles(testFolder, `.${sourceFileExtension}`, testFileHints[sourceFileExtension]);
    if (testFiles.length > 0) return URI.file(testFiles[0]);
  }

  private findFiles(
    dir: string,
    extension: string,
    hint?: { prefix: string; suffix?: never } | { prefix?: never; suffix: string[] }
  ): string[] {
    const entries = this._readdir(dir);
    const files: string[] = [];

    for (const name of entries) {
      if (hint?.prefix && name.startsWith(hint.prefix)) {
        files.push(`${dir}${path.sep}${name}`);
      }
      if (hint?.suffix?.some((suffix) => name.endsWith(suffix + extension))) {
        files.push(`${dir}${path.sep}${name}`);
      }
    }

    return files;
  }

  private _readdir(dir: string): string[] {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((dirent) => dirent.isFile())
      .map((dirent) => dirent.name);
  }

  private determineTestFolder(sourceFilePath: string, location: 'sameFolder' | 'testFolder'): string {
    const basePath = this.basePath?.fsPath ?? '';
    const extension = path.extname(sourceFilePath).replace('.', '');
    const relativeTestFolder = this.getRelativeTestFolder(sourceFilePath, basePath, extension, location);
    // return [basePath, ...relativeTestFolder].filter((x) => x).join(path.sep);
    return path.join(basePath, ...relativeTestFolder);
  }

  private getRelativeTestFolder(
    sourceFilePath: string,
    basePath: string,
    extension: string,
    location: 'sameFolder' | 'testFolder'
  ): string[] {
    const relativeFolder = path.dirname(sourceFilePath).replace(basePath, '');

    switch (extension) {
      case 'php':
      case 'dart':
      case 'py':
        return ['tests'];
      case 'ps1':
        return ['Tests'];
      case 'rb':
        return ['test', relativeFolder];
      case 'cs':
        // return [relativeFolder.replace('src', 'src/tests')];
        return [relativeFolder.replace('src', path.join('src', 'tests'))];
      case 'java':
      case 'scala':
      case 'kt':
        // return [relativeFolder.replace(/src[\\/]main/, 'src/test')];
        return [relativeFolder.replace(path.join('src', 'main'), path.join('src', 'test'))];
      default:
        return location === 'testFolder' ? [relativeFolder.replace('src', 'test')] : [relativeFolder];
    }
  }

  private determineImplFolder(testFile: URI): URI {
    const extension = Utils.extname(testFile).replace('.', '');
    const testFolder = Utils.dirname(testFile);

    switch (extension) {
      case 'php':
      case 'dart':
      case 'py':
        return URI.parse(testFolder.fsPath.replace('tests', 'src'));
      case 'ps1':
        return URI.parse(testFolder.fsPath.replace('Tests', 'src'));
      case 'rb':
        // return URI.parse(testFolder.fsPath.replace('/test', ''));
        return URI.parse(testFolder.fsPath.replace(path.sep + 'test', ''));
      case 'cs':
        // return URI.parse(testFolder.fsPath.replace('src/tests', 'src'));
        return URI.parse(testFolder.fsPath.replace(path.join('src', 'tests'), 'src'));
      case 'java':
      case 'scala':
      case 'kt':
        // return URI.parse(testFolder.fsPath.replace('src/test', 'src/main'));
        return URI.parse(testFolder.fsPath.replace(path.join('src', 'test'), path.join('src', 'main')));
      default:
        // return URI.parse(testFolder.fsPath.replace('test/', 'src/'));
        return URI.parse(testFolder.fsPath.replace('test' + path.sep, 'src' + path.sep));
    }
  }
}

export { TestFileFinder };
