import path from 'node:path';
import { defineConfig } from '@playwright/test';
import notifications from './playwright.config.notifications';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3099';
const servers = Array.isArray(notifications.webServer) ? notifications.webServer : [];
export default defineConfig({
  ...notifications,
  globalSetup: require.resolve('./workspace/setup'),
  testDir: 'workspace',
  outputDir: 'workspace/.test-results',
  fullyParallel: false,
  webServer: [
    {
      command: `node ${path.resolve(__dirname, 'setup/fake-terminal.cjs')}`,
      url: 'http://127.0.0.1:8793/health',
      reuseExistingServer: false,
    },
    ...servers.map((server) => ({
      ...server,
      env: {
        ...server.env,
        CONFIG_PATH: path.resolve(__dirname, 'workspace/librechat.yaml'),
        OPEN_TERMINAL_API_KEY: 'e2e-terminal-server-key',
        DOMAIN_CLIENT: baseURL,
      },
    })),
  ],
});
