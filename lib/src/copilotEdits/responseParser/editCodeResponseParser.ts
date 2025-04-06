import type { CodeBlock } from '../../types.ts';

import { PartialAsyncTextReader } from './streamingEdits.ts';
import { getLanguage, mdCodeBlockLangToLanguageId } from '../../../../prompt/src/languageMarker.ts';

async function* getCodeBlocksFromResponse(
  textStream: AsyncGenerator<string>,
  createUriFromResponsePath: (header: string) => Promise<string>
): AsyncGenerator<CodeBlock> {
  const reader = new PartialAsyncTextReader(textStream[Symbol.asyncIterator]());
  const markdownBeforeBlock = [];
  while (!reader.endOfStream) {
    while (!reader.endOfStream) {
      const lineStart = await reader.peek(
        Math.max(fence.length, openingFileXmlTag.length, fileHeadingLineStart.length)
      );
      if (lineStart.startsWith(openingFileXmlTag) || lineStart.startsWith(fence)) {
        break;
      }
      if (lineStart.startsWith(fileHeadingLineStart)) {
        {
          const line = await reader.readLineIncludingLF();
          const header = line.substring(fileHeadingLineStart.length).trim();

          if (!(await createUriFromResponsePath(header))) {
            markdownBeforeBlock.push(line);
          }
        }
      } else {
        await pipeOneLine(reader, markdownBeforeBlock);
      }
    }
    if (reader.endOfStream) {
      break;
    }
    let line = await reader.readLineIncludingLF();
    const hasFileXMLTag = line.startsWith(openingFileXmlTag);
    while (!reader.endOfStream && !line.startsWith(fence)) {
      line = await reader.readLineIncludingLF();
    }
    if (reader.endOfStream) {
      break;
    }
    const fenceLanguageIdMatch = line.match(fenceLanguageRegex);
    const fenceMdLanguageId = fenceLanguageIdMatch ? fenceLanguageIdMatch[2] : undefined;
    const fenceLanguage = getLanguage(fenceMdLanguageId ? mdCodeBlockLangToLanguageId(fenceMdLanguageId) : undefined);
    const acceptedFilePathPrefixes = [
      `${fenceLanguage.lineComment.start} ${filepathCodeBlockMarker}`,
      `:: ${filepathCodeBlockMarker}`,
      `<!-- ${filepathCodeBlockMarker}`,
      `// ${filepathCodeBlockMarker}`,
      `# ${filepathCodeBlockMarker}`,
    ];
    const acceptedFilePathPrefixMaxLength = Math.max(...acceptedFilePathPrefixes.map((p) => p.length));
    const filePathSuffix = fenceLanguage.lineComment.end ?? '';
    const closingFileXmlTag = '</file>';
    let codeBlockUri;
    const codeBlockPieces = [];
    while (!reader.endOfStream) {
      const lineStart = await reader.peek(Math.max(fence.length, acceptedFilePathPrefixMaxLength));
      if (lineStart.startsWith(fence)) {
        const fenceOrContent = await reader.readLineIncludingLF();
        if (!hasFileXMLTag) {
          break;
        }
        if ((await reader.peek(closingFileXmlTag.length)) === closingFileXmlTag) {
          await reader.readLineIncludingLF();
          break;
        } else {
          codeBlockPieces.push(fenceOrContent);
          continue;
        }
      }
      if (!codeBlockUri && acceptedFilePathPrefixes.some((prefix) => lineStart.startsWith(prefix))) {
        const filePathLine = await reader.readLineIncludingLF();
        let filePath = acceptedFilePathPrefixes.reduce(
          (acc, prefix) => (lineStart.startsWith(prefix) ? filePathLine.substring(prefix.length) : acc),
          filePathLine
        );
        filePath = filePath.split('-->')[0].trim();

        if (filePath.endsWith(filePathSuffix)) {
          filePath = filePath.substring(0, filePath.length - filePathSuffix.length);
        }

        filePath = filePath.trim();
        codeBlockUri = await createUriFromResponsePath(filePath);
        continue;
      }
      await pipeOneLine(reader, codeBlockPieces);
    }
    yield {
      resource: codeBlockUri,
      language: fenceMdLanguageId,
      code: codeBlockPieces.join(''),
      markdownBeforeBlock: markdownBeforeBlock.join(''),
    };
    markdownBeforeBlock.length = 0;
  }
}

async function pipeOneLine(
  reader: PartialAsyncTextReader,
  pieces: string[] // mutate, f*
) {
  while (!reader.endOfStream) {
    const piece = reader.readImmediateExcept('\n');

    if (piece.length > 0) {
      pieces?.push(piece);
    }

    if ((await reader.peek(1)) === '\n') {
      reader.readImmediate(1);

      pieces?.push('\n');

      break;
    }
  }
}

const openingFileXmlTag = '<file>';
const fence = '```';
const fileHeadingLineStart = '###';
const fenceLanguageRegex = /^(`+)([^ \n]*)/;
const filepathCodeBlockMarker = 'filepath:';

export { getCodeBlocksFromResponse };
