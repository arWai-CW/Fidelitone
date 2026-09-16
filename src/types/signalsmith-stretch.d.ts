declare module 'signalsmith-stretch' {
  interface StretchNode extends AudioWorkletNode {
    schedule(options: { active?: boolean; semitones?: number; rate?: number; output?: number }): Promise<void>;
  }
  function SignalsmithStretch(ctx: AudioContext): Promise<StretchNode>;
  export default SignalsmithStretch;
}
