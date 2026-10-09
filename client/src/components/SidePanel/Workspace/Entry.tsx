import { Suspense, useRef } from 'react';
import { useAuthContext } from '~/hooks/AuthContext';
import { lazyWithRecovery } from '~/lib/assets/lazy';
import { useActivePanel } from '~/Providers';
import { useLocalize } from '~/hooks';

const Panel = lazyWithRecovery(() => import('./Panel'));

export default function WorkspaceEntry() {
  const { active } = useActivePanel();
  const { user, token } = useAuthContext();
  const localize = useLocalize();
  const opened = useRef(false);
  if (active === 'workspace') opened.current = true;
  if (!opened.current) return null;
  return (
    <Suspense
      fallback={
        <p role="status" className="px-3 py-2 text-sm">
          {localize('com_workspace_loading')}
        </p>
      }
    >
      <Panel active={active === 'workspace'} userId={user?.id} token={token} />
    </Suspense>
  );
}
