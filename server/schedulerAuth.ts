/**
 * Shared-secret check for endpoints an external scheduler calls (Cloud Scheduler on Cloud Run, where in-process
 * timers don't run while the service is idle). Accepts "Authorization: Bearer <token>" or "X-Scheduler-Token".
 * Disabled (always false) unless SCHEDULER_TOKEN is at least 16 characters.
 */
import crypto from 'node:crypto';
import type { Request } from 'express';

export function schedulerTokenOk(req: Request): boolean {
  const token = (process.env.SCHEDULER_TOKEN || '').trim();
  if (token.length < 16) return false;
  const auth = req.get('authorization') || '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : req.get('x-scheduler-token') || '';
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** In-process timers on by default; set <NAME>=off where an external scheduler drives the work instead. */
export function inProcessSchedulerEnabled(envName: string): boolean {
  return (process.env[envName] || '').trim().toLowerCase() !== 'off';
}
