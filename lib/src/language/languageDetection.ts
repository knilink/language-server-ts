import path from 'path';

import { knownLanguages } from './generatedLanguages.ts';
import { Context } from '../context.ts';
import { TextDocumentManager, INotebook } from '../textDocumentManager.ts';
import { knownTemplateLanguageExtensions, knownFileExtensions, templateLanguageLimitations } from './languages.ts';
import { LRUCacheMap } from '../common/cache.ts';
import { TextDocument } from '../textDocument.ts';
import { LanguageId } from '../types.ts';

function getLanguageDetection(ctx: Context) {
  return new CachingLanguageDetection(
    new UntitledLanguageDetection(new GroupingLanguageDetection(new FilenameAndExensionLanguageDetection())),
    new NotebookLanguageDetection(ctx)
  );
}

function isNotebook(filename: string) {
  return filename.endsWith('.ipynb');
}

class Language {
  constructor(
    public languageId: LanguageId,
    public isGuess: boolean,
    public fileExtension: string
  ) {}
}

abstract class LanguageDetection {
  abstract detectLanguage(doc: TextDocument): Language;
}

class CachingLanguageDetection extends LanguageDetection {
  private delegate: LanguageDetection;
  private notebookDelegate: NotebookLanguageDetection;
  private cache = new LRUCacheMap<string, Language>(100);

  constructor(delegate: LanguageDetection, notebookDelegate: NotebookLanguageDetection) {
    super();
    this.delegate = delegate;
    this.notebookDelegate = notebookDelegate;
  }

  detectLanguage(doc: TextDocument): Language {
    const filename = path.basename(doc.vscodeUri.path);
    return isNotebook(filename)
      ? this.notebookDelegate.detectLanguage(doc)
      : this.detectLanguageForRegularFile(filename, doc);
  }

  private detectLanguageForRegularFile(filename: string, doc: TextDocument): Language {
    let language = this.cache.get(filename);
    if (!language) {
      const isNotebookValue = isNotebook(filename);
      language = isNotebookValue ? this.notebookDelegate.detectLanguage(doc) : this.delegate.detectLanguage(doc);
      if (language.isGuess || !isNotebookValue) {
        this.cache.set(filename, language);
      }
    }
    return language;
  }
}

class NotebookLanguageDetection extends LanguageDetection {
  private ctx: Context;

  constructor(ctx: Context) {
    super();
    this.ctx = ctx;
  }

  detectLanguage(doc: TextDocument): Language {
    const notebook = this.ctx.get(TextDocumentManager).findNotebook(doc);
    return notebook ? this.detectCellLanguage(doc, notebook) : new Language('python', false, '.ipynb');
  }

  private detectCellLanguage(doc: TextDocument, notebook: INotebook): Language {
    const activeCell = notebook.getCellFor(doc);
    return activeCell
      ? new Language(activeCell.document.languageId, false, '.ipynb')
      : new Language('unknown', false, '.ipynb');
  }
}

class FilenameAndExensionLanguageDetection extends LanguageDetection {
  detectLanguage(doc: any): Language {
    const filename = path.basename(doc.vscodeUri.path);
    const extension = path.extname(filename).toLowerCase();
    const extensionWithoutTemplate = this.extensionWithoutTemplateLanguage(filename, extension);
    const languageIdWithGuessing = this.detectLanguageId(filename, extensionWithoutTemplate);

    return new Language(
      languageIdWithGuessing.languageId,
      languageIdWithGuessing.isGuess,
      this.computeFullyQualifiedExtension(extension, extensionWithoutTemplate)
    );
  }

  private extensionWithoutTemplateLanguage(filename: string, extension: string): string {
    if (knownTemplateLanguageExtensions.includes(extension)) {
      const filenameWithoutExtension = filename.substring(0, filename.lastIndexOf('.'));
      const extensionWithoutTemplate = path.extname(filenameWithoutExtension).toLowerCase();
      if (
        extensionWithoutTemplate.length > 0 &&
        knownFileExtensions.includes(extensionWithoutTemplate) &&
        this.isExtensionValidForTemplateLanguage(extension, extensionWithoutTemplate)
      ) {
        return extensionWithoutTemplate;
      }
    }
    return extension;
  }

  private isExtensionValidForTemplateLanguage(extension: string, extensionWithoutTemplate: string): boolean {
    const limitations = templateLanguageLimitations[extension];
    return !limitations || limitations.includes(extensionWithoutTemplate);
  }

  private detectLanguageId(filename: string, extension: string): { languageId: string; isGuess: boolean } {
    let candidatesByExtension: string[] = [];
    let candidatesByFilename: string[] = [];

    for (const language in knownLanguages) {
      const info = knownLanguages[language];
      if (info.filenames && info.filenames.includes(filename)) {
        return { languageId: language, isGuess: false };
      } else if (info.filenames?.some((candidate) => filename.startsWith(`${candidate}.`))) {
        candidatesByFilename.push(language);
      }
      if (info.extensions.includes(extension)) {
        candidatesByExtension.push(language);
      }
    }

    return (
      this.determineLanguageIdByCandidates(candidatesByExtension) ??
      this.determineLanguageIdByCandidates(candidatesByFilename) ?? { languageId: 'unknown', isGuess: true }
    );
  }

  private determineLanguageIdByCandidates(candidates: string[]): { languageId: string; isGuess: boolean } | undefined {
    if (candidates.length === 1) return { languageId: candidates[0], isGuess: false };
    if (candidates.length > 1) return { languageId: candidates[0], isGuess: true };
  }

  private computeFullyQualifiedExtension(extension: string, extensionWithoutTemplate: string): string {
    return extension !== extensionWithoutTemplate ? `${extensionWithoutTemplate}${extension}` : extension;
  }
}

class GroupingLanguageDetection extends LanguageDetection {
  private delegate: LanguageDetection;

  constructor(delegate: LanguageDetection) {
    super();
    this.delegate = delegate;
  }

  detectLanguage(doc: TextDocument): Language {
    const language = this.delegate.detectLanguage(doc);
    if (language.languageId === 'c' || language.languageId === 'cpp') {
      return new Language('cpp', language.isGuess, language.fileExtension);
    }
    return language;
  }
}

class UntitledLanguageDetection extends LanguageDetection {
  private delegate: LanguageDetection;

  constructor(delegate: LanguageDetection) {
    super();
    this.delegate = delegate;
  }

  detectLanguage(doc: any): Language {
    return doc.vscodeUri.scheme === 'untitled'
      ? new Language(doc.languageId, true, '')
      : this.delegate.detectLanguage(doc);
  }
}

export {
  getLanguageDetection,
  Language,
  LanguageDetection,
  CachingLanguageDetection,
  NotebookLanguageDetection,
  FilenameAndExensionLanguageDetection,
  GroupingLanguageDetection,
  UntitledLanguageDetection,
};
