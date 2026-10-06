import { Button } from '@librechat/client';
import { useDevicePush } from '~/data-provider/Notifications';
import { useLocalize } from '~/hooks';

export default function PushControls() {
  const localize = useLocalize();
  const { config, supported, state, change, toggle } = useDevicePush(
    localize('com_ui_push_this_device'),
  );
  if (!config?.push) return null;
  if (!supported)
    return (
      <p className="text-text-secondary px-3 pb-3 text-xs">{localize('com_ui_push_unsupported')}</p>
    );
  const enabled = state.data === true;
  const denied = change.error instanceof Error && change.error.message === 'PERMISSION_DENIED';
  return (
    <div className="space-y-2 px-3 pb-3">
      <Button
        variant="outline"
        size="sm"
        disabled={
          state.isLoading || state.isError || change.isLoading || (!enabled && !config.push.enabled)
        }
        onClick={() => toggle(!enabled)}
      >
        {localize(enabled ? 'com_ui_push_disable' : 'com_ui_push_enable')}
      </Button>
      <p className="text-text-secondary text-xs" role="status">
        {localize(config.push.enabled ? 'com_ui_push_hint' : 'com_ui_push_unconfigured')}
      </p>
      {(state.isError || change.isError) && (
        <div role="alert" className="text-text-primary space-y-1 text-xs">
          <p>{localize(denied ? 'com_ui_push_permission' : 'com_ui_push_error')}</p>
          {state.isError && (
            <Button size="sm" variant="ghost" onClick={() => void state.refetch()}>
              {localize('com_ui_retry')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
