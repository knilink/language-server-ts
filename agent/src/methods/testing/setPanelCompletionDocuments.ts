import { Type, type Static } from '@sinclair/typebox';
import { Position } from 'vscode-languageserver-types';

import { type Context } from '../../../../lib/src/context';
import { type CancellationToken } from '../../cancellation';
import { SolutionHandler } from '../../../../lib/src/types';

import { v4 as uuidv4 } from 'uuid';
import { parseChallengeDoc } from '../../testing/challengeDoc';
import { TelemetryWithExp } from '../../../../lib/src/telemetry';
import { addMethodHandlerValidation } from '../../schemaValidation';

function runTestSolutions(
  position: Position,
  docs: { text: string; score: number }[],
  solutionHandler: SolutionHandler.ISolutionHandler
): void {
  let headerRequestId = uuidv4();
  for (let solutionIndex = 0; solutionIndex < docs.length && solutionIndex < 10; solutionIndex++) {
    const { text, score } = docs[solutionIndex];
    const { cursorLine, lines, start } = parseChallengeDoc(text, position);
    const completion = [cursorLine.slice(Math.min(start.character, position.character))]
      .concat(lines.slice(position.line + 1))
      .join('\n');

    solutionHandler.offset =
      lines.slice(0, position.line).reduce((a: number, b: string) => a + b.length + 1, 0) + start.character;

    solutionHandler.onSolution({
      requestId: {
        headerRequestId,
        completionId: uuidv4(),
        created: 0,
        serverExperiments: '',
        deploymentId: '',
      },
      completionText: completion,
      insertText: completion,
      range: { start: position, end: position },
      meanProb: score,
      meanLogProb: -1,
      choiceIndex: solutionIndex,
      telemetryData: TelemetryWithExp.createEmptyConfigForTesting(),
    });
  }
  solutionHandler.onFinishedNormally();
}

async function handleTestingSetPanelCompletionDocumentsChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  ctx.forceSet(PanelCompletionDocuments, new PanelCompletionDocuments(params.documents));
  return ['OK', null];
}

const PanelCompletionDocument = Type.Object({ text: Type.String(), score: Type.Number() });
const Params = Type.Object({
  documents: Type.Array(PanelCompletionDocument),
  options: Type.Optional(Type.Object({})),
});

class PanelCompletionDocuments {
  constructor(public documents: { text: string; score: number }[]) { }
}

const handleTestingSetPanelCompletionDocuments = addMethodHandlerValidation(
  Params,
  handleTestingSetPanelCompletionDocumentsChecked
);

export { handleTestingSetPanelCompletionDocuments, runTestSolutions, PanelCompletionDocuments };
