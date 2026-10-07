import { codemodeConfigSchema } from 'librechat-data-provider';
import type { CodemodeHost } from './runtime';
import { runCodemode } from './runtime';

const policy = codemodeConfigSchema.parse({ enabled: true, timeoutMs: 3000 });
const tools = [{ name: 'status', description: 'Service health', inputSchema: { type: 'object' } }];
const host: CodemodeHost = { tools, invoke: async (_name, input) => input };

test('runs real QuickJS with top-level await, discovery, batching and selected output', async () => {
  const result = await runCodemode(
    `
    text(searchTools('health'));
    const values = await Promise.allSettled([tools.status({service:'db'}), tools.status({service:'backup'})]);
    text(values.map(v => v.value.service));
    return describeTool('status').name;
  `,
    policy,
    host,
  );
  expect(result).toEqual({
    ok: true,
    output: ['[{"name":"status","description":"Service health"}]', '["db","backup"]', 'status'],
  });
});

test('has no Node process, modules, network, or filesystem globals', async () => {
  const result = await runCodemode(
    `return [typeof process, typeof require, typeof fetch, typeof Buffer, typeof window];`,
    policy,
    host,
  );
  expect(result).toEqual({
    ok: true,
    output: ['["undefined","undefined","undefined","undefined","undefined"]'],
  });
});

test('bounds synchronous loops and unresolved asynchronous work', async () => {
  for (const code of ['while(true) {}', 'await new Promise(() => {});']) {
    const result = await runCodemode(code, { ...policy, timeoutMs: 200 }, host);
    expect(result.error).toBe('TIMEOUT');
  }
});

test('aborts pending dispatch and does not start waiting calls after cancellation', async () => {
  const controller = new AbortController();
  const invoke = jest.fn(async (_name: string, _input: unknown, signal: AbortSignal) => {
    controller.abort();
    await new Promise<void>((resolve) =>
      signal.aborted
        ? resolve()
        : signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    return null;
  });
  const result = await runCodemode(
    'await Promise.all([tools.status({}),tools.status({})]);',
    { ...policy, concurrency: 1 },
    { tools, invoke },
    controller.signal,
  );
  expect(result.error).toBe('CANCELLED');
  expect(invoke).toHaveBeenCalledTimes(1);
});

test('limits calls, output, values and code', async () => {
  expect(
    (
      await runCodemode(
        'await Promise.all([tools.status({}),tools.status({})]);',
        { ...policy, maxToolCalls: 1 },
        host,
      )
    ).error,
  ).toBe('LIMIT');
  expect(
    (await runCodemode('text("x".repeat(2048));', { ...policy, maxOutputBytes: 1024 }, host)).error,
  ).toBe('LIMIT');
  expect(
    (
      await runCodemode(
        'return await tools.status({});',
        { ...policy, maxValueBytes: 1024 },
        { tools, invoke: async () => 'x'.repeat(2048) },
      )
    ).error,
  ).toBe('LIMIT');
  expect((await runCodemode(' '.repeat(2048), { ...policy, maxCodeBytes: 1024 }, host)).error).toBe(
    'INVALID_CODE',
  );
});

test('tool errors remain catchable but never disclose host errors', async () => {
  const result = await runCodemode(
    'try { await tools.status({}); } catch(e) { return e.message; }',
    policy,
    {
      tools,
      invoke: async () => {
        throw new Error('secret token');
      },
    },
  );
  expect(result).toEqual({ ok: true, output: ['Tool invocation failed'] });
});

test('tool result text is data, never evaluated as code', async () => {
  const result = await runCodemode('return await tools.status({});', policy, {
    tools,
    invoke: async () => 'text("injected"); process.exit()',
  });
  expect(result.output).toEqual(['text("injected"); process.exit()']);
});

test('disabled and pre-cancelled calls do not invoke tools', async () => {
  const invoke = jest.fn();
  expect((await runCodemode('', { ...policy, enabled: false }, { tools, invoke })).error).toBe(
    'DISABLED',
  );
  expect((await runCodemode('', policy, { tools, invoke }, AbortSignal.abort())).error).toBe(
    'CANCELLED',
  );
  expect(invoke).not.toHaveBeenCalled();
});
