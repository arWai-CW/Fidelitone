export const RUBBERBAND_OPTION_PROCESS_REALTIME = 0x00000001;
export const RUBBERBAND_OPTION_ENGINE_FINER = 0x00000020;
export const RUBBERBAND_OPTION_PITCH_SHIFT = 0x00000100;
export const RUBBERBAND_OFFSCREEN_OPTIONS =
  RUBBERBAND_OPTION_PROCESS_REALTIME |
  RUBBERBAND_OPTION_ENGINE_FINER |
  RUBBERBAND_OPTION_PITCH_SHIFT;
export const RUBBERBAND_WORKER_OPTIONS = 0;
export const RUBBERBAND_FORMANT_SHIFTED = 0x00000000;
export const RUBBERBAND_FORMANT_PRESERVED = 0x01000000;

export interface RubberBandWasmExports {
  memory: WebAssembly.Memory;
  rb_live_new(sampleRate: number, channels: number, options: number): number;
  rb_live_delete(state: number): void;
  rb_live_get_block_size(state: number): number;
  rb_live_get_start_delay(state: number): number;
  rb_live_set_pitch_scale(state: number, pitchScale: number): void;
  rb_live_set_formant_option?(state: number, option: number): void;
  rb_live_shift(state: number, inputChannels: number, outputChannels: number): void;
  wasm_malloc(size: number): number;
  wasm_free(pointer: number): void;
}

export interface RubberBandLiveShifterInit {
  blockSize: number;
  startDelay: number;
  channels: number;
  sampleRate: number;
}

export async function loadRubberBandWasm(): Promise<RubberBandWasmExports | null> {
  try {
    const wasmUrl = new URL("../../wasm/rubberband.wasm", import.meta.url);
    const { instance } = await WebAssembly.instantiateStreaming(fetch(wasmUrl), {
      env: { emscripten_notify_memory_growth: () => {} },
      wasi_snapshot_preview1: {
        environ_get: () => 0,
        environ_sizes_get: () => 0,
        fd_seek: () => 0,
        fd_close: () => 0,
        fd_write: () => 0,
        fd_read: () => 0,
        clock_time_get: () => 0,
      },
    });
    return instance.exports as unknown as RubberBandWasmExports;
  } catch (error) {
    console.error("[rubberband-live-shifter] WASM load failed:", error);
    return null;
  }
}

/**
 * Owns one RubberBand LiveShifter instance and its WASM allocations.
 * The caller supplies the loaded exports so this module stays independent of
 * the page and worker message protocols.
 */
export class RubberBandLiveShifter {
  private state = 0;
  private blockSize = 512;
  private channels = 0;
  private inputChannelPointers = 0;
  private outputChannelPointers = 0;
  private inputPointers: number[] = [];
  private outputPointers: number[] = [];
  private views: Float32Array = new Float32Array(0);

  constructor(
    private readonly exports: RubberBandWasmExports,
    private readonly options: number,
  ) {}

  get isInitialized(): boolean {
    return this.state !== 0;
  }

  get currentBlockSize(): number {
    return this.blockSize;
  }

  get currentChannels(): number {
    return this.channels;
  }

  init(
    sampleRate: number,
    channels: number,
    pitchScale: number,
    preserveFormants = false,
  ): RubberBandLiveShifterInit | null {
    this.delete();
    if (!this.exports.rb_live_new) return null;

    const newState = this.exports.rb_live_new(sampleRate, channels, this.options);
    if (newState === 0) return null;
    this.state = newState;
    this.channels = channels;

    try {
      this.exports.rb_live_set_pitch_scale(this.state, pitchScale);
      this.setFormantOption(preserveFormants);
      this.blockSize = this.exports.rb_live_get_block_size(this.state);
      const startDelay = this.exports.rb_live_get_start_delay(this.state);

      const channelBytes = this.blockSize * Float32Array.BYTES_PER_ELEMENT;
      for (let channel = 0; channel < this.channels; channel++) {
        this.inputPointers.push(this.exports.wasm_malloc(channelBytes));
        this.outputPointers.push(this.exports.wasm_malloc(channelBytes));
      }
      this.inputChannelPointers = this.exports.wasm_malloc(this.channels * 4);
      this.outputChannelPointers = this.exports.wasm_malloc(this.channels * 4);

      if (
        this.inputPointers.some((pointer) => pointer === 0) ||
        this.outputPointers.some((pointer) => pointer === 0) ||
        this.inputChannelPointers === 0 ||
        this.outputChannelPointers === 0
      ) {
        throw new Error("RubberBand WASM buffer allocation failed");
      }

      this.refreshViews();
      const pointers = new Uint32Array(this.exports.memory.buffer);
      for (let channel = 0; channel < this.channels; channel++) {
        pointers[(this.inputChannelPointers >> 2) + channel] = this.inputPointers[channel];
        pointers[(this.outputChannelPointers >> 2) + channel] = this.outputPointers[channel];
      }

      return { blockSize: this.blockSize, startDelay, channels, sampleRate };
    } catch (error) {
      this.delete();
      throw error;
    }
  }

  setPitchScale(pitchScale: number): void {
    if (this.state !== 0) {
      this.exports.rb_live_set_pitch_scale(this.state, pitchScale);
    }
  }

  setFormantOption(preserveFormants: boolean): void {
    if (this.state === 0) return;
    const option = preserveFormants
      ? RUBBERBAND_FORMANT_PRESERVED
      : RUBBERBAND_FORMANT_SHIFTED;
    this.exports.rb_live_set_formant_option?.(this.state, option);
  }

  shift(
    inputChannels: Float32Array[],
    outputChannels?: Float32Array[],
  ): Float32Array[] {
    if (this.state === 0) return [];

    const output = outputChannels ?? Array.from(
      { length: this.channels },
      () => new Float32Array(this.blockSize),
    );
    this.refreshViews();
    for (let channel = 0; channel < this.channels; channel++) {
      const input = inputChannels[channel];
      const base = this.inputPointers[channel] >> 2;
      for (let sample = 0; sample < this.blockSize; sample++) {
        this.views[base + sample] = input?.[sample] ?? 0;
      }
    }

    this.exports.rb_live_shift(this.state, this.inputChannelPointers, this.outputChannelPointers);
    this.refreshViews();
    for (let channel = 0; channel < this.channels; channel++) {
      const base = this.outputPointers[channel] >> 2;
      for (let sample = 0; sample < this.blockSize; sample++) {
        output[channel][sample] = this.views[base + sample];
      }
    }
    return output;
  }

  delete(): void {
    if (this.state !== 0) {
      this.exports.rb_live_delete(this.state);
      this.state = 0;
    }
    for (const pointer of [
      ...this.inputPointers,
      ...this.outputPointers,
      this.inputChannelPointers,
      this.outputChannelPointers,
    ]) {
      if (pointer !== 0) this.exports.wasm_free(pointer);
    }
    this.inputPointers = [];
    this.outputPointers = [];
    this.inputChannelPointers = 0;
    this.outputChannelPointers = 0;
    this.blockSize = 512;
  }

  private refreshViews(): void {
    this.views = new Float32Array(this.exports.memory.buffer);
  }
}
