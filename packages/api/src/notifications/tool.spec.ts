import { createNotificationTool } from './tool';

function fixture() {
  const getConversation = jest.fn().mockResolvedValue({ conversationId: 'chat' });
  const enqueue = jest.fn().mockResolvedValue({
    ok: true,
    notificationId: 'notification',
    status: 'queued',
    duplicate: false,
  });
  const dependencies = {
    userId: 'owner',
    tenantId: 'tenant',
    conversationId: 'chat',
    config: { enabled: true },
    getConversation,
    enqueue,
  };
  return { ...dependencies, tool: createNotificationTool(dependencies)! };
}
const call = {
  type: 'tool_call' as const,
  id: 'trusted-call',
  name: 'notify_user',
  args: { title: 'Backup', body: 'Finished' },
};

test('tool uses trusted run identity and the actual LangChain tool-call ID', async () => {
  const f = fixture();
  const result = await f.tool.invoke(call);
  expect(result.content).toContain('queued');
  expect(f.getConversation).toHaveBeenCalledWith('owner', 'chat');
  expect(f.enqueue).toHaveBeenCalledWith(
    { userId: 'owner', tenantId: 'tenant', conversationId: 'chat', toolCallId: 'trusted-call' },
    call.args,
    10,
  );
});

test('tool cannot choose a recipient, URL or conversation through arguments', async () => {
  const f = fixture();
  await expect(
    f.tool.invoke({
      ...call,
      args: {
        ...call.args,
        userId: 'victim',
        url: 'https://example.test',
        conversationId: 'other',
      },
    }),
  ).rejects.toThrow();
  expect(f.enqueue).not.toHaveBeenCalled();
});

test('disabled tools do not load and foreign conversations cannot enqueue', async () => {
  const f = fixture();
  expect(createNotificationTool({ ...f, config: { enabled: false } })).toBeNull();
  f.getConversation.mockResolvedValue(null);
  const result = await f.tool.invoke(call);
  expect(result.content).toContain('NOT_AUTHORIZED');
  expect(f.enqueue).not.toHaveBeenCalled();
});

test('operational error details never reach the agent', async () => {
  const f = fixture();
  f.enqueue.mockRejectedValue(new Error('mongodb://user:secret@example.test'));
  const result = await f.tool.invoke(call);
  expect(result.content).toContain('NOTIFICATION_UNAVAILABLE');
  expect(result.content).not.toContain('secret');
});
