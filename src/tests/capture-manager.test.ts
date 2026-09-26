import { describe, expect, it, vi, beforeEach } from "vitest";
import { CaptureManager } from "../offscreen/capture-manager";
import type { AudioGraph } from "../offscreen/audio-graph";
import type { AccompanimentGraph } from "../offscreen/accompaniment";

function fakeGraph(): AudioGraph {
  return {
    ready: true,
    ensureReady: vi.fn().mockResolvedValue(undefined),
    createMediaStreamSource: vi.fn().mockReturnValue({ disconnect: vi.fn() }),
    disconnectNode: vi.fn(),
  } as unknown as AudioGraph;
}

function fakeAccompaniment(overrides: Partial<AccompanimentGraph> = {}): AccompanimentGraph {
  return {
    enabled: false,
    ready: false,
    ensureEnabled: vi.fn().mockResolvedValue(true),
    deactivate: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  } as unknown as AccompanimentGraph;
}

describe("CaptureManager", () => {
  let graph: AudioGraph;
  let accomp: AccompanimentGraph;
  const callbacks = {
    ensureGraphReady: vi.fn().mockResolvedValue(undefined),
    connectSource: vi.fn().mockReturnValue(true),
    applyCurrentPitch: vi.fn(),
    teardownGraph: vi.fn().mockResolvedValue(undefined),
    emitCaptureEvent: vi.fn(),
  };

  beforeEach(() => {
    graph = fakeGraph();
    accomp = fakeAccompaniment();
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "navigator", {
      value: { mediaDevices: { getUserMedia: vi.fn() } },
      writable: true,
      configurable: true,
    });
  });

  it("starts capture, connects source and applies pitch", async () => {
    const stream = { getTracks: () => [{ addEventListener: vi.fn(), stop: vi.fn() }] } as unknown as MediaStream;
    navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(stream);

    const manager = new CaptureManager(graph, accomp, callbacks);
    await manager.start("stream-id", 0, false);

    expect(callbacks.connectSource).toHaveBeenCalled();
    expect(callbacks.applyCurrentPitch).toHaveBeenCalled();
    expect(manager.connected).toBe(true);
  });

  it("deactivates accompaniment when capture starts in accompaniment mode and init fails", async () => {
    accomp.ensureEnabled = vi.fn().mockResolvedValue(false);
    const stream = { getTracks: () => [{ addEventListener: vi.fn(), stop: vi.fn() }] } as unknown as MediaStream;
    navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(stream);

    const manager = new CaptureManager(graph, accomp, callbacks);
    (accomp as unknown as { enabled: boolean }).enabled = true;
    await expect(manager.start("stream-id", 0, false)).rejects.toThrow();
    expect(accomp.deactivate).toHaveBeenCalled();
  });

  it("stop clears source, stream and pending connect", () => {
    const manager = new CaptureManager(graph, accomp, callbacks);
    manager.stop();
    expect(manager.connected).toBe(false);
    expect(manager.pendingConnect).toBe(false);
  });

  it("handleCaptureEnded marks capture lost and returns true for the active stream", () => {
    const manager = new CaptureManager(graph, accomp, callbacks);
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const src = graph.createMediaStreamSource(stream);
    (manager as unknown as { _source: typeof src })._source = src;
    (manager as unknown as { activeStream: typeof stream }).activeStream = stream;
    const result = manager.handleCaptureEnded(stream);
    expect(result).toBe(true);
    expect(manager.captureLost).toBe(true);
  });

  it("handleCaptureEnded returns false for a different stream", () => {
    const manager = new CaptureManager(graph, accomp, callbacks);
    const result = manager.handleCaptureEnded({} as MediaStream);
    expect(result).toBe(false);
  });

  it("reports capture identity and liveness through events", async () => {
    const stream = { getTracks: () => [{ addEventListener: vi.fn(), stop: vi.fn() }] } as unknown as MediaStream;
    navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(stream);

    const manager = new CaptureManager(graph, accomp, callbacks);
    await manager.start("stream-id", 0, false, {
      tabId: 9,
      page: "https://www.youtube.com",
    });

    expect(manager.tabId).toBe(9);
    expect(manager.page).toBe("https://www.youtube.com");
    expect(callbacks.emitCaptureEvent).toHaveBeenLastCalledWith({
      connected: true,
      captureLost: false,
      tabId: 9,
      page: "https://www.youtube.com",
    });

    manager.handleCaptureEnded(stream);
    expect(callbacks.emitCaptureEvent).toHaveBeenLastCalledWith({
      connected: false,
      captureLost: true,
      tabId: 9,
      page: "https://www.youtube.com",
    });

    manager.stop();
    expect(callbacks.emitCaptureEvent).toHaveBeenLastCalledWith({
      connected: false,
      captureLost: false,
      tabId: null,
      page: null,
    });
  });

  it("restores the previous target when a handover fails", async () => {
    const stream = { getTracks: () => [{ addEventListener: vi.fn(), stop: vi.fn() }] } as unknown as MediaStream;
    navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(stream);

    const manager = new CaptureManager(graph, accomp, callbacks);
    await manager.start("stream-id", 0, false, { tabId: 1, page: "https://a.com" });

    graph.createMediaStreamSource = vi.fn(() => {
      throw new Error("graph rejected the stream");
    }) as unknown as AudioGraph["createMediaStreamSource"];
    navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ addEventListener: vi.fn(), stop: vi.fn() }],
    } as unknown as MediaStream);

    await expect(
      manager.start("stream-id-2", 0, false, { tabId: 2, page: "https://b.com" }),
    ).rejects.toThrow("graph rejected the stream");

    expect(manager.connected).toBe(true);
    expect(manager.tabId).toBe(1);
    expect(manager.page).toBe("https://a.com");
  });
});
