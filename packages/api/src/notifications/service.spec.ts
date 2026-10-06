import { createNotificationService } from './service';

const context = {
  userId: 'owner',
  tenantId: 'tenant',
  conversationId: 'conversation',
  toolCallId: 'tool-call',
};
const policy = {
  enabled: true,
  maxTitleLength: 80,
  maxBodyLength: 500,
  maxPerMinute: 10,
  pageSize: 50,
  pollIntervalMs: 15000,
};
const input = { title: 'Backup finished', body: 'The nightly backup succeeded.' };

function fixture() {
  const authorize = jest.fn().mockResolvedValue(true);
  const enqueue = jest.fn().mockResolvedValue({
    ok: true,
    notificationId: 'notification',
    status: 'queued',
    duplicate: false,
  });
  return { authorize, enqueue, notify: createNotificationService({ authorize, enqueue }) };
}

describe('agent notification service', () => {
  it('queues for the authenticated run without claiming delivery', async () => {
    const service = fixture();
    const result = await service.notify(context, input, policy);
    expect(result).toEqual({
      ok: true,
      notificationId: 'notification',
      status: 'queued',
      duplicate: false,
    });
    expect(service.authorize).toHaveBeenCalledWith(context);
    expect(service.enqueue).toHaveBeenCalledWith(context, input, policy.maxPerMinute);
  });

  it('does not enqueue when disabled or unauthorized', async () => {
    const service = fixture();
    expect(await service.notify(context, input, { ...policy, enabled: false })).toEqual({
      ok: false,
      error: { code: 'DISABLED' },
    });
    expect(service.authorize).not.toHaveBeenCalled();
    service.authorize.mockResolvedValue(false);
    expect(await service.notify(context, input, policy)).toEqual({
      ok: false,
      error: { code: 'NOT_AUTHORIZED' },
    });
    expect(service.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    { ...context, userId: '' },
    { ...context, conversationId: '' },
    { ...context, toolCallId: '' },
  ])('rejects missing trusted identity', async (missingContext) => {
    const service = fixture();
    expect(await service.notify(missingContext, input, policy)).toEqual({
      ok: false,
      error: { code: 'NOT_AUTHORIZED' },
    });
    expect(service.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    { title: ' ', body: 'body' },
    { title: 'title', body: ' ' },
    { title: 'x'.repeat(81), body: 'body' },
    { title: 'title', body: 'x'.repeat(501) },
  ])('rejects invalid content before storage', async (invalidInput) => {
    const service = fixture();
    expect(await service.notify(context, invalidInput, policy)).toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(service.enqueue).not.toHaveBeenCalled();
  });

  it('passes repository deduplication and rate-limit results through', async () => {
    const service = fixture();
    const limited = { ok: false, error: { code: 'RATE_LIMITED' } };
    service.enqueue.mockResolvedValue(limited);
    expect(await service.notify(context, input, policy)).toEqual(limited);
    const duplicate = { ok: true, notificationId: 'existing', status: 'queued', duplicate: true };
    service.enqueue.mockResolvedValue(duplicate);
    expect(await service.notify(context, input, policy)).toEqual(duplicate);
  });

  it('does not convert an operational failure into success', async () => {
    const service = fixture();
    service.enqueue.mockRejectedValue(new Error('storage unavailable'));
    await expect(service.notify(context, input, policy)).rejects.toThrow('storage unavailable');
  });
});
