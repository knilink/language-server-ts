import { Type, type Static } from '@sinclair/typebox';
import { Position, Range } from 'vscode-languageserver-types';
import { Context } from '../../../../lib/src/context.ts';
import { parseChallengeDoc } from '../../testing/challengeDoc.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { CancellationToken } from '../../cancellation.ts';

const Params = Type.Object({
  documents: Type.Array(Type.String()),
  options: Type.Optional(Type.Object({})),
});

async function handleTestingSetCompletionDocumentsChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[string, null]> {
  return ctx.forceSet(CompletionDocuments, new CompletionDocuments(params.documents)), ['OK', null];
}

function getTestCompletions(
  ctx: Context,
  position: Position,
  isCycling: boolean
): { insertText: string; range: Range }[] | undefined {
  let testingDocs: CompletionDocuments | undefined;
  try {
    testingDocs = ctx.get(CompletionDocuments);
  } catch { }
  if (testingDocs) {
    const numCompletions = isCycling ? 3 : 1;
    return testingDocs.documents.slice(0, numCompletions).map((challengeDoc) => {
      const { cursorLine, lines, start, end } = parseChallengeDoc(challengeDoc, position);
      return {
        insertText: [cursorLine.slice(Math.min(start.character, position.character))]
          .concat(lines.slice(position.line + 1))
          .join(`\n`),
        range: { start, end },
      };
    });
  }
}

class CompletionDocuments {
  documents: string[];
  constructor(documents: string[]) {
    this.documents = documents;
  }
}

const handleTestingSetCompletionDocuments = addMethodHandlerValidation(
  Params,
  handleTestingSetCompletionDocumentsChecked
);

export { getTestCompletions, handleTestingSetCompletionDocuments };
