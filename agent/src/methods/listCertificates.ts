import { Type } from '@sinclair/typebox';

import { Context } from '../../../lib/src/context.ts';
import { normalizeNewlines } from '../../../lib/src/testing/certificates.ts';
import { RootCertificateReader } from '../../../lib/src/network/certificateReaders.ts';
import { addMethodHandlerValidation } from '../schemaValidation.ts';

async function handleListCertificatesChecked(ctx: Context): Promise<[{ certificates: string[] }, null]> {
  return [{ certificates: (await ctx.get(RootCertificateReader).getAllRootCAs()).map(normalizeNewlines) }, null];
}

const Params = Type.Object({});

const handleListCertificates = addMethodHandlerValidation(Params, handleListCertificatesChecked);

export { handleListCertificates };
