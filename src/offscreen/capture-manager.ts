import type { AudioGraph } from "./audio-graph";
import type { AccompanimentGraph } from "./accompaniment";
import type { CaptureEvent, CaptureTarget } from "./offscreen-state";

export interface CaptureCallbacks {
  ensureGraphReady(semitones: number, preserveFormants: boolean): Promise<void>;
  connectSource(): boolean;
  applyCurrentPitch(): void;
  teardownGraph(clearCaptureLost: boolean): Promise<void>;
  emitCaptureEvent(event: CaptureEvent): void;
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export class CaptureManager {
  private _source: MediaStreamAudioSourceNode | null = null;
  private activeStream: MediaStream | null = null;
  private _pendingConnect = false;
  private _captureLost = false;
  private _target: CaptureTarget = { tabId: null, page: null };

  constructor(
    private graph: AudioGraph,
    private accompaniment: AccompanimentGraph,
    private callbacks: CaptureCallbacks,
  ) {}

  get connected(): boolean {
    return !!this._source;
  }

  get captureLost(): boolean {
    return this._captureLost;
  }

  get pendingConnect(): boolean {
    return this._pendingConnect;
  }

  get source(): MediaStreamAudioSourceNode | null {
    return this._source;
  }

  get tabId(): number | null {
    return this._target.tabId;
  }

  get page(): string | null {
    return this._target.page;
  }

  setPendingConnect(value: boolean): void {
    this._pendingConnect = value;
  }

  /** Re-attributes the capture (settings re-apply on the same stream). */
  setTarget(target: CaptureTarget): void {
    this._target = { tabId: target.tabId, page: target.page };
    this.emit();
  }

  private emit(): void {
    this.callbacks.emitCaptureEvent({
      connected: this.connected,
      captureLost: this._captureLost,
      tabId: this._target.tabId,
      page: this._target.page,
    });
  }

  async start(
    streamId: string,
    semitones: number,
    preserveFormants: boolean,
    target?: CaptureTarget,
  ): Promise<void> {
    const previousTarget = this._target;
    await this.callbacks.ensureGraphReady(semitones, preserveFormants);
    const oldSource = this._source;
    const oldStream = this.activeStream;
    const modeBefore = this.accompaniment.enabled;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      } as MediaTrackConstraints,
    });
    stream.getTracks().forEach((track) => {
      track.addEventListener("ended", () => this.handleCaptureEnded(stream));
    });

    let replacementSource: MediaStreamAudioSourceNode | null = null;
    try {
      replacementSource = this.graph.createMediaStreamSource(stream);
      if (modeBefore && !(await this.accompaniment.ensureEnabled(semitones, preserveFormants))) {
        throw new Error("Accompaniment mode initialization failed");
      }

      this._source = replacementSource;
      this.activeStream = stream;
      this._captureLost = false;
      this._target = target ? { tabId: target.tabId, page: target.page } : previousTarget;
      if (!this.callbacks.connectSource()) throw new Error("Unable to connect replacement capture");

      oldSource?.disconnect();
      stopStream(oldStream);
      this._pendingConnect = false;
      this.callbacks.applyCurrentPitch();
      this.emit();
      console.log("[offscreen] Tab capture connected");
    } catch (err) {
      replacementSource?.disconnect();
      stopStream(stream);
      this._source = oldSource;
      this.activeStream = oldStream;
      this._captureLost = false;
      this._target = previousTarget;
      if (modeBefore && !this.accompaniment.ready) {
        this.accompaniment.deactivate();
      }
      if (oldSource && this.graph.ready) this.callbacks.connectSource();
      this.emit();
      throw err;
    }
  }

  stop(clearCaptureLost = true): void {
    this._source?.disconnect();
    this._source = null;
    stopStream(this.activeStream);
    this.activeStream = null;
    this._pendingConnect = false;
    if (clearCaptureLost) this._captureLost = false;
    this._target = { tabId: null, page: null };
    this.emit();
  }

  handleCaptureEnded(stream: MediaStream): boolean {
    if (this.activeStream !== stream) return false;
    this._captureLost = true;
    this._source?.disconnect();
    this._source = null;
    stopStream(this.activeStream);
    this.activeStream = null;
    this._pendingConnect = false;
    this.emit();
    return true;
  }
}
