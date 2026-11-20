/** Polling owns no writes. Releasing/pausing a reader must never cancel a save. */
export class SyncLifecycle {
  private consumers = new Map<symbol, string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private generation = 0;
  private running = false;
  private again = false;
  private visible = true;
  private online = true;
  constructor(private run: (scopes: string[], current: () => boolean) => Promise<void>, private interval = 5000) {}
  acquire(scope: string) {
    const token = Symbol(); this.consumers.set(token, scope); this.restart();
    return () => { if (this.consumers.delete(token)) this.restart(); };
  }
  setEnvironment(visible: boolean, online: boolean) {
    if (visible === this.visible && online === this.online) return;
    this.visible = visible; this.online = online; this.restart();
  }
  private restart() {
    this.generation++; clearInterval(this.timer); this.timer = undefined;
    if (!this.visible || !this.online || !this.consumers.size) return;
    void this.wake(); this.timer = setInterval(() => void this.wake(false), this.interval);
  }
  async wake(force = true) {
    if (!this.visible || !this.online || !this.consumers.size) return;
    if (this.running) { if (force) this.again = true; return; }
    const generation = this.generation;
    this.running = true;
    try { await this.run([...new Set(this.consumers.values())], () => generation === this.generation); }
    finally {
      this.running = false;
      if (this.again) { this.again = false; void this.wake(); }
    }
  }
}
