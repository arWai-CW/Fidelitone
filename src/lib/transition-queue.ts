// Serialises async transitions so concurrent message writers (popup edits and
// service-worker handovers) can never interleave half-applied state.
// ADR-0004 revives this as the single ordering point for offscreen messages:
// one operation at a time, and an error never poisons the chain.

export class TransitionQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
