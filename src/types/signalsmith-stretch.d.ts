declare module 'signalsmith-stretch' {
  interface StretchNode extends AudioWorkletNode {
    configure(options: {
      blockMs?: number | null;
      intervalMs?: number;
      splitComputation?: boolean;
      preset?: "default" | "cheaper";
    }): Promise<void>;
    latency(): Promise<number>;
    schedule(options: {
      active?: boolean;
      semitones?: number;
      rate?: number;
      output?: number;
    }): Promise<void>;
  }

  interface StretchOptions {
    numberOfInputs?: number;
    numberOfOutputs?: number;
    outputChannelCount?: number[];
  }

  interface SignalsmithStretchFactory {
    moduleUrl?: string;
    (ctx: AudioContext, options?: StretchOptions): Promise<StretchNode>;
  }

  const SignalsmithStretch: SignalsmithStretchFactory;
  export default SignalsmithStretch;
}
