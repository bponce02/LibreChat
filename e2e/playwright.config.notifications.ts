import path from 'node:path';
import { defineConfig } from '@playwright/test';
import mockConfig from './playwright.config.mock';

const servers = (Array.isArray(mockConfig.webServer) ? mockConfig.webServer : []).filter((server) =>
  server.command.endsWith('start-server.js'),
);
if (servers.length !== 1) {
  throw new Error('Notifications require the isolated single-server harness.');
}

export default defineConfig({
  ...mockConfig,
  testDir: 'notifications',
  use: { ...mockConfig.use, channel: process.env.E2E_CHROMIUM_CHANNEL || 'chromium' },
  outputDir: 'notifications/.test-results',
  timeout: 120000,
  retries: 0,
  reporter: [['line']],
  webServer: servers.map((server) => ({
    ...server,
    env: {
      ...server.env,
      CONFIG_PATH: path.resolve(__dirname, 'notifications/librechat.yaml'),
      ENDPOINTS: 'openAI,agents',
      OPENAI_MODELS: 'gpt-4o-mini',
      OPENAI_API_KEY: 'e2e-not-a-real-key',
      OPENAI_REVERSE_PROXY: 'http://127.0.0.1:1/v1',
      ASSISTANTS_API_KEY: '',
      E2E_USE_MEMORY_MONGO: 'true',
      LIBRECHAT_WEB_PUSH_PRIVATE_KEY: Buffer.alloc(32, 1).toString('base64url'),
      NODE_OPTIONS: `${server.env.NODE_OPTIONS ?? ''} --require=${path.resolve(__dirname, 'setup/fake-push.cjs')}`,
    },
  })),
});
