import { Type, type Static } from '@sinclair/typebox';

import { type Context } from '../../../lib/src/context';
import { type CancellationToken } from '../cancellation';

import { FileReader, statusFromTextDocumentResult } from '../../../lib/src/fileReader';
import { addMethodHandlerValidation } from '../schemaValidation';

const Params = Type.Object({ uri: Type.String({ minLength: 1 }) });

async function handleCheckFileStatusChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[{ status: 'blocked' | 'notfound'; reason: string } | { status: 'included' | 'empty' }, null]> {
  const fileReader = ctx.get<FileReader>(FileReader);
  const readFileResult = await fileReader.readFile(params.uri);
  // return [
  //   {
  //     status: statusFromTextDocumentResult(readFileResult),
  //     ...(readFileResult.status === 'invalid' && { reason: readFileResult.reason }),
  //     ...(readFileResult.status === 'notfound' && { reason: readFileResult.message }),
  //   },
  //   null,
  // ];
  const status = statusFromTextDocumentResult(readFileResult);
  let reason = '';
  if (readFileResult.status === 'invalid') reason = readFileResult.reason;
  else if (readFileResult.status === 'notfound') reason = readFileResult.message;
  if (status === 'blocked' || status === 'notfound') return [{ status, reason }, null];
  return [{ status }, null];
}

const handleCheckFileStatus = addMethodHandlerValidation(Params, handleCheckFileStatusChecked);

export { handleCheckFileStatus };
