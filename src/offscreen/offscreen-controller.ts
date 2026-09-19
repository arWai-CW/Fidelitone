import { OffscreenController as OffscreenControllerInterface } from "./offscreen-messages";
import { routeFor, type Engine } from "./offscreen-state";
import { AudioGraph } from "./audio-graph";
import { EngineSwitching } from "./engine-switching";
import { AccompanimentGraph } from "./accompaniment";
import { CaptureManager } from "./capture-manager";
import { GraphRouter } from "./graph-router";
import { semitonesToPitchScale } from "../lib/dsp/math";

export class OffscreenController implements OffscreenControllerInterface {
  readonly graph = new AudioGraph();
  readonly engine = new EngineSwitching(this.graph);
  readonly accompaniment = new AccompanimentGraph(this.graph, this.engine);
  readonly capture: CaptureManager;
  readonly router: GraphRouter;

  private currentSemitones = 0;
  private isBypass = false;
  private preserveFormants = false;
  private isAccompanimentMode = false;
  private transitionQueue = Promise.resolve();

  constructor() {
    this.capture = new CaptureManager(this.graph, this.accompaniment, {
      ensureGraphReady: (semitones, preserveFormants) =>
        this.graph.ensureReady(semitones, preserveFormants),
      connectSource: () =>
        this.router.connectSource({
          bypass: this.isBypass,
          accompanimentMode: this.isAccompanimentMode,
        }),
      applyCurrentPitch: () => this.applyCurrentPitch(),
      teardownGraph: (clearCaptureLost) => this.teardownGraph(clearCaptureLost),
    });
    this.router = new GraphRouter(
      this.graph,
      this.engine,
      this.accompaniment,
      () => this.capture.source,
    );
  }

  async setPitch(value: { semitones: number }): Promise<boolean> {
    const semitones = value?.semitones;
    if (!Number.isFinite(semitones)) return false;

    this.currentSemitones = semitones;
    this.applyCurrentPitch();
    if (!this.capture.source) {
      this.capture.setPendingConnect(true);
      console.log("[offscreen] Pitch queued (waiting for capture)");
    }
    console.log("[offscreen] Pitch →", this.currentSemitones, "semitones");
    return true;
  }

  async setBypass(value: { active: boolean }): Promise<boolean> {
    if (typeof value?.active !== "boolean") return false;

    const previous = this.isBypass;
    this.isBypass = value.active;
    if (this.capture.source && this.graph.ready) {
      try {
        if (
          !this.router.connectSource({
            bypass: this.isBypass,
            accompanimentMode: this.isAccompanimentMode,
          })
        )
          throw new Error("Unable to apply bypass routing");
      } catch (err) {
        this.isBypass = previous;
        if (this.capture.source && this.graph.ready)
          this.router.connectSource({
            bypass: previous,
            accompanimentMode: this.isAccompanimentMode,
          });
        throw err;
      }
    }

    this.applyCurrentPitch();
    console.log("[offscreen] Bypass →", this.isBypass ? "ON" : "OFF");
    return true;
  }

  async setFormants(value: { preserve: boolean }): Promise<boolean> {
    if (typeof value?.preserve !== "boolean") return false;
    this.preserveFormants = value.preserve;
    this.graph.setFormantOption(this.preserveFormants);
    void this.engine.setFormants(this.preserveFormants, this.currentSemitones).catch((err) =>
      console.error("[offscreen] Signalsmith formant update failed:", err),
    );
    console.log("[offscreen] Formant preservation →", this.preserveFormants ? "ON" : "OFF");
    return true;
  }

  async setAccompaniment(value: { enabled: boolean }): Promise<boolean> {
    if (typeof value?.enabled !== "boolean") return false;

    if (value.enabled) {
      if (!(await this.accompaniment.ensureEnabled(this.currentSemitones, this.preserveFormants))) {
        if (this.capture.source && this.graph.ready) {
          this.router.connectSource({
            bypass: this.isBypass,
            accompanimentMode: this.isAccompanimentMode,
          });
        }
        return false;
      }
      const previous = this.isAccompanimentMode;
      this.isAccompanimentMode = true;
      if (
        this.capture.source &&
        this.graph.ready &&
        !this.router.connectSource({
          bypass: this.isBypass,
          accompanimentMode: this.isAccompanimentMode,
        })
      ) {
        this.isAccompanimentMode = previous;
        this.accompaniment.reset();
        if (this.capture.source && this.graph.ready) {
          this.router.connectSource({
            bypass: this.isBypass,
            accompanimentMode: this.isAccompanimentMode,
          });
        }
        return false;
      }
    } else {
      const previous = this.isAccompanimentMode;
      this.isAccompanimentMode = false;
      this.accompaniment.reset();
      if (
        this.capture.source &&
        this.graph.ready &&
        !this.router.connectSource({
          bypass: this.isBypass,
          accompanimentMode: this.isAccompanimentMode,
        })
      ) {
        this.isAccompanimentMode = previous;
        if (this.capture.source && this.graph.ready) {
          this.router.connectSource({
            bypass: this.isBypass,
            accompanimentMode: this.isAccompanimentMode,
          });
        }
        return false;
      }
    }

    console.log("[offscreen] Accompaniment mode →", this.isAccompanimentMode ? "ON" : "OFF");
    return true;
  }

  async setEngine(engine: Engine): Promise<boolean> {
    return this.engine.setEngine(
      engine,
      {
        connected: !!this.capture.source,
        bypass: this.isBypass,
        accompanimentMode: this.isAccompanimentMode,
      },
      (preserveGains) =>
        this.router.connectSource(
          {
            bypass: this.isBypass,
            accompanimentMode: this.isAccompanimentMode,
          },
          preserveGains,
        ),
      () => this.applyCurrentPitch(),
      this.currentSemitones,
      this.preserveFormants,
    );
  }

  async startCapture(streamId: string): Promise<void> {
    await this.capture.start(streamId, this.currentSemitones, this.preserveFormants);
  }

  async stopCapture(): Promise<void> {
    this.capture.stop(true);
    await this.teardownGraph(true);
  }

  getState() {
    const engine = this.engine.effectiveEngine();
    return {
      ready: this.graph.ready,
      state: {
        ready: this.graph.ready,
        connected: this.capture.connected,
        pitch: this.currentSemitones,
        bypass: this.isBypass,
        preserveFormants: this.preserveFormants,
        accompanimentMode: this.isAccompanimentMode,
        engine,
        selectedEngine: this.engine.selectedEngine,
        route: routeFor({
          bypass: this.isBypass,
          accompanimentMode: this.isAccompanimentMode,
          accompanimentReady: this.accompaniment.ready,
          engine,
        }),
        captureLost: this.capture.captureLost,
        engineAvailability: this.engine.availability,
      },
    };
  }

  async teardownGraph(clearCaptureLost = true): Promise<void> {
    this.capture.stop(clearCaptureLost);
    await this.accompaniment.resetWorklets();
    this.router.rewire();
    await this.graph.teardown();
    this.engine.reset();
    this.accompaniment.reset();
  }

  private runTransition<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.transitionQueue.then(operation, operation);
    this.transitionQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private applyCurrentPitch(): void {
    const pitchScale = semitonesToPitchScale(this.currentSemitones);
    if (this.graph.rubberbandNode && this.graph.rubberbandReadyStatus) {
      this.graph.setPitchScale(pitchScale);
      this.graph.rubberbandNode.port.postMessage({ type: "SET_PITCH", pitchScale });
    }
    if (this.accompaniment.ready) {
      this.accompaniment.applyDryPitch(this.currentSemitones);
    }
    if (this.engine.signalsmithAvailable) {
      void this.engine.applyPitch(this.currentSemitones, this.preserveFormants).catch((err) =>
        console.error("[offscreen] Signalsmith pitch update failed:", err),
      );
    }
  }

  async start(): Promise<void> {
    await this.graph.ensureReady(this.currentSemitones, this.preserveFormants);
  }
}
