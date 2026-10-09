import { useRef, useState } from 'react';
import { Button, Input } from '@librechat/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataService, QueryKeys, MutationKeys } from 'librechat-data-provider';
import { ArrowUp, Download, FilePlus, FileText, Folder, RefreshCw, Upload } from 'lucide-react';
import type { WorkspaceFile, WorkspaceEnabledConfig } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { useWorkspaceConfig } from '~/data-provider/Workspace';
import PanelHeader from '~/components/ui/PanelHeader';
import WorkspaceTerminal from './Terminal';
import { useLocalize } from '~/hooks';

function errorCode(error: unknown): string {
  const response = error as { response?: { data?: { error?: { code?: string } } } };
  return response?.response?.data?.error?.code ?? 'WORKSPACE_UNAVAILABLE';
}
export function WorkspaceContent({
  config,
  active,
  token,
  userId,
}: {
  config: WorkspaceEnabledConfig;
  active: boolean;
  token?: string;
  userId?: string;
}) {
  const localize = useLocalize();
  const client = useQueryClient();
  const [directory, setDirectory] = useState(config.rootPath);
  const [navigation, setNavigation] = useState(config.rootPath);
  const [file, setFile] = useState<WorkspaceFile>();
  const [draft, setDraft] = useState('');
  const [newName, setNewName] = useState<string>();
  const [writable, setWritable] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [reading, setReading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const opening = useRef(false);
  const key = [QueryKeys.workspaceFiles, userId, directory];
  const listing = useQuery(key, () => dataService.listWorkspaceFiles(directory), {
    enabled: active,
    retry: false,
  });
  const save = useMutation(dataService.writeWorkspaceFile, {
    mutationKey: [MutationKeys.workspaceWrite, userId],
  });
  const upload = useMutation(dataService.uploadWorkspaceFile, {
    mutationKey: [MutationKeys.workspaceUpload, userId],
    onSuccess: () => client.invalidateQueries(key),
  });
  const dirty = file
    ? draft !== file.content
    : newName !== undefined && (draft.length > 0 || newName.length > 0);
  const discard = () => !dirty || window.confirm(localize('com_workspace_discard'));
  const changeDirectory = (path: string) => {
    if (!discard()) return;
    setFile(undefined);
    setNewName(undefined);
    setDraft('');
    setDirectory(path);
    setNavigation(path);
    setError(undefined);
    setNotice(undefined);
  };
  const openFile = async (path: string, canWrite: boolean) => {
    if (opening.current || !discard()) return;
    opening.current = true;
    setReading(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await dataService.readWorkspaceFile(path);
      setFile(result);
      setDraft(result.content);
      setNewName(undefined);
      setWritable(canWrite);
    } catch (failure) {
      setError(errorCode(failure));
    } finally {
      opening.current = false;
      setReading(false);
    }
  };
  const saveFile = async () => {
    setError(undefined);
    setNotice(undefined);
    setReading(true);
    const path = file?.path ?? `${directory}/${newName}`;
    try {
      await save.mutateAsync({ path, content: draft, version: file?.version ?? null });
      const result = await dataService.readWorkspaceFile(path);
      setFile(result);
      setDraft(result.content);
      setNewName(undefined);
      setNotice(localize('com_workspace_saved'));
      await client.invalidateQueries(key);
    } catch (failure) {
      setError(errorCode(failure));
    } finally {
      setReading(false);
    }
  };
  const download = async (path: string) => {
    setError(undefined);
    try {
      const blob = await dataService.downloadWorkspaceFile(path);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = path.split('/').pop() ?? 'download';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(errorCode(failure));
    }
  };
  const pick = async (selected: File | undefined) => {
    if (!selected) return;
    setError(undefined);
    setNotice(undefined);
    if (selected.size > config.maxUploadBytes) {
      setError('FILE_TOO_LARGE');
      return;
    }
    try {
      await upload.mutateAsync({ directory, file: selected });
      setNotice(localize('com_workspace_uploaded'));
    } catch (failure) {
      setError(errorCode(failure));
    }
  };
  const busy = reading || save.isLoading || upload.isLoading;
  const large = new TextEncoder().encode(draft).length > config.maxTextBytes;
  const errors: Partial<Record<string, TranslationKeys>> = {
    CONFLICT: 'com_workspace_conflict',
    FILE_TOO_LARGE: 'com_workspace_too_large',
    INVALID_PATH: 'com_workspace_invalid_path',
    UNSUPPORTED_FILE: 'com_workspace_binary',
  };
  const errorMessage = errors[error ?? ''] ?? 'com_workspace_unavailable';

  return (
    <section aria-label={localize('com_workspace_title')} className="flex h-full min-h-0 flex-col">
      <PanelHeader title={localize('com_workspace_title')}>
        <p className="text-text-secondary text-xs">{localize('com_workspace_shared')}</p>
        <form
          className="flex gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            changeDirectory(navigation);
          }}
        >
          <Input
            aria-label={localize('com_workspace_path')}
            value={navigation}
            onChange={(event) => setNavigation(event.target.value)}
            className="min-w-0 flex-1"
          />
          <Button size="sm" variant="outline" type="submit" disabled={busy}>
            {localize('com_workspace_go')}
          </Button>
        </form>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label={localize('com_workspace_parent')}
            disabled={directory === config.rootPath || busy}
            onClick={() =>
              changeDirectory(directory.slice(0, directory.lastIndexOf('/')) || config.rootPath)
            }
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={localize('com_workspace_refresh')}
            onClick={() => {
              void listing.refetch();
            }}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={busy}
            aria-label={localize('com_workspace_new_file')}
            onClick={() => {
              if (discard()) {
                setFile(undefined);
                setNewName('');
                setDraft('');
                setWritable(true);
                setError(undefined);
              }
            }}
          >
            <FilePlus className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={busy}
            aria-label={localize('com_workspace_upload')}
            onClick={() => picker.current?.click()}
          >
            <Upload className="h-4 w-4" />
          </Button>
          <input
            ref={picker}
            type="file"
            className="hidden"
            aria-label={localize('com_workspace_upload')}
            onChange={(event) => {
              const selected = event.target.files?.[0];
              event.target.value = '';
              void pick(selected);
            }}
          />
        </div>
      </PanelHeader>
      {error && (
        <p role="alert" className="text-text-primary px-3 py-1 text-xs">
          {localize(errorMessage)}
        </p>
      )}
      {notice && (
        <p role="status" className="text-text-secondary px-3 py-1 text-xs">
          {notice}
        </p>
      )}
      <div
        className="border-border-light max-h-52 min-h-16 shrink-0 overflow-y-auto border-t px-2 py-1"
        aria-label={localize('com_workspace_files')}
      >
        {listing.isLoading && (
          <p role="status" className="px-1 py-2 text-xs">
            {localize('com_workspace_loading')}
          </p>
        )}
        {listing.isError && (
          <p role="alert" className="px-1 py-2 text-xs">
            {localize('com_workspace_unavailable')}
          </p>
        )}
        {!listing.isLoading && !listing.isError && (
          <>
            {!listing.data?.entries.length && (
              <p className="text-text-secondary px-1 py-2 text-xs">
                {localize('com_workspace_empty')}
              </p>
            )}
            <ul>
              {listing.data?.entries.map((entry) => (
                <li key={entry.name} className="flex items-center gap-1">
                  <button
                    disabled={busy}
                    className="hover:bg-surface-hover flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-xs"
                    onClick={() => {
                      const path = `${directory}/${entry.name}`;
                      if (entry.type === 'directory') changeDirectory(path);
                      else void openFile(path, entry.writable);
                    }}
                  >
                    {entry.type === 'directory' ? (
                      <Folder className="h-4 w-4 shrink-0" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0" />
                    )}
                    <span className="truncate">{entry.name}</span>
                  </button>
                  {entry.type === 'file' && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`${localize('com_workspace_download')} ${entry.name}`}
                      onClick={() => {
                        void download(`${directory}/${entry.name}`);
                      }}
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {listing.data?.truncated && (
              <p className="text-text-secondary px-1 text-xs">
                {localize('com_workspace_truncated')}
              </p>
            )}
          </>
        )}
      </div>
      {(file || newName !== undefined) && (
        <div className="border-border-light flex shrink-0 flex-col gap-2 border-t px-3 py-2">
          {newName !== undefined ? (
            <Input
              aria-label={localize('com_workspace_filename')}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={localize('com_workspace_filename')}
            />
          ) : (
            <p className="truncate text-xs" title={file?.path}>
              {file?.path.split('/').pop()}
            </p>
          )}
          <textarea
            aria-label={localize('com_workspace_editor')}
            spellCheck={false}
            readOnly={!writable || busy}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="border-border-medium bg-surface-primary text-text-primary h-36 w-full resize-y rounded border p-2 font-mono text-xs"
            wrap="off"
          />
          <div className="flex justify-between gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy || !writable || large || (!dirty && !!file) || (!file && !newName?.trim())
              }
              onClick={() => {
                void saveFile();
              }}
            >
              {localize('com_workspace_save')}
            </Button>
            {file && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void openFile(file.path, writable);
                }}
              >
                {localize('com_workspace_reload')}
              </Button>
            )}
          </div>
          {large && (
            <p role="alert" className="text-xs">
              {localize('com_workspace_too_large')}
            </p>
          )}
        </div>
      )}
      <WorkspaceTerminal directory={directory} config={config} userId={userId} token={token} />
    </section>
  );
}

export default function WorkspacePanel({
  active,
  token,
  userId,
}: {
  active: boolean;
  token?: string;
  userId?: string;
}) {
  const { data: config } = useWorkspaceConfig();
  return config?.enabled ? (
    <WorkspaceContent key={userId} config={config} active={active} userId={userId} token={token} />
  ) : null;
}
