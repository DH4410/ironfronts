import { FIXED_STEP_SECONDS } from '@ironfronts/game-core';

/** Retains simulation debt while limiting each callback's work. Speed changes
 * affect newly elapsed time only, and never enlarge a simulation step. */
export class SimulationScheduler {
  private previousMs: number;
  private debtSeconds = 0;
  constructor(
    private readonly step: (hours: number) => void,
    private readonly now: () => number = () => performance.now(),
    private readonly maxStepsPerPump = 100,
  ) { this.previousMs = now(); }

  pump(speed: number): number {
    const now = this.now();
    this.debtSeconds += Math.max(0, now - this.previousMs) / 1_000 * speed;
    this.previousMs = now;
    let steps = 0;
    while (this.debtSeconds + 1e-9 >= FIXED_STEP_SECONDS && steps < this.maxStepsPerPump) {
      this.step(FIXED_STEP_SECONDS / 3_600);
      this.debtSeconds = Math.max(0, this.debtSeconds - FIXED_STEP_SECONDS);
      steps++;
    }
    return steps;
  }

  get pendingSeconds(): number { return this.debtSeconds; }
}
