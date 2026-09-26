import { OffscreenController as OffscreenControllerInterface } from "./offscreen-messages";
import {
  routeFor,
  type CaptureEvent,
  type CaptureTarget,
  type Engine,
  type SwitchCaptureRequest,
} from "./offscreen-state";
import { AudioGraph } from "./audio-graph";
import { EngineSwitching } from "./engine-switching";
import { AccompanimentGraph } from "./accompaniment";
import { CaptureManager } from "./capture-manager";
import { GraphRouter } from "./graph-router";
import { TransitionQueue } from "../lib/transition-queue";
import { semitonesToPitchScale } from "../lib/dsp/math";
import type { ProcessingSettings } from "../lib/audio-state";

export interface OffscreenControllerOptions {
  /** Called on every capture state change (connected / lost / identity). */
  onCaptureEvent?: (event: CaptureEvent) => void;
}

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
  private readonly transitions = new TransitionQueue();

  constructor(private options: OffscreenControllerOptions = {}) {
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
      emitCaptureEvent: (event) => this.options.onCaptureEvent?.(event),
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

  /**
   * ADR-0004: one atomic handover — warm up the slow work while the old tab
   * still plays, close the output gate, apply the incoming site's settings,
   * swap the stream, then reopen. A failure anywhere rolls back to the previous
   * settings and leaves the old capture running.
   */
  async switchCapture(request: SwitchCaptureRequest): Promise<void> {
    const next: ProcessingSettings = request.settings ?? this.currentSettings();
    const previous = this.currentSettings();

    await this.preWarm(next);
    await this.graph.fadeOut();

    try {
      await this.applySettings(next);
      const target: CaptureTarget = { tabId: request.tabId, origin: request.origin };
      if (request.streamId) {
        await this.capture.start(
          request.streamId,
          this.currentSemitones,
          this.preserveFormants,
          target,
        );
      } else {
        this.capture.setTarget(target);
      }
    } catch (err) {
      await this.restoreSettings(previous);
      await this.graph.fadeIn();
      throw err;
    }

    await this.graph.fadeIn();
    console.log("[offscreen] Capture →", request.origin, "(tab", request.tabId, ")");
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
        tabId: this.capture.tabId,
        origin: this.capture.origin,
      },
    };
  }

  /** Serialised execution point for every mutating offscreen message. */
  runTransition<T>(operation: () => Promise<T>): Promise<T> {
    return this.transitions.run(operation);
  }

  async teardownGraph(clearCaptureLost = true): Promise<void> {
    this.capture.stop(clearCaptureLost);
    await this.accompaniment.resetWorklets();
    this.router.rewire();
    await this.graph.teardown();
    this.engine.reset();
    this.accompaniment.reset();
  }

  private currentSettings(): ProcessingSettings {
    return {
      pitch: this.currentSemitones,
      bypass: this.isBypass,
      preserveFormants: this.preserveFormants,
      accompanimentMode: this.isAccompanimentMode,
      engine: this.engine.selectedEngine,
    };
  }

  /**
   * Builds the slow pieces (worklets, Signalsmith WASM) before the gate closes.
   * Neither call touches the audible routing, so the outgoing tab keeps playing.
   */
  private async preWarm(settings: ProcessingSettings): Promise<void> {
    if (settings.accompanimentMode && !this.accompaniment.ready) {
      await this.accompaniment.ensureEnabled(this.currentSemitones, settings.preserveFormants).catch((err) =>
        console.warn("[offscreen] Accompaniment pre-warm failed:", err),
      );
    }
    if (settings.engine === "signalsmith" && !this.engine.signalsmithAvailable) {
      await this.engine.initSignalsmith(settings.pitch, settings.preserveFormants).catch((err) =>
        console.warn("[offscreen] Signalsmith pre-warm failed:", err),
      );
    }
  }

  private async applySettings(settings: ProcessingSettings): Promise<void> {
    if (!(await this.setPitch({ semitones: settings.pitch }))) {
      throw new Error("Unable to apply pitch");
    }
    if (!(await this.setFormants({ preserve: settings.preserveFormants }))) {
      throw new Error("Unable to apply formant option");
    }
    if (!(await this.setBypass({ active: settings.bypass }))) {
      throw new Error("Unable to apply bypass routing");
    }

    // Availability issues degrade instead of aborting: effectiveEngine() already
    // falls back, and a missing engine must never block a tab follow.
    const engine = this.resolveAvailableEngine(settings.engine);
    if (!(await this.setEngine(engine))) {
      console.warn("[offscreen] Engine unavailable, keeping", this.engine.selectedEngine);
    }
    if (!(await this.setAccompaniment({ enabled: settings.accompanimentMode }))) {
      console.warn(
        "[offscreen] Accompaniment unavailable, staying",
        this.isAccompanimentMode ? "ON" : "OFF",
      );
    }
  }

  private resolveAvailableEngine(requested: Engine): Engine {
    const availability = this.engine.availability;
    if (availability[requested]) return requested;
    const fallback: Engine = requested === "signalsmith" ? "rubberband" : "signalsmith";
    if (availability[fallback]) {
      console.warn("[offscreen] Requested engine unavailable, using", fallback);
      return fallback;
    }
    return requested;
  }

  private async restoreSettings(settings: ProcessingSettings): Promise<void> {
    try {
      await this.applySettings(settings);
    } catch (err) {
      console.error("[offscreen] Settings rollback failed:", err);
    }
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
