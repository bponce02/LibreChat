import { useId } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@librechat/client';
import { useNotifications, useReadNotification } from '~/data-provider/Notifications';
import { PanelContent, PanelHeader } from '~/components/ui';
import { useLocalize } from '~/hooks';

export default function NotificationPanel() {
  const localize = useLocalize();
  const headingId = useId();
  const notifications = useNotifications();
  const markRead = useReadNotification();
  return (
    <section aria-labelledby={headingId} className="flex h-full min-h-0 flex-col">
      <PanelHeader title={localize('com_ui_notifications')} titleId={headingId}>
        {notifications.data && (
          <p className="text-text-secondary text-xs" aria-live="polite">
            {localize('com_ui_notifications_unread', { count: notifications.data.unreadCount })}
          </p>
        )}
      </PanelHeader>
      {notifications.isError && (
        <div role="alert" className="text-text-primary space-y-2 px-3 py-2 text-sm">
          <p>{localize('com_ui_notifications_load_error')}</p>
          <Button variant="outline" onClick={() => void notifications.refetch()}>
            {localize('com_ui_retry')}
          </Button>
        </div>
      )}
      {markRead.isError && (
        <p role="alert" className="text-text-primary px-3 py-2 text-sm">
          {localize('com_ui_notifications_read_error')}
        </p>
      )}
      <PanelContent
        isLoading={notifications.isLoading}
        isEmpty={!notifications.isError && notifications.data?.notifications.length === 0}
        skeleton={
          <p className="text-text-secondary px-3 py-4 text-sm">{localize('com_ui_loading')}</p>
        }
        empty={
          <p className="text-text-secondary px-3 py-4 text-sm">
            {localize('com_ui_notifications_empty')}
          </p>
        }
      >
        <ul className="space-y-2 px-3 pb-4">
          {notifications.data?.notifications.map((notification) => (
            <li
              key={notification.id}
              className="border-border-light space-y-2 rounded-lg border p-3"
            >
              <h3 className="text-text-primary text-sm font-semibold break-words">
                {notification.title}
                {!notification.readAt && (
                  <span className="sr-only"> — {localize('com_ui_notifications_new')}</span>
                )}
              </h3>
              <p className="text-text-secondary text-sm break-words whitespace-pre-wrap">
                {notification.body}
              </p>
              <time dateTime={notification.createdAt} className="text-text-secondary block text-xs">
                {new Date(notification.createdAt).toLocaleString()}
              </time>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  className="text-text-primary rounded text-sm underline focus-visible:outline focus-visible:outline-2"
                  to={`/c/${encodeURIComponent(notification.conversationId)}`}
                >
                  {localize('com_ui_notifications_open_chat')}
                </Link>
                {!notification.readAt && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={markRead.isLoading}
                    onClick={() => markRead.mutate(notification.id)}
                  >
                    {localize('com_ui_notifications_mark_read')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </PanelContent>
    </section>
  );
}
