import { errorMessageForUnsupportedNodeVersion } from "../../lib/src/util/nodeVersion.ts";
import { main } from "./context.ts";

const nodeVersionError = errorMessageForUnsupportedNodeVersion();
if (nodeVersionError) {
  console.error(nodeVersionError);
  process.exit(2);
}

main();
