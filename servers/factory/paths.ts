import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
export const appHtmlPath = here.includes(`${sep}dist${sep}`)
  ? join(here, "../../app/factory.html")
  : join(here, "../../dist/app/factory.html");
