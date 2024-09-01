import { Type, type Static } from '@sinclair/typebox';
import { type CancellationToken } from "../../cancellation.ts";
import { type Context } from "../../../../lib/src/context.ts";
import { SyntheticTurns } from "../../conversation/syntheticTurnProcessor.ts";
import { ReferenceSchema } from "../../../../lib/src/conversation/schema.ts";
import { addMethodHandlerValidation } from "../../schemaValidation.ts";

const Params = Type.Object({
  workDoneToken: Type.Union([Type.String(), Type.Number()]),
  chunks: Type.Array(Type.String()),
  followUp: Type.Optional(Type.String()),
  suggestedTitle: Type.Optional(Type.String()),
  skills: Type.Optional(Type.Array(Type.String())),
  references: Type.Optional(Type.Array(ReferenceSchema)),
  options: Type.Optional(Type.Object({})),
});

async function handleTestingSetSyntheticTurnsChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<['OK', null]> {
  ctx
    .get(SyntheticTurns)
    .add(params.workDoneToken, params.chunks, params.followUp, params.suggestedTitle, params.skills, params.references);
  return ['OK', null];
}

const handleTestingSetSyntheticTurns = addMethodHandlerValidation(Params, handleTestingSetSyntheticTurnsChecked);

export { handleTestingSetSyntheticTurns };
