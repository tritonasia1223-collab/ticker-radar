/** Protect business transactions from frozen serverless sockets; never replay a write. */
export class DatabaseRequestGate {
  private active = 0;
  private checking: Promise<void> | null = null;
  constructor(
    private probe: () => Promise<unknown>,
    private recycle: () => Promise<void>,
    private timeoutMs = 2000,
  ) {}
  private async checkOnce() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.probe(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("DB liveness timeout")), this.timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  private async check() {
    try {
      await this.checkOnce();
    } catch {
      await this.recycle();
      try {
        await this.checkOnce();
      } catch {
        await this.recycle();
        throw new Error("DB 연결을 확인하지 못했습니다. 기기 초안을 유지하고 다시 시도하세요.");
      }
    }
  }
  async acquire() {
    if (!this.active && !this.checking) {
      this.checking = this.check().finally(() => { this.checking = null; });
    }
    if (this.checking) await this.checking;
    this.active++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
  }
}
