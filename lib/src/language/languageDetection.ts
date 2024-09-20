import path from 'path';

import { knownLanguages } from './generatedLanguages.ts';
import { Context } from '../context.ts';
import { knownTemplateLanguageExtensions, knownFileExtensions, templateLanguageLimitations } from './languages.ts';
// import { LRUCacheMap } from '../common/cache.ts';
import { TextDocument } from '../textDocument.ts';
import { LanguageId } from '../types.ts';
// import { TextDocumentManager, INotebook } from '../textDocumentManager.ts';
import { INotebook } from '../textDocumentManager.ts';
import { basename } from '../util/uri.ts';
import { DocumentUri } from 'vscode-languageserver-types';

function detectLanguage({
  uri,
  clientLanguageId,
}: {
  uri: DocumentUri;
  // optionsl ../textDocument.ts
  clientLanguageId?: LanguageId;
}) {
  let language = languageDetection.detectLanguage({ uri, languageId: 'UNKNOWN' });
  return language.languageId === 'UNKNOWN' ? clientLanguageId : language.languageId;
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
  abstract detectLanguage(doc: Pick<TextDocument, 'uri' | 'languageId'>): Language;
}

const knownExtensions = new Map();
const knownFilenames = new Map();

class FilenameAndExensionLanguageDetection extends LanguageDetection {
  detectLanguage(doc: Pick<TextDocument, 'uri' | 'languageId'>): Language {
    const filename = basename(doc.uri);
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
    if (knownFilenames.has(filename)) return { languageId: knownFilenames.get(filename)[0], isGuess: false };
    let extensionCandidates = knownExtensions.get(extension) ?? [];
    if (extensionCandidates.length > 0)
      return { languageId: extensionCandidates[0], isGuess: extensionCandidates.length > 1 };
    while (filename.includes('.')) {
      filename = filename.replace(/\.[^.]*$/, '');
      if (knownFilenames.has(filename)) return { languageId: knownFilenames.get(filename)[0], isGuess: false };
    }
    return { languageId: 'unknown', isGuess: true };
  }

  private computeFullyQualifiedExtension(extension: string, extensionWithoutTemplate: string): string {
    return extension !== extensionWithoutTemplate ? `${extensionWithoutTemplate}${extension}` : extension;
  }
}

class GroupingLanguageDetection extends LanguageDetection {
  constructor(readonly delegate: LanguageDetection) {
    super();
  }

  detectLanguage(doc: Pick<TextDocument, 'uri' | 'languageId'>): Language {
    const language = this.delegate.detectLanguage(doc);
    if (language.languageId === 'c' || language.languageId === 'cpp') {
      return new Language('cpp', language.isGuess, language.fileExtension);
    }
    return language;
  }
}

class ClientProvidedLanguageDetection extends LanguageDetection {
  private delegate: LanguageDetection;

  constructor(delegate: LanguageDetection) {
    super();
    this.delegate = delegate;
  }

  detectLanguage(doc: Pick<TextDocument, 'uri' | 'languageId'>): Language {
    return doc.uri.startsWith('untitled:') || doc.uri.startsWith('vscode-notebook-cell:')
      ? new Language(doc.languageId, true, '')
      : this.delegate.detectLanguage(doc);
  }
}

const languageDetection = new GroupingLanguageDetection(
  new ClientProvidedLanguageDetection(new FilenameAndExensionLanguageDetection())
);

export { detectLanguage };
