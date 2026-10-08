import path from 'node:path';
import { defineConfig } from '@playwright/test';
import notifications from './playwright.config.notifications';

const servers = Array.isArray(notifications.webServer) ? notifications.webServer : [];
export default defineConfig({
  ...notifications,
  testDir: 'search',
  outputDir: 'search/.test-results',
  webServer: [
    {
      command: `node ${path.resolve(__dirname, 'setup/fake-codex.cjs')}`,
      url: 'http://127.0.0.1:8792/health',
      reuseExistingServer: false,
    },
    ...servers.map((server) => ({
      ...server,
      env: {
        ...server.env,
        CONFIG_PATH: path.resolve(__dirname, 'search/librechat.yaml'),
        CODEX_CONNECTOR_API_KEY: 'e2e-codex-client-key',
      },
    })),
  ],
});
