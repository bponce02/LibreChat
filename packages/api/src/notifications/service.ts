import type {
  NotificationContext,
  NotificationInput,
  NotificationPolicy,
  NotificationResult,
} from 'librechat-data-provider';

export interface NotificationDependencies {
  authorize: (context: NotificationContext) => Promise<boolean>;
  enqueue: (
    context: NotificationContext,
    input: NotificationInput,
    maxPerMinute: number,
  ) => Promise<NotificationResult>;
}

/** Context comes from the authenticated run, never from model arguments. */
export function createNotificationService(dependencies: NotificationDependencies) {
  return async function notify(
    context: NotificationContext,
    input: NotificationInput,
    policy: NotificationPolicy,
  ): Promise<NotificationResult> {
    if (!policy.enabled) {
      return { ok: false, error: { code: 'DISABLED' } };
    }
    if (!context.userId || !context.conversationId || !context.toolCallId) {
      return { ok: false, error: { code: 'NOT_AUTHORIZED' } };
    }
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    if (
      !title ||
      !body ||
      title.length > policy.maxTitleLength ||
      body.length > policy.maxBodyLength
    ) {
      return { ok: false, error: { code: 'INVALID_INPUT' } };
    }
    if (!(await dependencies.authorize(context))) {
      return { ok: false, error: { code: 'NOT_AUTHORIZED' } };
    }
    return dependencies.enqueue(context, { title, body }, policy.maxPerMinute);
  };
}
