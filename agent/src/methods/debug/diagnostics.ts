import { Type } from '@sinclair/typebox';

import { Context } from "../../../../lib/src/context.ts";
import { formatDiagnosticsAsMarkdown, collectDiagnostics } from "../../../../lib/src/diagnostics.ts";
import { addMethodHandlerValidation } from "../../schemaValidation.ts";

const Params = Type.Object({});

async function handleDiagnosticsChecked(ctx: Context): Promise<[{ report: string }, null]> {
  return [{ report: formatDiagnosticsAsMarkdown(await collectDiagnostics(ctx)) }, null];
}

const handleDiagnostics = addMethodHandlerValidation(Params, handleDiagnosticsChecked);

export { handleDiagnostics };
