/**
 * Gemini briefing routes: corridor briefing, cyclone synthesis, follow-up chat (Phase 5).
 * The existing /api/briefing/corridor and /api/briefing/cyclone handlers still live in server.ts
 * until they are moved here.
 */
import type { Express } from 'express';

export function registerBriefingRoutes(_app: Express): void {
  // /api/briefing/chat and structured briefing output — implemented in Phase 5.
}
