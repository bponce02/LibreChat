import { filterCodexSearchPlugins, getCodexSearchCatalogTools } from './catalog';
import { createCodexSearchTool } from './tool';

const policy = { enabled: true, model: 'test-model', baseUrl: 'http://codex-connector:8788/v1' };
const payload = {
  choices: [
    {
      message: {
        content: 'Grounded answer',
        native_search: {
          performed: true,
          sources: [{ title: 'Docs', url: 'https://example.com/' }],
        },
      },
    },
  ],
};
const make = (fetcher = jest.fn().mockResolvedValue(new Response(JSON.stringify(payload)))) => ({
  tool: createCodexSearchTool({ policy, apiKey: 'private-server-key', fetch: fetcher })!,
  fetcher,
});

it('is disabled by default and unavailable without model or server key', () => {
  expect(createCodexSearchTool({ fetch })).toBeNull();
  expect(createCodexSearchTool({ policy, fetch })).toBeNull();
  expect(createCodexSearchTool({ policy: { enabled: true }, apiKey: 'key', fetch })).toBeNull();
  expect(
    filterCodexSearchPlugins([
      { pluginKey: 'codex_web_search' },
      { pluginKey: 'calculator' },
    ] as never),
  ).toEqual([{ pluginKey: 'calculator' }]);
  expect(getCodexSearchCatalogTools(['calculator'], [])).toEqual([]);
  expect(getCodexSearchCatalogTools(['codex_web_search'], [])).toHaveLength(1);
});

it('uses only the server endpoint/key/model and explicitly requires native live search', async () => {
  const { tool, fetcher } = make();
  const result = JSON.parse((await tool.invoke({ query: ' Find official docs ' })) as string);
  expect(result).toEqual({
    ok: true,
    answer: 'Grounded answer',
    truncated: false,
    sources: [{ title: 'Docs', url: 'https://example.com/' }],
  });
  const [url, request] = fetcher.mock.calls[0];
  expect(url).toBe('http://codex-connector:8788/v1/chat/completions');
  expect(request.redirect).toBe('error');
  expect(JSON.parse(request.body)).toMatchObject({
    model: 'test-model',
    tools: [{ type: 'web_search', external_web_access: true }],
    tool_choice: 'required',
    messages: [{ role: 'system' }, { role: 'user', content: 'Find official docs' }],
  });
  expect(JSON.stringify(result)).not.toContain('private-server-key');
});

it('rejects caller endpoint/model/key overrides and empty or oversized queries before HTTP', async () => {
  const { tool, fetcher } = make();
  for (const input of [
    { query: '' },
    { query: 'x'.repeat(4001) },
    { query: 'docs', model: 'other' },
    { query: 'docs', baseUrl: 'https://evil.example' },
  ])
    await expect(tool.invoke(input)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([401, 429, 500])('sanitizes upstream HTTP %s failures', async (status) => {
  const { tool } = make(
    jest.fn().mockResolvedValue(new Response('SECRET provider error', { status })),
  );
  expect(JSON.parse((await tool.invoke({ query: 'docs' })) as string)).toEqual({
    ok: false,
    error: { code: 'SEARCH_UNAVAILABLE' },
  });
});

it('fails closed if the provider returned a normal answer without native search execution', async () => {
  const data = structuredClone(payload);
  data.choices[0].message.native_search.performed = false;
  const { tool } = make(jest.fn().mockResolvedValue(new Response(JSON.stringify(data))));
  expect(JSON.parse((await tool.invoke({ query: 'docs' })) as string).ok).toBe(false);
});

it('bounds response bytes, answer length and source links', async () => {
  const fetcher = jest.fn().mockResolvedValue(new Response('x'.repeat(2000)));
  const tool = createCodexSearchTool({
    policy: { ...policy, maxResponseBytes: 1024 },
    apiKey: 'key',
    fetch: fetcher,
  })!;
  expect(JSON.parse((await tool.invoke({ query: 'docs' })) as string).ok).toBe(false);
  const data = structuredClone(payload);
  data.choices[0].message.content = 'a'.repeat(200);
  data.choices[0].message.native_search.sources.push(
    { title: 'Unsafe', url: 'javascript:alert(1)' },
    { title: 'Credential', url: 'https://user:secret@example.com/' },
  );
  const bounded = createCodexSearchTool({
    policy: { ...policy, maxAnswerLength: 100 },
    apiKey: 'key',
    fetch: jest.fn().mockResolvedValue(new Response(JSON.stringify(data))),
  })!;
  const result = JSON.parse((await bounded.invoke({ query: 'docs' })) as string);
  expect(result.answer).toHaveLength(100);
  expect(result.truncated).toBe(true);
  expect(result.sources).toHaveLength(1);
});

it('propagates cancellation and exposes only a safe error code', async () => {
  const abort = new AbortController();
  const fetcher = jest.fn(async (_url, init) => {
    abort.abort();
    init.signal.throwIfAborted();
    throw new Error('SECRET');
  });
  const { tool } = make(fetcher);
  await expect(tool.invoke({ query: 'docs' }, { signal: abort.signal })).rejects.toThrow('Aborted');
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
});
