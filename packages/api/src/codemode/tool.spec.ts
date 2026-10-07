import { createCodemodeTool } from './tool';

function parseResult(result: unknown) {
  const content = typeof result === 'string' ? result : (result as { content: string }).content;
  return JSON.parse(content);
}
const descriptor = {
  name: 'notify_user',
  description: 'Notify owner',
  inputSchema: { type: 'object' },
};
test('disabled by default and missing run identity cannot acquire a dispatcher', async () => {
  const getHost = jest.fn();
  expect(createCodemodeTool({ getHost })).toBeNull();
  const tool = createCodemodeTool({ policy: { enabled: true }, getHost })!;
  expect(parseResult(await tool.invoke({ code: 'return 1' }))).toMatchObject({
    ok: false,
    error: 'UNAVAILABLE',
  });
  expect(getHost).not.toHaveBeenCalled();
});

test('host receives stable nested call identities and approval failures do not invoke another path', async () => {
  const invoke = jest.fn().mockRejectedValue(new Error('Approval required'));
  const getHost = jest.fn().mockResolvedValue({ tools: [descriptor], invoke });
  const tool = createCodemodeTool({ policy: { enabled: true }, getHost })!;
  const result = parseResult(
    await tool.invoke(
      { code: 'try { await tools.notify_user({ title:"done" }); } catch(e) { text(e.message); }' },
      { toolCall: { id: 'outer' } } as Record<string, unknown>,
    ),
  );
  expect(result).toMatchObject({ ok: true, output: ['Tool invocation failed'] });
  expect(invoke).toHaveBeenCalledWith(
    'notify_user',
    { title: 'done' },
    expect.any(AbortSignal),
    'outer:1',
  );
});

test('recursive exposure is rejected', async () => {
  const getHost = jest
    .fn()
    .mockResolvedValue({ tools: [{ ...descriptor, name: 'codemode' }], invoke: jest.fn() });
  const tool = createCodemodeTool({ policy: { enabled: true }, getHost })!;
  expect(
    parseResult(
      await tool.invoke({ code: 'return 1' }, { toolCall: { id: 'outer' } } as Record<
        string,
        unknown
      >),
    ),
  ).toMatchObject({ ok: false, error: 'UNAVAILABLE' });
});
