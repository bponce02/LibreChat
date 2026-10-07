import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { PiSyncError } from './service';

export function authorizePiPublisher(
  req: Request,
  key: string | undefined,
  standalone: boolean,
): void {
  if (!standalone || !key || key.length < 32) throw new PiSyncError(503, 'PI_SYNC_DISABLED');
  const actual = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${key}`);
  if (req.headers.origin || actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new PiSyncError(401, 'NOT_AUTHORIZED');
}
