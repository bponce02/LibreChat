import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { attachCodemodeHost, getCodemodeToolNames } from './host';
import { withToolApprovalExecution } from '~/tools/approval';
import { createCodemodeTool } from './tool';

function configured(targets: StructuredToolInterface[]) {
  const tools = [
    createCodemodeTool({
      policy: { enabled: true },
      getHost: async () => {
        throw new Error('unbound');
      },
    })!,
    ...targets,
  ];
  attachCodemodeHost({ tools, policy: { enabled: true } });
  return tools[0];
}
function content(value: unknown): unknown {
  return typeof value === 'string' ? value : (value as { content: unknown }).content;
}

test('only selected tools are acquired and nested IDs preserve notification idempotency', async () => {
  const calls: string[] = [];
  const notify = tool(
    async (_input, config) => {
      calls.push(config.toolCall!.id!);
      return { queued: true };
    },
    { name: 'notify_user', description: 'Notify', schema: z.object({ title: z.string() }) },
  );
  const mode = configured([notify]);
  for (let i = 0; i < 2; i++) {
    const output = await mode.invoke(
      { code: 'text(searchTools("notify")); return await tools.notify_user({title:"done"});' },
      { toolCall: { id: 'outer' } } as Record<string, unknown>,
    );
    expect(JSON.parse(String(content(output))).ok).toBe(true);
  }
  expect(calls).toEqual(['outer:1', 'outer:1']);
  expect(
    getCodemodeToolNames(['codemode'], ['codemode', 'notify_user', 'ask_user_question'], {
      enabled: true,
    }),
  ).toEqual(['codemode', 'notify_user']);
});

test('existing execution policy denial fails closed without prompting or dispatching', async () => {
  const execute = jest.fn().mockResolvedValue('secret');
  const target = tool(execute, {
    name: 'restricted',
    description: 'Restricted',
    schema: z.object({}),
  });
  const mode = configured([target]);
  const validateExecution = jest.fn().mockRejectedValue(new Error('denied'));
  const output = await withToolApprovalExecution({ validateExecution }, () =>
    mode.invoke({ code: 'return await tools.restricted({});' }, {
      toolCall: { id: 'outer' },
    } as Record<string, unknown>),
  );
  expect(JSON.parse(String(content(output))).ok).toBe(false);
  expect(execute).not.toHaveBeenCalled();
});

test('image output uses opaque host refs and forwards only selected tool images', async () => {
  const picture = { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } };
  const generate = tool(async () => [picture], {
    name: 'picture',
    description: 'Picture',
    schema: z.object({}),
  });
  const mode = configured([generate]);
  const result = await mode.invoke(
    { code: 'const blocks = await tools.picture({}); image(blocks[0].ref);' },
    { toolCall: { id: 'outer' } } as Record<string, unknown>,
  );
  expect(content(result)).toEqual([expect.objectContaining({ type: 'text' }), picture]);
  const forged = await mode.invoke({ code: 'image("image-" + "a".repeat(64));' }, {
    toolCall: { id: 'forged' },
  } as Record<string, unknown>);
  expect(JSON.parse(String(content(forged))).error).toBe('SCRIPT_ERROR');
});
