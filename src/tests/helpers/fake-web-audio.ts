import { vi } from "vitest";

/**
 * Minimal Web Audio doubles that record their outgoing edges.
 * Only files under src/tests ending in `.test.ts` are collected as tests, so
 * this helper stays out of the run and can be shared by several suites.
 */

export interface FakeNode {
  outputs: unknown[];
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

export function fakeNode(): FakeNode {
  const outputs: unknown[] = [];
  return {
    outputs,
    connect: vi.fn((target: unknown) => {
      outputs.push(target);
      return target;
    }),
    disconnect: vi.fn(() => outputs.splice(0, outputs.length)),
  };
}

export function fakeGain(): FakeNode & { gain: { value: number } } {
  return { ...fakeNode(), gain: { value: 0 } };
}

export function fakeContext() {
  return { destination: fakeNode(), createGain: fakeGain };
}

/**
 * Follows `connect()` edges from a node. Returns false when the chain dangles —
 * which is exactly what a graph that produces no sound looks like.
 */
export function reaches(from: unknown, target: unknown): boolean {
  const seen = new Set<unknown>();
  const queue: unknown[] = [from];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === target) return true;
    if (!node || seen.has(node)) continue;
    seen.add(node);
    queue.push(...((node as FakeNode).outputs ?? []));
  }
  return false;
}
