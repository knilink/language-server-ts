import type { Chat, LanguageId } from '../../../types.ts';
import type { URI } from 'vscode-uri';
import { EXISTING_CODE_MARKER, FILEPATH_CODE_BLOCK_MARKER, RESULT_XML_TAG } from '../constants.ts';
import {} from '../../../conversation/openai/openai.ts';
import { DocumentValidationResult } from '../../../util/documentEvaluation.ts';
import { TextDocumentProvider } from '../textDocumentProvider.ts';

class CodeBlockChangeDescription {
  constructor(readonly props: { markdownBeforeBlock: string }) {}
  render() {
    if (this.props.markdownBeforeBlock) {
      return [
        'This is the description of what the code block changes:',
        '<changeDescription>',
        this.props.markdownBeforeBlock,
        '',
        '</changeDescription>',
        '',
      ].join('\n');
    }
  }
}

class CodeMapperPrompt {
  constructor(
    readonly props: {
      documentContext: { document: DocumentValidationResult };
      uri: URI;
      codeBlock: string;
      markdownBeforeBlock: string;
      textDocumentProvider: TextDocumentProvider;
    }
  ) {}
  async render(): Promise<Chat.ChatMessage[]> {
    const textDocument = await this.props.textDocumentProvider.getByUri(this.props.uri.toString());
    return [
      { role: 'system', content: this.buildSystemMessage(textDocument) },
      { role: 'user', content: await this.buildUserMessage(textDocument) },
    ];
  }
  transformToSpeculationPrompt(messages: Chat.ChatMessage[], languageId: LanguageId) {
    return (
      messages.reduce((prev, curr) => {
        if (curr.role === 'system') {
          const currentContent = curr.content.endsWith(`\n`) ? curr.content : `${curr.content}\n`;
          return `${prev}<SYSTEM>
${currentContent}
End your response with </${RESULT_XML_TAG}>.
</SYSTEM>


`;
        }
        return prev + curr.content;
      }, '') +
      `


The resulting document:
<${RESULT_XML_TAG}>
\`\`\`${languageId}
`
    );
  }
  buildSystemMessage(textDocument: DocumentValidationResult) {
    if (textDocument.status !== 'valid') {
      return '';
    }
    let parts = [];
    parts.push(
      'You are an AI programming assistant that is specialized in applying code changes to an existing document.',
      'Follow Microsoft content policies.',
      'Avoid content that violates copyrights.',
      `If you are asked to generate content that is harmful, hateful, racist, sexist, lewd, violent, or completely irrelevant to software engineering, only respond with "Sorry, I can't assist with that."`,
      'Keep your answers short and impersonal.',
      `The user has a code block that represents a suggestion for a code change and a ${textDocument.document.clientLanguageId} file opened in a code editor.`,
      'Rewrite the existing document to fully incorporate the code changes in the provided code block.',
      'For the response, always follow these instructions:',
      '1. Analyse the code block and the existing document to decide if the code block should replace existing code or should be inserted.',
      '2. If necessary, break up the code block into multiple parts and insert each part at the appropriate location.',
      '3. Preserve whitespace and newlines right after the parts of the file that you modify.',
      `4. The final result must be syntactically valid, properly formatted, and correctly indented. It should not contain any \`${EXISTING_CODE_MARKER}\` comments.`,
      '5. Finally, provide the fully rewritten file. You must output the complete file.'
    );
    return parts.join('\n');
  }
  async buildUserMessage(textDocument: DocumentValidationResult) {
    let parts = [];
    if (textDocument.status !== 'valid') {
      return '';
    }

    if (textDocument.document.getText().length > 0) {
      parts.push(
        `I have the following code open in the editor, starting from line 1 to line ${textDocument.document.lineCount}.`,
        `\`\`\`${textDocument.document.clientLanguageId}`,
        `// ${FILEPATH_CODE_BLOCK_MARKER} ${this.props.uri.toString()}`,
        textDocument.document.getText(),
        '```'
      );
    } else {
      parts.push('I am in an empty editor.');
    }

    let description = new CodeBlockChangeDescription({ markdownBeforeBlock: this.props.markdownBeforeBlock }).render();

    if (description) {
      parts.push(description);
    }

    parts.push(
      'This is the code block that represents the suggested code change:',
      `\`\`\`${textDocument.document.clientLanguageId}`,
      this.props.codeBlock,
      '```',
      '<userPrompt>',
      'Provide the fully rewritten file, incorporating the suggested code change. You must produce the complete file.',
      '</userPrompt>'
    );
    return parts.join('\n');
  }
}

export { CodeMapperPrompt };
