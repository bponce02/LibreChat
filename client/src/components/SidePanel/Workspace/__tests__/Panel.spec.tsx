import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { dataService } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { WorkspaceEnabledConfig, WorkspaceListing } from 'librechat-data-provider';
import '@testing-library/jest-dom/extend-expect';
import { WorkspaceContent } from '../Panel';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));

const config: WorkspaceEnabledConfig = {
  enabled: true,
  rootPath: '/home/user',
  maxTextBytes: 262144,
  maxUploadBytes: 5242880,
  maxFrameBytes: 16384,
  maxBufferedBytes: 1048576,
  maxColumns: 500,
  maxRows: 300,
  scrollback: 1000,
};
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, cacheTime: 0 }, mutations: { retry: false } },
    logger: { log: console.log, warn: console.warn, error: () => {} },
  });
});
afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});
function show() {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WorkspaceContent config={config} active userId="owner" token="test-token" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test('renders distinct loading and empty states without opening a shell', async () => {
  let finish: (value: WorkspaceListing) => void;
  jest.spyOn(dataService, 'listWorkspaceFiles').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const create = jest.spyOn(dataService, 'createWorkspaceTerminal');
  show();
  expect(screen.getByText('com_workspace_loading')).toBeVisible();
  await waitFor(() => expect(dataService.listWorkspaceFiles).toHaveBeenCalled());
  finish!({ directory: '/home/user', entries: [], truncated: false });
  expect(await screen.findByText('com_workspace_empty')).toBeVisible();
  expect(create).not.toHaveBeenCalled();
});

test('shows a safe error and supports explicit refresh', async () => {
  const list = jest
    .spyOn(dataService, 'listWorkspaceFiles')
    .mockRejectedValue(new Error('secret-provider-error'));
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('com_workspace_unavailable');
  expect(screen.queryByText('secret-provider-error')).not.toBeInTheDocument();
  list.mockResolvedValue({ directory: '/home/user', entries: [], truncated: false });
  fireEvent.click(screen.getByRole('button', { name: 'com_workspace_refresh' }));
  expect(await screen.findByText('com_workspace_empty')).toBeVisible();
});

test('edits plain text and sends the original version, preserving conflicts', async () => {
  jest.spyOn(dataService, 'listWorkspaceFiles').mockResolvedValue({
    directory: '/home/user',
    entries: [{ name: 'notes.txt', type: 'file', size: 20, writable: true }],
    truncated: false,
  });
  jest.spyOn(dataService, 'readWorkspaceFile').mockResolvedValue({
    path: '/home/user/notes.txt',
    content: '<script>plain text</script>',
    version: 'a'.repeat(64),
  });
  const save = jest
    .spyOn(dataService, 'writeWorkspaceFile')
    .mockRejectedValue({ response: { data: { error: { code: 'CONFLICT', message: 'secret' } } } });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'notes.txt' }));
  const editor = await screen.findByRole('textbox', { name: 'com_workspace_editor' });
  expect(editor).toHaveValue('<script>plain text</script>');
  expect(document.querySelector('script')).toBeNull();
  fireEvent.change(editor, { target: { value: 'My changes' } });
  fireEvent.click(screen.getByRole('button', { name: 'com_workspace_save' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      path: '/home/user/notes.txt',
      content: 'My changes',
      version: 'a'.repeat(64),
    }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('com_workspace_conflict');
  expect(editor).toHaveValue('My changes');
});
