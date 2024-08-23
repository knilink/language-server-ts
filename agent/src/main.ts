import { errorMessageForUnsupportedNodeVersion } from '../../lib/src/util/nodeVersion';
import { main } from './context';

const nodeVersionError = errorMessageForUnsupportedNodeVersion();
if (nodeVersionError) {
  console.error(nodeVersionError);
  process.exit(2);
}

main();
