import type { DocumentUri } from 'vscode-languageserver-types';
import type { Chat } from '../../../types.ts';
import type { TextDocumentProvider } from '../textDocumentProvider.ts';
import type { CopilotTextDocument } from '../../../textDocument.ts';

import { EXISTING_CODE_MARKER, FILEPATH_CODE_BLOCK_MARKER } from '../constants.ts';
import { CopilotEditsPromptUriUtils } from '../promptUriUtils.ts';
import type {} from '../../../conversation/openai/openai.ts';

interface FileReference {
  uri: string;
}

type WorkingSet = Map<DocumentUri, CopilotTextDocument>;

class EditCodePrompt {
  exampleFilePath = this.getExampleFilePath('/path/to/file');
  tsExampleFilePath = this.getExampleFilePath('/Users/someone/proj01/example.ts');
  constructor(
    readonly props: {
      workingSet?: null | FileReference[];
      textDocumentProvider: TextDocumentProvider;
      userMessage: string;
      workspaceFolder: DocumentUri;
      userLanguage: string;
    }
  ) {}
  async render(): Promise<Chat.ChatMessage[]> {
    const workingSetTextDocuments = await this.getValidFilesInWorkingSet();
    return [
      { role: 'system', content: this.buildSystemMessage(workingSetTextDocuments) },
      { role: 'user', content: this.buildUserMessage(workingSetTextDocuments) },
    ];
  }
  getExampleFilePath(absolutePosixFilePath: string) {
    return this.getFilePath(CopilotEditsPromptUriUtils.posixFilePathToUri(absolutePosixFilePath));
  }
  getFilePath(uri: DocumentUri) {
    return CopilotEditsPromptUriUtils.uriToPath(uri);
  }
  async getValidFilesInWorkingSet() {
    const validFiles: WorkingSet = new Map();
    if (this.props.workingSet === undefined || this.props.workingSet === null || this.props.workingSet.length === 0) {
      return validFiles;
    }
    for (const fileReference of this.props.workingSet) {
      const textDocument = await this.props.textDocumentProvider.getByUri(fileReference.uri);

      if (textDocument.status === 'valid') {
        validFiles.set(fileReference.uri, textDocument.document);
      }
    }
    return validFiles;
  }
  buildSystemMessage(workingSetTextDocuments: WorkingSet) {
    let parts = [];

    parts.push(
      'You are an AI programming assistant.',
      'When asked for your name, you must respond with "GitHub Copilot".',
      "Follow the user's requirements carefully & to the letter.",
      'Follow Microsoft content policies.',
      'Avoid content that violates copyrights.',
      `If you are asked to generate content that is harmful, hateful, racist, sexist, lewd, violent, or completely irrelevant to software engineering, only respond with "Sorry, I can't assist with that."`,
      'Keep your answers short and impersonal.',
      workingSetTextDocuments.size > 0
        ? 'The user has a request for modifying one or more files.'
        : [
            'If the user asks a question, then answer it.',
            `If you need to change existing files and it's not clear which files should be changed, then refuse and answer with "Please add the files to be modified to the working set"`,
          ].join('\n'),
      '1. Please come up with a solution that you first describe step-by-step.',
      '2. Group your changes by file. Use the file path as the header.',
      '3. For each file, give a short summary of what needs to be changed followed by a code block that contains the code changes.',
      "4. Each file's code block must start with a comment containing the filepath.",
      '5. Use a single code block per file that needs to be modified, even if there are multiple changes for a file.',
      '6. The user is very smart and can understand how to merge your code blocks into their files, you just need to provide minimal hints.',
      '7. Avoid repeating existing code, instead use comments to represent regions of unchanged code. The user prefers that you are as concise as possible. For example: ',
      [
        '<file>',
        '````languageId',
        `// ${FILEPATH_CODE_BLOCK_MARKER} ${this.exampleFilePath}`,
        `// ${EXISTING_CODE_MARKER}`,
        '{ changed code }',
        `// ${EXISTING_CODE_MARKER}`,
        '{ changed code }',
        `// ${EXISTING_CODE_MARKER}`,
        '````',
        '</file>',
      ].join('\n'),
      '8. If you generate edits for a Markdown file, use four backticks for the outer code block.',
      ''
    );

    if (this.props.userLanguage) {
      parts.push(`Respond in the following locale: ${this.props.userLanguage}`);
    }

    parts.push(
      'Here is an example of how you should format a code block belonging to the file example.ts in your response:',
      '<example>',
      [
        `### ${this.tsExampleFilePath}`,
        '',
        "Add a new property 'age' and a new method 'getAge' to the class Person.",
        '',
        '<file>',
        '```typescript',
        `// ${FILEPATH_CODE_BLOCK_MARKER} ${this.tsExampleFilePath}`,
        'class Person {',
        `   // ${EXISTING_CODE_MARKER}`,
        '   age: number;',
        `   // ${EXISTING_CODE_MARKER}`,
        '   getAge() {',
        '      return this.age;',
        '   }',
        '}',
        '```',
        '</file>',
      ].join('\n'),
      '</example>'
    );

    return parts.join('\n');
  }
  getFenceForCodeBlock(code: string) {
    let backticks = code.matchAll(/^\s*(```+)/gm);
    let backticksNeeded = Math.max(3, ...Array.from(backticks, (d) => d[1].length + 1));
    return '`'.repeat(backticksNeeded);
  }
  buildUserMessage(workingSetTextDocuments: WorkingSet) {
    let parts = [];
    if (workingSetTextDocuments.size > 0) {
      parts.push(
        'The user has provided the following files as input. Always make changes to these files unless the user asks to create a new file.',
        'Untitled files are files that are not yet named. Make changes to them like regular files.'
      );
      for (let [uri, textDocument] of workingSetTextDocuments) {
        let documentPath = this.getFilePath(uri);
        let codeFullText = textDocument.getText();
        let codeFence = this.getFenceForCodeBlock(codeFullText);
        parts.push(
          '<file>',
          `${codeFence}${textDocument.clientLanguageId}`,
          `// ${FILEPATH_CODE_BLOCK_MARKER} ${documentPath}`,
          `${codeFullText}`,
          `${codeFence}`,
          '</file>'
        );
      }
    }
    parts.push(
      '<reminder>',
      `Avoid repeating existing code, instead use a line comment with \`${EXISTING_CODE_MARKER}\` to represent regions of unchanged code.`,
      "Each file's code block must start with a line comment containing the filepath. This includes Markdown files.",
      'For existing files, make sure the filepath exactly matches the filepath of the original file.',
      `When suggesting to create new files, pick a location inside \`${this.getFilePath(this.props.workspaceFolder)}\``,
      '</reminder>'
    );
    parts.push('<prompt>', `${this.props.userMessage}`, '</prompt>');
    return parts.join('\n');
  }
}

export { EditCodePrompt };
