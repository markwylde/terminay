// A holder that cannot start, as the production entry reports it: the reason
// goes to the launcher over the readiness descriptor, then the process exits.
import { reportSessionHolderStartupFailure } from "../../dist/index.js";

reportSessionHolderStartupFailure(process.env.TERMINAY_TEST_HOLDER_FAILURE, process.env);
process.exit(1);
