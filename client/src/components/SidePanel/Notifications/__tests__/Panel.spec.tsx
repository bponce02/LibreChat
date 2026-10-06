import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { dataService, notificationsConfigSchema } from 'librechat-data-provider';
import '@testing-library/jest-dom/extend-expect';
import NotificationPanel from '../Panel';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ user: { id: 'owner', tenantId: 'tenant' } }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useScrollFade: jest.requireActual('~/hooks/useScrollFade').default,
}));

const notification = {
  id: 'a'.repeat(64),
  title: 'Backup complete',
  body: '<script>alert(1)</script>',
  conversationId: 'chat',
  createdAt: '2026-01-01T00:00:00Z',
  readAt: null,
};
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, cacheTime: 0 }, mutations: { retry: false } },
    logger: { log: console.log, warn: console.warn, error: () => {} },
  });
  jest
    .spyOn(dataService, 'getNotificationConfig')
    .mockResolvedValue(notificationsConfigSchema.parse({ enabled: true }));
});
afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});
function showPanel() {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test('loading and empty states are distinct', async () => {
  let finish: (value: { notifications: []; unreadCount: number }) => void;
  jest.spyOn(dataService, 'listNotifications').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  showPanel();
  expect(screen.getAllByText('com_ui_loading').length).toBeGreaterThan(0);
  await waitFor(() => expect(dataService.listNotifications).toHaveBeenCalled());
  finish!({ notifications: [], unreadCount: 0 });
  expect(await screen.findByText('com_ui_notifications_empty')).toBeVisible();
});

test('renders plain text, a safe conversation link, and persists read state', async () => {
  const list = jest
    .spyOn(dataService, 'listNotifications')
    .mockResolvedValue({ notifications: [notification], unreadCount: 1 });
  const read = jest.spyOn(dataService, 'readNotification').mockResolvedValue({ ok: true });
  showPanel();
  expect(await screen.findByRole('heading', { name: /Backup complete/ })).toBeVisible();
  expect(screen.getByText(notification.body)).toBeVisible();
  expect(document.querySelector('script')).toBeNull();
  expect(screen.getByRole('link', { name: 'com_ui_notifications_open_chat' })).toHaveAttribute(
    'href',
    '/c/chat',
  );
  list.mockResolvedValue({
    notifications: [{ ...notification, readAt: '2026-01-01T01:00:00Z' }],
    unreadCount: 0,
  });
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_notifications_mark_read' }));
  await waitFor(() => expect(read).toHaveBeenCalledWith(notification.id));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'com_ui_notifications_mark_read' }),
    ).not.toBeInTheDocument(),
  );
});

test('failed reads remain unread and show safe localized feedback', async () => {
  jest
    .spyOn(dataService, 'listNotifications')
    .mockResolvedValue({ notifications: [notification], unreadCount: 1 });
  jest
    .spyOn(dataService, 'readNotification')
    .mockRejectedValue(new Error('private server details'));
  showPanel();
  fireEvent.click(await screen.findByRole('button', { name: 'com_ui_notifications_mark_read' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('com_ui_notifications_read_error');
  expect(screen.getByRole('button', { name: 'com_ui_notifications_mark_read' })).toBeEnabled();
  expect(screen.queryByText('private server details')).not.toBeInTheDocument();
});

test('failed fetches are not empty inboxes and can be retried', async () => {
  const list = jest
    .spyOn(dataService, 'listNotifications')
    .mockRejectedValue(new Error('unavailable'));
  showPanel();
  expect(await screen.findByRole('alert')).toHaveTextContent('com_ui_notifications_load_error');
  expect(screen.queryByText('com_ui_notifications_empty')).not.toBeInTheDocument();
  list.mockResolvedValue({ notifications: [], unreadCount: 0 });
  fireEvent.click(screen.getByRole('button', { name: 'com_ui_retry' }));
  expect(await screen.findByText('com_ui_notifications_empty')).toBeVisible();
});
