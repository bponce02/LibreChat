import path from 'node:path';
import { defineConfig } from '@playwright/test';
import notifications from './playwright.config.notifications';

const servers = Array.isArray(notifications.webServer) ? notifications.webServer : [];
export default defineConfig({
  ...notifications,
  testDir: 'pi',
  outputDir: 'pi/.test-results',
  webServer: servers.map((server) => ({
    ...server,
    env: {
      ...server.env,
      CONFIG_PATH: path.resolve(__dirname, 'pi/librechat.yaml'),
      PI_SYNC_KEY: 'e2e-pi-sync-key-not-a-real-secret-123456789',
      ENDPOINTS: 'openAI,agents,custom',
    },
  })),
});
