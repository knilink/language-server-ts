import type { CodeBlock } from '../../types.ts';
import type { Context } from '../../context.ts';
import type { EditTurnContext } from '../resources/editTurnContext.ts';
import type { CancellationToken } from 'vscode-languageserver/node.js';

import { URI } from 'vscode-uri';
import { SpeculationFetcher } from './fetchSpeculation.ts';
import { CopilotEditsProcessCodeBlockException } from '../exceptions/processCodeBlockException.ts';
import { EditProgressReporter } from '../progress/editProgressReporter.ts';
import { CodeMapperPrompt } from '../prompts/codeMapper/codeMapperPrompt.ts';
import { EXISTING_CODE_MARKER, RESULT_XML_TAG } from '../prompts/constants.ts';
import { DefaultTextDocumentProvider } from '../prompts/textDocumentProvider.ts';
import { FileReader } from '../../fileReader.ts';
import { Logger } from '../../logger.ts';
import { getFenceForCodeBlock } from '../../util/codeFenceUtils.ts';
import { basename } from '../../util/uri.ts';
import type {} from '../../../../types/src/index.ts';

class CodeMapper {
  readonly reporter: EditProgressReporter;
  readonly logger = new Logger('CopilotEditsCodeMapper');

  constructor(readonly ctx: Context) {
    this.reporter = ctx.get(EditProgressReporter);
  }

  async mapCode(codeBlock: CodeBlock, turnCtx: EditTurnContext, token: CancellationToken) {
    if (!codeBlock.resource) {
      throw new CopilotEditsProcessCodeBlockException('No uri found in code block');
    }
    if (!codeBlock.code.includes(EXISTING_CODE_MARKER)) {
      await this.reporter.reportTurn(turnCtx, {
        fileGenerationStatus: 'edit-plan-generated',
        uri: codeBlock.resource.toString(),
        filename: basename(codeBlock.resource),
        editDescription: codeBlock.markdownBeforeBlock,
      });
      await this.reporter.reportTurn(turnCtx, {
        fileGenerationStatus: 'updated-code-generated',
        partialText: codeBlock.code,
        uri: codeBlock.resource.toString(),
        filename: basename(codeBlock.resource),
      });
      return;
    }
    const originalDocumentResult = await this.ctx.get(FileReader).readFile(codeBlock.resource.toString());
    if (originalDocumentResult.status !== 'valid') {
      const errorMessage = `Failed to find file ${codeBlock.resource.toString()} with status ${originalDocumentResult.status}`;
      const ex = new CopilotEditsProcessCodeBlockException(errorMessage);
      this.logger.error(this.ctx, errorMessage, ex);
      throw ex;
    }
    const codeMapperPrompt = new CodeMapperPrompt({
      documentContext: { document: originalDocumentResult },
      codeBlock: codeBlock.code,
      uri: URI.parse(codeBlock.resource.toString()),
      markdownBeforeBlock: codeBlock.markdownBeforeBlock,
      textDocumentProvider: new DefaultTextDocumentProvider(this.ctx),
    });
    const mapCodePromptMessages = await codeMapperPrompt.render();
    const languageId = originalDocumentResult.document.clientLanguageId || '';
    const speculationPrompt = codeMapperPrompt.transformToSpeculationPrompt(mapCodePromptMessages, languageId);
    await this.reporter.reportTurn(turnCtx, {
      fileGenerationStatus: 'edit-plan-generated',
      uri: codeBlock.resource.toString(),
      filename: basename(codeBlock.resource),
      editDescription: codeBlock.markdownBeforeBlock,
    });
    try {
      const res = await this.ctx.get(SpeculationFetcher).fetchSpeculation(
        {
          prompt: speculationPrompt,
          speculation: originalDocumentResult.document.getText(),
          languageId,
          stops: [`\`\`\`\n</${RESULT_XML_TAG}>`, `\`\`\`\r\n</${RESULT_XML_TAG}>`, `</${RESULT_XML_TAG}>`],
        },
        token
      );

      const completionText = [];
      for await (const choice of res.choices) completionText.push(choice.completionText);
      const completion = completionText.find((c) => c.length > 0);
      if (completion) {
        await this.reporter.reportTurn(turnCtx, {
          fileGenerationStatus: 'updated-code-generated',
          uri: codeBlock.resource.toString(),
          filename: basename(codeBlock.resource),
          partialText: completion,
          languageId,
          markdownCodeFence: getFenceForCodeBlock(completion),
        });
        return;
      } else {
        const errorMessage = `No valid completion found for uri ${codeBlock.resource.toString()}`;
        throw new CopilotEditsProcessCodeBlockException(errorMessage);
      }
    } catch (error) {
      const errorMessage = `Failed to process code block: '${error instanceof Error ? error.message : 'unknown error'}'`;
      throw new CopilotEditsProcessCodeBlockException(errorMessage);
    }
  }
}

export { CodeMapper };
