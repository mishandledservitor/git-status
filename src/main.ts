import { defaultConfigPath } from './config.js';
import { createApp } from './server.js';

const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? '127.0.0.1';
const configPath = process.env.GIT_STATUS_GUI_CONFIG ?? defaultConfigPath();

createApp({ configPath }).listen(port, host, () => {
  console.log(`git-status-gui  →  http://${host}:${port}`);
  console.log(`config          →  ${configPath}`);
});
