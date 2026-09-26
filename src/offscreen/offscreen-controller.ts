import { OffscreenController as OffscreenControllerInterface } from "./offscreen-messages";
import {
  routeFor,
  type CaptureEvent,
  type CaptureTarget,
  type SwitchCaptureRequest,
} from "./offscreen-state";
import { AudioGraph } from "./audio-graph";
import { PitchEngine } from "./pitch-engine";
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
  readonly engine = new PitchEngine(this.graph);
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
      ensureGraphReady: () => this.graph.ensureReady(),
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
    // Build the engine before the capture arrives: a pitch the user can see on
    // the rail must be one the engine is actually able to apply.
    void this.engine.ensureReady(semitones, this.preserveFormants).catch((err) =>
      console.error("[offscreen] Engine init failed:", err),
    );
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

  /**
   * ADR-0004: one atomic handover — warm up the slow work while the old tab
   * still plays, close the output gate, apply the incoming page's settings,
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
      const target: CaptureTarget = { tabId: request.tabId, page: request.page };
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
    console.log("[offscreen] Capture →", request.page, "(tab", request.tabId, ")");
  }

  async stopCapture(): Promise<void> {
    this.capture.stop(true);
    await this.teardownGraph(true);
  }

  getState() {
    return {
      ready: this.graph.ready,
      state: {
        ready: this.graph.ready,
        connected: this.capture.connected,
        pitch: this.currentSemitones,
        bypass: this.isBypass,
        preserveFormants: this.preserveFormants,
        accompanimentMode: this.isAccompanimentMode,
        route: routeFor({
          bypass: this.isBypass,
          accompanimentMode: this.isAccompanimentMode,
          accompanimentReady: this.accompaniment.ready,
          engineReady: this.engine.ready,
        }),
        captureLost: this.capture.captureLost,
        tabId: this.capture.tabId,
        page: this.capture.page,
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
    this.engine.reset();
    await this.graph.teardown();
    this.accompaniment.reset();
  }

  private currentSettings(): ProcessingSettings {
    return {
      pitch: this.currentSemitones,
      bypass: this.isBypass,
      preserveFormants: this.preserveFormants,
      accompanimentMode: this.isAccompanimentMode,
    };
  }

  /**
   * Builds the slow pieces (worklets, the Signalsmith engine) before the gate
   * closes. Neither call touches the audible routing, so the outgoing tab keeps
   * playing through the handover.
   */
  private async preWarm(settings: ProcessingSettings): Promise<void> {
    if (settings.accompanimentMode && !this.accompaniment.ready) {
      await this.accompaniment.ensureEnabled(this.currentSemitones, settings.preserveFormants).catch((err) =>
        console.warn("[offscreen] Accompaniment pre-warm failed:", err),
      );
    } else if (!this.accompaniment.ready) {
      await this.engine.ensureReady(this.currentSemitones, settings.preserveFormants).catch((err) =>
        console.warn("[offscreen] Engine pre-warm failed:", err),
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

    // Availability issues degrade instead of aborting: a missing engine must
    // never block a tab follow, and the graph falls back to passthrough (ADR-0007).
    if (!(await this.setAccompaniment({ enabled: settings.accompanimentMode }))) {
      console.warn(
        "[offscreen] Accompaniment unavailable, staying",
        this.isAccompanimentMode ? "ON" : "OFF",
      );
    }
  }

  private async restoreSettings(settings: ProcessingSettings): Promise<void> {
    try {
      await this.applySettings(settings);
    } catch (err) {
      console.error("[offscreen] Settings rollback failed:", err);
    }
  }

  private applyCurrentPitch(): void {
    if (this.accompaniment.ready) {
      this.accompaniment.applyDryPitch(this.currentSemitones);
    }
    if (this.engine.ready) {
      void this.engine.applyPitch(this.currentSemitones, this.preserveFormants).catch((err) =>
        console.error("[offscreen] Signalsmith pitch update failed:", err),
      );
    }
  }

  async start(): Promise<void> {
    await this.graph.ensureReady();
  }
}
