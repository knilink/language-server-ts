import type { Context } from '../../context.ts';
import type { CopilotFunctionComponent } from '../jsxTypes.ts';
import type { CopilotTextDocument } from '../../textDocument.ts';
import type { TelemetryWithExp } from '../../telemetry.ts';
import type { CompletionRequestData } from './completionsPrompt.tsx';
import type { PromptOptions } from '../../../../prompt/src/prompt.ts';

import { isCompletionRequestData } from './completionsPrompt.tsx';
import { getPromptOptions } from '../prompt.ts';
import { NeighborSource } from '../similarFiles/neighborFiles.ts';
import { getSimilarFilesOptions } from '../../experiments/similarFileOptionsProvider.ts';
import { TextDocumentManager } from '../../textDocumentManager.ts';
// import { fragmentFunction, functionComponentFunction } from '../../../../prompt/jsx-runtime/jsx-runtime.ts';
import { Text } from '../../../../prompt/src/components/components.ts';
import { getSimilarSnippets } from '../../../../prompt/src/snippetInclusion/similarFiles.ts';
import { announceSnippet } from '../../../../prompt/src/snippetInclusion/snippets.ts';

const SimilarFiles: CopilotFunctionComponent<{ ctx: Context }> = (props, context) => {
  const [document, setDocument] = context.useState<CopilotTextDocument>();
  const [similarFiles, setSimilarFiles] = context.useState<{ text: string }[]>([]);
  context.useData(isCompletionRequestData, async (requestData) => {
    if (requestData.document.uri !== document?.uri) {
      setSimilarFiles([]);
    }

    setDocument(requestData.document);
    const files = requestData.turnOffSimilarFiles
      ? NeighborSource.defaultEmptyResult()
      : await NeighborSource.getNeighborFilesAndTraits(
          props.ctx,
          requestData.document.uri,
          requestData.document.detectedLanguageId,
          requestData.telemetryData,
          requestData.cancellationToken,
          requestData.data
        );
    const similarFiles = await produceSimilarFiles(requestData.telemetryData, requestData.document, requestData, files);
    setSimilarFiles(similarFiles);
  });

  async function produceSimilarFiles(
    telemetryData: TelemetryWithExp,
    doc: CopilotTextDocument,
    requestData: CompletionRequestData,
    files: NeighborSource.Result
  ) {
    const promptOptions: Partial<PromptOptions> = getPromptOptions(props.ctx, telemetryData, doc.detectedLanguageId);
    return (await findSimilarSnippets(promptOptions, telemetryData, doc, requestData, files))
      .filter((s) => s.snippet.length > 0)
      .sort((a, b) => a.score - b.score)
      .map((s) => ({ text: announceSnippet(s, doc.detectedLanguageId), score: s.score }));
  }

  async function findSimilarSnippets(
    promptOptions: Partial<PromptOptions>,
    telemetryData: TelemetryWithExp,
    doc: CopilotTextDocument,
    requestData: CompletionRequestData,
    files: NeighborSource.Result
  ) {
    const similarFilesOptions =
      promptOptions.similarFilesOptions || getSimilarFilesOptions(props.ctx, telemetryData, doc.detectedLanguageId);
    const relativePath = props.ctx.get(TextDocumentManager).getRelativePath(doc);
    const docInfo = {
      uri: doc.uri,
      source: doc.getText(),
      offset: doc.offsetAt(requestData.position),
      relativePath,
      languageId: doc.detectedLanguageId,
    };
    return await getSimilarSnippets(docInfo, Array.from(files.docs.values()), similarFilesOptions);
  }

  return (
    <>
      {similarFiles.map((file, index) => (
        <SimilarFile key={index} text={file.text} />
      ))}
    </>
  );
};

const SimilarFile: CopilotFunctionComponent<{ text: string }> = (props, context) => <Text>{props.text}</Text>;

export { SimilarFiles };
