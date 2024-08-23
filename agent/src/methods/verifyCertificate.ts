import { Type, type Static } from '@sinclair/typebox';
import * as os from 'node:os';
import { type CancellationToken } from '../cancellation';

import { Context } from '../../../lib/src/context';
import { normalizeNewlines, asReadableCert } from '../../../lib/src/testing/certificates';
import { getRootCertificateReader } from '../../../lib/src/network/certificateReaders';
import { addMethodHandlerValidation } from '../schemaValidation';

const Params = Type.Object({ expectedCertificate: Type.String() });

async function handleVerifyCertificateChecked(
  ctx: Context,
  token: CancellationToken,
  params: Static<typeof Params>
): Promise<[{ status: boolean; message: string }, null]> {
  const rootCertificateReader = getRootCertificateReader(ctx);
  const certs = (await rootCertificateReader.getAllRootCAs()).map(normalizeNewlines);
  const expectedCert = normalizeNewlines(params.expectedCertificate);

  if (certs.includes(expectedCert)) {
    return [{ status: true, message: 'Certificate verified' }, null];
  } else {
    return [
      {
        status: false,
        // message: `expected certificate not found - Expected to find certificate ${asReadableCert(expectedCert)}. Only found those installed on the system:${os.EOL}${certs.map((c) => '- ' + asReadableCert(c)).join(os.EOL)}`,
        message: [
          `expected certificate not found - Expected to find certificate ${asReadableCert(expectedCert)}. Only found those installed on the system:`,
          ...certs.map((c) => `- ${asReadableCert(c)}`),
        ].join(os.EOL),
      },
      null,
    ];
  }
}

const handleVerifyCertificate = addMethodHandlerValidation(Params, handleVerifyCertificateChecked);

export { handleVerifyCertificate };
