export class TicketNonceStore {
  private readonly used = new Map<string, number>();

  consume(nonce: string, expiresAt: number): boolean {
    this.cleanup();
    if (this.used.has(nonce)) return false;
    this.used.set(nonce, expiresAt);
    return true;
  }

  cleanup(now = Date.now()): void {
    for (const [nonce, expiresAt] of this.used) if (expiresAt <= now) this.used.delete(nonce);
  }
}
