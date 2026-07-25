import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { startSyncScheduler } from "./jobs/syncScheduler.js";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`[isphub-api] ouvindo na porta ${env.PORT}`);
  startSyncScheduler();
});
