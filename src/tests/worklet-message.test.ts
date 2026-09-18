import { describe, expect, it, vi } from "vitest";
import {
  postWorkletMessage,
  type WorkletNodeLike,
  type WorkletPortLike,
} from "../lib/dsp/worklet-message";

class FakeWorkletPort implements WorkletPortLike {
  readonly messages: unknown[] = [];
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  constructor(
    private readonly ackDelayMs = 0,
    private readonly acknowledge = true,
  ) {}

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent) => void,
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: "message",
    listener: (event: MessageEvent) => void,
  ): void {
    this.listeners.delete(listener);
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
    if (!this.acknowledge) return;
    const messageType =
      typeof message === "object" && message && "type" in message
        ? String((message as { type: unknown }).type)
        : "INIT";
    const ack = { type: `${messageType}_OK` };
    if (this.ackDelayMs === 0) {
      this.emit(ack);
      return;
    }
    setTimeout(() => this.emit(ack), this.ackDelayMs);
  }

  private emit(data: unknown): void {
    const event = { data } as MessageEvent;
    for (const listener of this.listeners) listener(event);
  }
}

function nodeWith(port: FakeWorkletPort): WorkletNodeLike {
  return { port } as unknown as WorkletNodeLike;
}

describe("worklet message handshake", () => {
  it("accepts an ACK that arrives after the first timeout and is retried", async () => {
    const port = new FakeWorkletPort(15);

    await expect(
      postWorkletMessage(
        nodeWith(port),
        { type: "INIT" },
        "INIT_OK",
        {
          label: "crossover",
          retryDelayMs: 5,
          retries: 2,
          timeoutMs: 5,
        },
      ),
    ).resolves.toBeUndefined();

    expect(port.messages).toHaveLength(2);
    expect(port.messages[0]).toEqual({ type: "INIT" });
    expect(port.messages[1]).toEqual({ type: "INIT" });
  });

  it("reports the worklet label after all retries are exhausted", async () => {
    const port = new FakeWorkletPort(0, false);

    await expect(
      postWorkletMessage(
        nodeWith(port),
        { type: "INIT" },
        "INIT_OK",
        {
          label: "lowband-resampler",
          retryDelayMs: 1,
          retries: 1,
          timeoutMs: 5,
        },
      ),
    ).rejects.toThrow(
      "Timed out waiting for INIT_OK from lowband-resampler after 5ms",
    );
    expect(port.messages).toHaveLength(2);
  });

  it("does not retry when the worklet ACKs immediately", async () => {
    const port = new FakeWorkletPort();

    await postWorkletMessage(
      nodeWith(port),
      { type: "RESET" },
      "RESET_OK",
      { label: "rubberband", timeoutMs: 20 },
    );

    expect(port.messages).toEqual([{ type: "RESET" }]);
  });

  it("cleans up its listener when posting throws", async () => {
    const port = new FakeWorkletPort();
    const postMessage = vi.spyOn(port, "postMessage").mockImplementation(() => {
      throw new Error("port closed");
    });

    await expect(
      postWorkletMessage(
        nodeWith(port),
        { type: "INIT" },
        "INIT_OK",
        { label: "crossover", timeoutMs: 20 },
      ),
    ).rejects.toThrow("port closed");
    expect(postMessage).toHaveBeenCalledOnce();
  });
});
