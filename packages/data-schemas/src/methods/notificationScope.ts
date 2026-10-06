import { getTenantId, SYSTEM_TENANT_ID } from '~/config/tenantContext';

export function notificationOwnerScope(
  userId: string,
  tenantId: string | undefined = getTenantId(),
): { userId: string; tenantId: string | null } {
  if (!userId || tenantId === SYSTEM_TENANT_ID || tenantId !== getTenantId()) {
    throw new Error('Notification operations require an owning user and tenant context');
  }
  return { userId, tenantId: tenantId ?? null };
}
