import { expect, test } from '@playwright/test';
import type { NotificationList } from 'librechat-data-provider';
import {
  fetchJson,
  getAccessToken,
  requestJson,
  sendMessageAndWaitForCompletion,
} from '../specs/mock/helpers';
import { openAgentBuilder } from '../specs/mock/agents.helpers';

test('agent codemode invokes its notification tool without approval prompts', async ({
  page,
}, info) => {
  await page.goto('/c/new');
  const token = await getAccessToken(page);
  const agent = await requestJson<{ id: string; name: string }>(page, {
    path: '/api/agents',
    token,
    method: 'POST',
    body: {
      name: 'Codemode test',
      provider: 'openAI',
      model: 'gpt-4o-mini',
      tools: ['codemode', 'notify_user'],
      instructions: 'Use codemode for requested tool work.',
    },
  });
  const form = await openAgentBuilder(page);
  await form.getByRole('combobox', { name: 'Agent', exact: true }).click();
  await page.getByRole('option', { name: agent.name }).click();
  await form.getByRole('button', { name: 'Select Agent' }).click();
  await sendMessageAndWaitForCompletion(page, 'E2E_CODEMODE:notify');
  await expect(
    page
      .getByTestId('screenshot-target')
      .getByText('E2E codemode completed without prompts', { exact: true }),
  ).toBeVisible();
  const inbox = await fetchJson<NotificationList>(page, '/api/notifications', token);
  expect(inbox.notifications).toHaveLength(1);
  expect(inbox.notifications[0].title).toBe('Codemode complete');
  console.info('Codemode source URL:', page.url());
  await info.attach('page-url', { body: page.url(), contentType: 'text/plain' });
  await page.screenshot({ path: info.outputPath('codemode.png'), fullPage: true });
});
