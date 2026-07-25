import { defineConfig, devices } from "@playwright/test";

/**
 * Suite E2E do ISPhub. Sobe API + web + um SGP fixture dedicado (porta 4569,
 * ver e2e/fixtures/mock-sgp-server.mjs) e roda contra o Postgres de dev local
 * — o global-setup semeia usuarios/provedor/OS fixos e determinísticos antes
 * de cada execução (ver e2e/global-setup.ts).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  globalSetup: "./e2e/global-setup.ts",
  webServer: [
    {
      command: "npm run dev:api",
      cwd: "../../",
      url: "http://localhost:4000/health",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "node e2e/fixtures/mock-sgp-server.mjs",
      cwd: ".",
      url: "http://localhost:4569",
      reuseExistingServer: true,
      timeout: 15_000,
    },
    {
      command: "npm run dev",
      cwd: ".",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
