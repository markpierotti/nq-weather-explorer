/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Runs the rain-motion estimate off the main thread (a few hundred ms of number crunching on a phone). */
import { motionFromRgba, type MotionRequest, type MotionResult } from './radarMotion';

self.onmessage = (e: MessageEvent<MotionRequest>) => {
  let result: MotionResult;
  try {
    result = motionFromRgba(e.data);
  } catch (err) {
    result = { ok: false, reason: err instanceof Error ? err.message : 'motion estimate failed', ms: 0 };
  }
  const transfer = result.ok ? [result.field.u.buffer, result.field.v.buffer] : [];
  self.postMessage(result, { transfer });
};
