import type { NotificationPolicy, TPlugin } from 'librechat-data-provider';

import type { ExtendedJsonSchema } from '~/tools/registry/schema';

type NotificationDefinition = { name: string; description: string; parameters: ExtendedJsonSchema };

export const notificationDefinition: NotificationDefinition = {
  name: 'notify_user',
  description:
    'Queue a notification in the current user’s LibreChat inbox, linked to this conversation. Do not include secrets. Queued does not mean delivered to a device.',
  parameters: {
    type: 'object' as const,
    properties: {
      title: { type: 'string' as const, description: 'Short notification title.' },
      body: { type: 'string' as const, description: 'Notification message.' },
    },
    required: ['title', 'body'],
    additionalProperties: false,
  },
};

export function getNotificationCatalogTools(
  included: string[],
  filtered: string[],
): Array<{ type: 'function'; function: NotificationDefinition }> {
  if (included.length > 0 ? !included.includes('notify_user') : filtered.includes('notify_user'))
    return [];
  return [{ type: 'function' as const, function: notificationDefinition }];
}

export function filterNotificationPlugins(
  plugins: TPlugin[],
  config?: Partial<NotificationPolicy>,
): TPlugin[] {
  return config?.enabled === true
    ? plugins
    : plugins.filter((plugin) => plugin.pluginKey !== 'notify_user');
}
