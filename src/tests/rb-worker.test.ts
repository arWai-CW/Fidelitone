import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for rb-worker message protocol (INIT → PROCESS → DELETE).
 *
 * We don't import the worker source directly (it runs in a Worker context).
 * Instead, we simulate the message protocol and mock the WASM exports.
 */

interface WorkerState {
  pitchScale: number;
  blockSize: number;
  initialized: boolean;
}

function createMockWorker(): {
  postMessage: ReturnType<typeof vi.fn>;
  state: WorkerState;
  handleMsg: (msg: Record<string, unknown>) => void;
} {
  const state: WorkerState = {
    pitchScale: 1.0,
    blockSize: 1024,
    initialized: false,
  };

  const postMessage = vi.fn();

  function handleMsg(msg: Record<string, unknown>) {
    switch (msg.type) {
      case "INIT": {
        state.pitchScale = msg.pitchScale as number;
        state.blockSize = 1024; // mock getBlockSize()
        state.initialized = true;
        postMessage({
          type: "INIT_OK",
          blockSize: state.blockSize,
          startDelay: 0,
          channels: msg.channels,
          sampleRate: msg.sampleRate,
        });
        break;
      }
      case "PROCESS": {
        if (!state.initialized) {
          postMessage({ type: "PROCESS_ERROR", error: "Not initialized" });
          return;
        }
        const input = msg.input as Float32Array;
        // Mock: return same-length buffer (identity shift)
        const output = new Float32Array(input.length);
        output.set(input);
        postMessage({ type: "PROCESS_OK", output });
        break;
      }
      case "SET_PITCH": {
        state.pitchScale = msg.pitchScale as number;
        break;
      }
      case "DELETE": {
        state.initialized = false;
        break;
      }
    }
  }

  return { postMessage, state, handleMsg };
}

describe("rb-worker protocol", () => {
  it("INIT returns INIT_OK with blockSize", () => {
    const worker = createMockWorker();
    worker.handleMsg({
      type: "INIT",
      sampleRate: 48000,
      channels: 2,
      pitchScale: 1.5,
    });

    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "INIT_OK",
        blockSize: 1024,
        channels: 2,
        sampleRate: 48000,
      }),
    );
    expect(worker.state.pitchScale).toBe(1.5);
    expect(worker.state.initialized).toBe(true);
  });

  it("PROCESS returns same-length buffer after INIT", () => {
    const worker = createMockWorker();
    worker.handleMsg({
      type: "INIT",
      sampleRate: 48000,
      channels: 1,
      pitchScale: 1.0,
    });

    const input = new Float32Array([0.1, 0.2, 0.3]);
    worker.handleMsg({ type: "PROCESS", input });

    const call = worker.postMessage.mock.calls.find(
      (c: any[]) => c[0]?.type === "PROCESS_OK",
    );
    expect(call).toBeDefined();

    const output = call![0].output as Float32Array;
    expect(output.length).toBe(input.length);
  });

  it("PROCESS errors when not initialized", () => {
    const worker = createMockWorker();
    worker.handleMsg({ type: "PROCESS", input: new Float32Array([1]) });

    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "PROCESS_ERROR" }),
    );
  });

  it("SET_PITCH updates pitch scale", () => {
    const worker = createMockWorker();
    worker.handleMsg({
      type: "INIT",
      sampleRate: 48000,
      channels: 1,
      pitchScale: 1.0,
    });

    worker.handleMsg({ type: "SET_PITCH", pitchScale: 2.0 });
    expect(worker.state.pitchScale).toBe(2.0);
  });

  it("DELETE resets state", () => {
    const worker = createMockWorker();
    worker.handleMsg({
      type: "INIT",
      sampleRate: 48000,
      channels: 1,
      pitchScale: 1.0,
    });

    worker.handleMsg({ type: "DELETE" });
    expect(worker.state.initialized).toBe(false);
  });
});
