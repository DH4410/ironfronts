interface Window { startedAt: number; attempts: number }

export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  constructor(private readonly maximum = 20, private readonly durationMs = 15 * 60_000) {}
  consume(key: string): boolean {
    const now = Date.now();
    const window = this.windows.get(key);
    if (!window || now - window.startedAt >= this.durationMs) {
      this.windows.set(key, { startedAt: now, attempts: 1 });
      return true;
    }
    window.attempts += 1;
    return window.attempts <= this.maximum;
  }
  cleanup(): void {
    const now = Date.now();
    for (const [key, window] of this.windows) if (now - window.startedAt >= this.durationMs) this.windows.delete(key);
  }
}
