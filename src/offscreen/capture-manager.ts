import type { AudioGraph } from "./audio-graph";
import type { AccompanimentGraph } from "./accompaniment";

export interface CaptureCallbacks {
  ensureGraphReady(semitones: number, preserveFormants: boolean): Promise<void>;
  connectSource(): boolean;
  applyCurrentPitch(): void;
  teardownGraph(clearCaptureLost: boolean): Promise<void>;
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export class CaptureManager {
  private _source: MediaStreamAudioSourceNode | null = null;
  private activeStream: MediaStream | null = null;
  private _pendingConnect = false;
  private _captureLost = false;

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

  setPendingConnect(value: boolean): void {
    this._pendingConnect = value;
  }

  async start(streamId: string, semitones: number, preserveFormants: boolean): Promise<void> {
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
      if (!this.callbacks.connectSource()) throw new Error("Unable to connect replacement capture");

      oldSource?.disconnect();
      stopStream(oldStream);
      this._pendingConnect = false;
      this.callbacks.applyCurrentPitch();
      console.log("[offscreen] Tab capture connected");
    } catch (err) {
      replacementSource?.disconnect();
      stopStream(stream);
      this._source = oldSource;
      this.activeStream = oldStream;
      this._captureLost = false;
      if (modeBefore && !this.accompaniment.ready) {
        this.accompaniment.deactivate();
      }
      if (oldSource && this.graph.ready) this.callbacks.connectSource();
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
  }

  handleCaptureEnded(stream: MediaStream): boolean {
    if (this.activeStream !== stream) return false;
    this._captureLost = true;
    this._source?.disconnect();
    this._source = null;
    stopStream(this.activeStream);
    this.activeStream = null;
    this._pendingConnect = false;
    return true;
  }
}
