import type { CopilotTextDocument } from '../textDocument.ts';
import type { LanguageId } from '../types.ts';
import type { DocumentUri } from 'vscode-languageserver-types';

import * as path from 'node:path';
import { knownLanguages } from './generatedLanguages.ts';
import { knownFileExtensions, knownTemplateLanguageExtensions, templateLanguageLimitations } from './languages.ts';
import { basename } from '../util/uri.ts';

function detectLanguage({ uri, clientLanguageId }: { uri: DocumentUri; clientLanguageId: LanguageId }): LanguageId {
  const language = languageDetection.detectLanguage({ uri, languageId: 'UNKNOWN' });
  return language.languageId?.toUpperCase() === 'UNKNOWN' ? clientLanguageId : language.languageId;
}

class Language {
  constructor(
    public languageId: LanguageId,
    public isGuess: boolean,
    public fileExtension: string
  ) {}
}

abstract class LanguageDetection {
  abstract detectLanguage(doc: Pick<CopilotTextDocument, 'uri' | 'languageId'>): Language;
}

const knownExtensions = new Map<string, LanguageId[]>(
  Object.entries(knownLanguages).flatMap(([languageId, { extensions }]) => extensions.map((ext) => [ext, [languageId]]))
);
const knownFilenames = new Map<string, DocumentUri[]>(
  Object.entries(knownLanguages).flatMap(
    ([languageId, { extensions }]) => extensions?.map((ext) => [ext, [languageId]]) ?? []
  )
);

class FilenameAndExensionLanguageDetection extends LanguageDetection {
  detectLanguage(doc: Pick<CopilotTextDocument, 'uri' | 'languageId'>): Language {
    const filename = basename(doc.uri);
    const extension = path.extname(filename).toLowerCase();
    const extensionWithoutTemplate = this.extensionWithoutTemplateLanguage(filename, extension);
    const languageIdWithGuessing = this.detectLanguageId(filename, extensionWithoutTemplate);
    console.log({ languageIdWithGuessing });

    return new Language(
      languageIdWithGuessing.languageId,
      languageIdWithGuessing.isGuess,
      this.computeFullyQualifiedExtension(extension, extensionWithoutTemplate)
    );
  }

  extensionWithoutTemplateLanguage(filename: string, extension: string): string {
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

  isExtensionValidForTemplateLanguage(extension: string, extensionWithoutTemplate: string): boolean {
    const limitations = templateLanguageLimitations[extension];
    return !limitations || limitations.includes(extensionWithoutTemplate);
  }

  detectLanguageId(filename: string, extension: string): { languageId: string; isGuess: boolean } {
    if (knownFilenames.has(filename)) return { languageId: knownFilenames.get(filename)![0], isGuess: false };
    let extensionCandidates = knownExtensions.get(extension) ?? [];
    if (extensionCandidates.length > 0)
      return { languageId: extensionCandidates[0], isGuess: extensionCandidates.length > 1 };
    while (filename.includes('.')) {
      filename = filename.replace(/\.[^.]*$/, '');
      if (knownFilenames.has(filename)) return { languageId: knownFilenames.get(filename)![0], isGuess: false };
    }
    return { languageId: 'unknown', isGuess: true };
  }

  computeFullyQualifiedExtension(extension: string, extensionWithoutTemplate: string): string {
    return extension !== extensionWithoutTemplate ? `${extensionWithoutTemplate}${extension}` : extension;
  }
}

class GroupingLanguageDetection extends LanguageDetection {
  constructor(readonly delegate: LanguageDetection) {
    super();
  }

  detectLanguage(doc: Pick<CopilotTextDocument, 'uri' | 'languageId'>): Language {
    const language = this.delegate.detectLanguage(doc);
    if (language.languageId === 'c' || language.languageId === 'cpp') {
      return new Language('cpp', language.isGuess, language.fileExtension);
    }
    return language;
  }
}

class ClientProvidedLanguageDetection extends LanguageDetection {
  constructor(readonly delegate: LanguageDetection) {
    super();
  }

  detectLanguage(doc: Pick<CopilotTextDocument, 'uri' | 'languageId'>): Language {
    return doc.uri.startsWith('untitled:') || doc.uri.startsWith('vscode-notebook-cell:')
      ? new Language(doc.languageId, true, '')
      : this.delegate.detectLanguage(doc);
  }
}

const languageDetection = new GroupingLanguageDetection(
  new ClientProvidedLanguageDetection(new FilenameAndExensionLanguageDetection())
);

export { detectLanguage };
