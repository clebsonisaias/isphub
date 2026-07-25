import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** Semeia usuarios/provedor/OS deterministicos antes da suite E2E rodar. */
export default async function globalSetup() {
  execSync("npm run seed:e2e -w @isphub/api", { cwd: REPO_ROOT, stdio: "inherit" });
}
