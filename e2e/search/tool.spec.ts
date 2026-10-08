import { expect, test } from '@playwright/test';
import {
  getAccessToken,
  requestJson,
  sendMessageAndWaitForCompletion,
} from '../specs/mock/helpers';
import { openAgentBuilder } from '../specs/mock/agents.helpers';

for (const mode of ['official', 'direct']) {
  test(`agent invokes Codex search (${mode}) and renders a source link without prompts`, async ({
    page,
  }, info) => {
    await page.goto('/c/new');
    const token = await getAccessToken(page);
    const agent = await requestJson<{ id: string; name: string }>(page, {
      path: '/api/agents',
      token,
      method: 'POST',
      body: {
        name: `Codex search test ${mode}`,
        provider: 'openAI',
        model: 'gpt-4o-mini',
        tools: mode === 'direct' ? ['codex_web_search'] : ['codemode', 'codex_web_search'],
        instructions: 'Use Codex search for research.',
      },
    });
    const form = await openAgentBuilder(page);
    await form.getByRole('combobox', { name: 'Agent', exact: true }).click();
    await page.getByRole('option', { name: agent.name }).click();
    await form.getByRole('button', { name: 'Select Agent' }).click();
    await sendMessageAndWaitForCompletion(page, `E2E_CODEX_SEARCH:${mode}`);
    await expect(
      page
        .getByTestId('screenshot-target')
        .getByText('E2E Codex search completed', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTestId('screenshot-target').getByRole('link', { name: 'Official Codex docs' }),
    ).toHaveAttribute('href', 'https://developers.openai.com/codex/');
    console.info('Codex search source URL:', page.url());
    await info.attach('page-url', { body: page.url(), contentType: 'text/plain' });
    await page.screenshot({ path: info.outputPath('search.png'), fullPage: true });
  });
}
