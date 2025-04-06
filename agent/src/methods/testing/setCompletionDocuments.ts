import { Type, type Static } from '@sinclair/typebox';
import { Position, Range } from 'vscode-languageserver-types';
import type { CancellationToken } from 'vscode-languageserver';
import { basename } from '../../../../lib/src/util/uri.ts';
import { Context } from '../../../../lib/src/context.ts';
import { parseChallengeDoc } from '../../testing/challengeDoc.ts';
import { addMethodHandlerValidation } from '../../schemaValidation.ts';
import { Logger } from '../../../../lib/src/logger.ts';

async function handleTestingSetCompletionDocumentsChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  ctx.forceSet(
    ExternalTestingCompletionDocuments,
    new ExternalTestingCompletionDocuments(params.documents, params.basename || '')
  );
  return ['OK', null];
}

function getTestCompletions(
  ctx: Context,
  position: Position,
  docUri: string,
  isCycling: boolean
): { insertText: string; range: Range }[] | undefined {
  let testingDocs = ctx.get(ExternalTestingCompletionDocuments);
  if (testingDocs.documents) {
    let numCompletions = isCycling ? 3 : 1;
    if (docUri && testingDocs.basename && testingDocs.basename.trim().length > 0) {
      {
        logger.debug(ctx, `Returning filtered completions by basename ${testingDocs.basename}`);
        let filteredDocs = getFilteredDocs(testingDocs, docUri);
        return filteredDocs?.length > 0 ? sliceAndMapCompletions(filteredDocs, numCompletions, position) : undefined;
      }
    } else {
      logger.debug(ctx, 'Returning completions for all pre-set documents');
      return sliceAndMapCompletions(testingDocs.documents, numCompletions, position);
    }
  }
}

function sliceAndMapCompletions(completionContents: string[], numCompletions: number, position: Position) {
  return completionContents.slice(0, numCompletions).map((challengeDoc) => {
    let { cursorLine, lines, start, end } = parseChallengeDoc(challengeDoc, position);
    return {
      insertText: [cursorLine.slice(Math.min(start.character, position.character))]
        .concat(lines.slice(position.line + 1))
        .join('\n'),
      range: { start, end },
    };
  });
}

function getFilteredDocs(completionDocs: ExternalTestingCompletionDocuments, inputDocUri: string) {
  return completionDocs.basename === basename(inputDocUri) ? completionDocs.documents || [] : [];
}

const Params = Type.Object({
  documents: Type.Array(Type.String()),
  basename: Type.Optional(Type.String()),
  options: Type.Optional(Type.Object({})),
});

class ExternalTestingCompletionDocuments {
  constructor(
    readonly documents?: string[],
    readonly basename?: string
  ) {}
}

const logger = new Logger('setCompletionDocuments');

const handleTestingSetCompletionDocuments = addMethodHandlerValidation(
  Params,
  handleTestingSetCompletionDocumentsChecked
);

export { ExternalTestingCompletionDocuments, getTestCompletions, handleTestingSetCompletionDocuments };
