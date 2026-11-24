/** Clock giả — mốc cố định, `advance` cho test nhảy thời gian. */
export class FixedClock {
  #now: number;

  public constructor(now: number) {
    this.#now = now;
  }

  public now(): number {
    return this.#now;
  }

  public advance(ms: number): void {
    this.#now += ms;
  }
}
