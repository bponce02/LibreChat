import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { Button } from '@librechat/client';
import { FitAddon } from '@xterm/addon-fit';
import { useMutation } from '@tanstack/react-query';
import { dataService, workspaceSocket, MutationKeys } from 'librechat-data-provider';
import type { WorkspaceEnabledConfig } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

const messages = {
  connected: 'com_workspace_connected',
  connecting: 'com_workspace_connecting',
  error: 'com_workspace_unavailable',
  disconnected: 'com_workspace_disconnected',
  idle: 'com_workspace_terminal_hint',
} as const;

export default function WorkspaceTerminal({
  directory,
  config,
  token,
  userId,
}: {
  directory: string;
  config: WorkspaceEnabledConfig;
  token?: string;
  userId?: string;
}) {
  const localize = useLocalize();
  const host = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket>();
  const terminal = useRef<Terminal>();
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const labelRef = useRef(localize('com_workspace_terminal_input'));
  labelRef.current = localize('com_workspace_terminal_input');
  useEffect(() => {
    terminal.current?.textarea?.setAttribute('aria-label', labelRef.current);
  }, [localize]);
  const [id, setId] = useState<string>();
  const [status, setStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
  >('idle');
  const create = useMutation(dataService.createWorkspaceTerminal, {
    mutationKey: [MutationKeys.workspaceTerminal, userId],
  });

  useEffect(() => {
    if (socket.current?.readyState === WebSocket.OPEN && token)
      socket.current.send(JSON.stringify({ type: 'reauth', token }));
  }, [token]);

  useEffect(() => {
    if (!id || !host.current) return;
    const element = host.current;
    const style = getComputedStyle(element);
    const term = new Terminal({
      scrollback: config.scrollback,
      fontSize: Number.parseFloat(style.fontSize),
      fontFamily: style.fontFamily,
      screenReaderMode: true,
      theme: { background: style.backgroundColor, foreground: style.color, cursor: style.color },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    terminal.current = term;
    term.textarea?.setAttribute('aria-label', labelRef.current);
    const url = new URL(workspaceSocket(), location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    socket.current = ws;
    let disposed = false;
    let pendingBytes = 0;
    const resize = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      fit.fit();
      const cols = Math.min(config.maxColumns, Math.max(2, term.cols));
      const rows = Math.min(config.maxRows, Math.max(2, term.rows));
      if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows);
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    };
    ws.onopen = () =>
      ws.send(JSON.stringify({ type: 'auth', token: tokenRef.current, sessionId: id }));
    ws.onmessage = (event) => {
      if (disposed || ws.readyState !== WebSocket.OPEN) return;
      if (event.data instanceof ArrayBuffer) {
        pendingBytes += event.data.byteLength;
        if (pendingBytes > config.maxBufferedBytes) {
          ws.close(3008, 'Output limit');
          return;
        }
        const data = new Uint8Array(event.data);
        term.write(data, () => {
          pendingBytes -= data.byteLength;
        });
      } else {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string };
          if (message.type === 'ready') {
            setStatus('connected');
            resize();
            term.focus();
          }
        } catch {
          setStatus('error');
          ws.close();
        }
      }
    };
    ws.onerror = () => {
      if (!disposed) setStatus('error');
    };
    ws.onclose = (event) => {
      if (!disposed) setStatus(event.code === 1000 ? 'disconnected' : 'error');
    };
    const input = term.onData((data) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const bytes = new TextEncoder().encode(data);
      for (let start = 0; start < bytes.length; start += config.maxFrameBytes) {
        const chunk = bytes.slice(start, start + config.maxFrameBytes);
        if (ws.bufferedAmount + chunk.length > config.maxBufferedBytes) {
          ws.close(3008, 'Input limit');
          return;
        }
        ws.send(chunk);
      }
    });
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const theme = new MutationObserver(() => {
      const next = getComputedStyle(element);
      term.options.theme = {
        background: next.backgroundColor,
        foreground: next.color,
        cursor: next.color,
      };
    });
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
    return () => {
      disposed = true;
      observer.disconnect();
      theme.disconnect();
      input.dispose();
      ws.close();
      term.dispose();
      socket.current = undefined;
      void dataService.closeWorkspaceTerminal(id).catch(() => {});
    };
  }, [
    id,
    config.maxColumns,
    config.maxRows,
    config.maxFrameBytes,
    config.maxBufferedBytes,
    config.scrollback,
  ]);

  const open = async () => {
    setStatus('connecting');
    try {
      const session = await create.mutateAsync(directory);
      setId(session.id);
    } catch {
      setStatus('error');
    }
  };
  const close = () => {
    setId(undefined);
    setStatus('idle');
  };

  return (
    <section
      aria-label={localize('com_workspace_terminal')}
      className="border-border-light flex min-h-64 flex-1 flex-col border-t p-2"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{localize('com_workspace_terminal')}</h3>
        {id && status === 'connected' ? (
          <Button size="sm" variant="outline" onClick={close}>
            {localize('com_workspace_close_terminal')}
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={status === 'connecting'} onClick={open}>
            {localize('com_workspace_open_terminal')}
          </Button>
        )}
      </div>
      <p role="status" className="text-text-secondary mb-1 text-xs">
        {localize(messages[status])}
      </p>
      <div
        ref={host}
        data-testid="workspace-terminal"
        className="bg-surface-primary text-text-primary [&_.xterm.focus]:ring-border-medium [&_.composition-view]:bg-surface-primary [&_.composition-view]:text-text-primary relative min-h-48 flex-1 overflow-hidden font-mono text-xs [&_.composition-view]:absolute [&_.composition-view]:hidden [&_.composition-view]:whitespace-nowrap [&_.composition-view.active]:block [&_.live-region]:sr-only [&_.xterm]:relative [&_.xterm]:cursor-text [&_.xterm]:outline-none [&_.xterm]:select-none [&_.xterm-accessibility]:pointer-events-none [&_.xterm-accessibility]:absolute [&_.xterm-accessibility]:inset-0 [&_.xterm-accessibility]:z-10 [&_.xterm-accessibility]:text-transparent [&_.xterm-accessibility-tree]:whitespace-pre [&_.xterm-char-measure-element]:invisible [&_.xterm-char-measure-element]:absolute [&_.xterm-char-measure-element]:-left-[9999em] [&_.xterm-helper-textarea]:absolute [&_.xterm-helper-textarea]:top-0 [&_.xterm-helper-textarea]:-left-[9999em] [&_.xterm-helper-textarea]:h-0 [&_.xterm-helper-textarea]:w-0 [&_.xterm-helper-textarea]:resize-none [&_.xterm-helper-textarea]:overflow-hidden [&_.xterm-helper-textarea]:border-0 [&_.xterm-helper-textarea]:p-0 [&_.xterm-helper-textarea]:opacity-0 [&_.xterm-helpers]:absolute [&_.xterm-helpers]:top-0 [&_.xterm-helpers]:z-10 [&_.xterm-screen]:relative [&_.xterm-screen_canvas]:absolute [&_.xterm-screen_canvas]:top-0 [&_.xterm-screen_canvas]:left-0 [&_.xterm-scroll-area]:invisible [&_.xterm-viewport]:absolute [&_.xterm-viewport]:inset-0 [&_.xterm-viewport]:cursor-default [&_.xterm-viewport]:overflow-y-scroll [&_.xterm.focus]:ring-1"
      />
    </section>
  );
}
