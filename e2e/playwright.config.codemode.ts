import path from 'node:path';
import { defineConfig } from '@playwright/test';
import notifications from './playwright.config.notifications';

const servers = Array.isArray(notifications.webServer) ? notifications.webServer : [];
export default defineConfig({
  ...notifications,
  testDir: 'codemode',
  outputDir: 'codemode/.test-results',
  webServer: servers.map((server) => ({
    ...server,
    env: { ...server.env, CONFIG_PATH: path.resolve(__dirname, 'codemode/librechat.yaml') },
  })),
});
