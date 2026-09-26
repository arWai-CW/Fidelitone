// Master output gate: the single point between every engine/limiter path and
// AudioContext.destination. ADR-0004 gates it around a capture handover so the
// outgoing tab never plays with the incoming site's settings applied.

/** Fade length for a handover; short enough to read as one continuous stream. */
export const OUTPUT_GATE_MS = 25;

export interface GainParamLike {
  value: number;
  cancelScheduledValues(time: number): void;
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime(value: number, time: number): void;
}

export interface GateTarget {
  param: GainParamLike;
  currentTime: number;
}

/**
 * Schedules the gate ramp. Returns false when there is nothing audible to move
 * (no graph, or already at the requested level), so callers can skip waiting.
 */
export function scheduleGate(target: GateTarget | null, to: number, durationMs: number): boolean {
  if (!target) return false;
  const from = target.param.value;
  const now = target.currentTime;
  target.param.cancelScheduledValues(now);
  target.param.setValueAtTime(from, now);
  if (from === to) {
    target.param.setValueAtTime(to, now);
    return false;
  }
  target.param.linearRampToValueAtTime(to, now + Math.max(0, durationMs) / 1000);
  return true;
}

/** Resolves after `ms`, or immediately when `dispose` is called first. */
export function delayGate(ms: number, onDispose?: (dispose: () => void) => void): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(0, ms) + 15);
    onDispose?.(finish);
  });
}
