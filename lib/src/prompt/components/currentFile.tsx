import type { Position } from 'vscode-languageserver-types';
import type { IPromptElementLifecycle } from '../jsxTypes.ts';
import type { CopilotTextDocument } from '../../textDocument.ts';

import { isCompletionRequestData } from './completionsPrompt.tsx';
// import { fragmentFunction, functionComponentFunction } from '../../../../prompt/jsx-runtime/jsx-runtime.ts';
import { Text } from '../../../../prompt/src/components/components.ts';
import { DEFAULT_SUFFIX_MATCH_THRESHOLD } from '../../../../prompt/src/prompt.ts';
import { findEditDistanceScore } from '../../../../prompt/src/suffixMatchCriteria.ts';
import { getTokenizer } from '../../../../prompt/src/tokenization/tokenizer.ts';
import { MAX_EDIT_DISTANCE_LENGTH } from '../../../../prompt/src/wishlist.ts';
import type {} from '../../../../prompt/src/tokenization/index.ts';
import { TextDocument } from 'vscode-languageserver-textdocument';

function CurrentFile(_props: {}, context: IPromptElementLifecycle) {
  let [document, setDocument] = context.useState<CopilotTextDocument>();
  let [position, setPosition] = context.useState<Position>();

  context.useData(isCompletionRequestData, (request) => {
    let requestDocument = request.document;

    if (request.document.uri !== document?.uri || requestDocument.getText() !== document?.getText()) {
      setDocument(requestDocument);
    }

    if (request.position !== position) {
      setPosition(request.position);
    }
  });

  return (
    <>
      <BeforeCursor document={document} position={position} />
      <AfterCursor document={document} position={position} />
    </>
  );
}

function BeforeCursor(props: { document: TextDocument; position: Position }) {
  return props.document === undefined || props.position === undefined ? (
    <Text />
  ) : (
    <Text>{props.document.getText({ start: { line: 0, character: 0 }, end: props.position })}</Text>
  );
}

function AfterCursor(props: { document: TextDocument; position: Position }, context: IPromptElementLifecycle) {
  const [cachedSuffix, setCachedSuffix] = context.useState('');
  if (props.document === undefined || props.position === undefined) {
    return <Text />;
  }

  const trimmedSuffix = props.document
    .getText({ start: props.position, end: { line: Number.MAX_VALUE, character: Number.MAX_VALUE } })
    .replace(/^.*/, '')
    .trimStart();

  if (trimmedSuffix === '') {
    return <Text />;
  }

  if (cachedSuffix === trimmedSuffix) {
    return <Text>{cachedSuffix}</Text>;
  }

  let suffixToUse = trimmedSuffix;
  if (cachedSuffix !== '') {
    const tokenizer = getTokenizer();
    const firstSuffixTokens = tokenizer.takeFirstTokens(trimmedSuffix, MAX_EDIT_DISTANCE_LENGTH);

    if (
      firstSuffixTokens.tokens.length > 0 &&
      100 *
        findEditDistanceScore(
          firstSuffixTokens.tokens,
          tokenizer.takeFirstTokens(cachedSuffix, MAX_EDIT_DISTANCE_LENGTH).tokens
        )?.score <
        DEFAULT_SUFFIX_MATCH_THRESHOLD * firstSuffixTokens.tokens.length
    ) {
      suffixToUse = cachedSuffix;
    }
  }

  if (suffixToUse !== cachedSuffix) {
    setCachedSuffix(suffixToUse);
  }

  return <Text>{suffixToUse}</Text>;
}

export { AfterCursor, BeforeCursor, CurrentFile };
