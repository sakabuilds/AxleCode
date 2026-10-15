// Side-effect module: installs the JS global error handler as early as
// possible — imported first in index.ts so it runs before the rest of the
// app graph evaluates. Fatal errors are captured instead of killing the
// process so the UI can show what went wrong.
import { installStartupErrorReporting } from "./startupErrorReporting";

installStartupErrorReporting();