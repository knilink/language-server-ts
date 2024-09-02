import { Type } from '@sinclair/typebox';

import { addMethodHandlerValidation } from '../schemaValidation.ts';
import { KerberosLoader } from '../../../lib/src/network/proxySockets.ts';

const Params = Type.Object({});

async function handleVerifyKerberosChecked(): Promise<[{ status: boolean }, null]> {
  return [{ status: !!new KerberosLoader().load() }, null];
}

const handleVerifyKerberos = addMethodHandlerValidation(Params, handleVerifyKerberosChecked);

export { Params, handleVerifyKerberos };
