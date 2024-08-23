import { Type } from '@sinclair/typebox';

import { Context } from '../../../../lib/src/context';
import { formatDiagnosticsAsMarkdown, collectDiagnostics } from '../../../../lib/src/diagnostics';
import { addMethodHandlerValidation } from '../../schemaValidation';

const Params = Type.Object({});

async function handleDiagnosticsChecked(ctx: Context): Promise<[{ report: string }, null]> {
  return [{ report: formatDiagnosticsAsMarkdown(await collectDiagnostics(ctx)) }, null];
}

const handleDiagnostics = addMethodHandlerValidation(Params, handleDiagnosticsChecked);

export { handleDiagnostics };
