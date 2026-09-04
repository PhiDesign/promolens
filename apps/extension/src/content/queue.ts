/**
 * Small keyed task queue with a concurrency limit and cancellation.
 *
 * Posts that scroll far away before their analysis starts are cancelled (they
 * are removed from the queue); tasks already running receive a token they can
 * check before doing more work or touching the DOM.
 */
export interface CancelToken {
  readonly cancelled: boolean;
}

type Task = (token: CancelToken) => Promise<void>;

interface Entry {
  key: string;
  task: Task;
  priority: number;
  token: { cancelled: boolean };
}

export class TaskQueue {
  private readonly pending: Entry[] = [];
  private readonly running = new Map<string, Entry>();

  constructor(private readonly concurrency: number = 3) {}

  get pendingCount(): number {
    return this.pending.length;
  }

  get runningCount(): number {
    return this.running.size;
  }

  has(key: string): boolean {
    return this.running.has(key) || this.pending.some((e) => e.key === key);
  }

  /** Add a task. Higher priority runs first. Duplicate keys are ignored. */
  enqueue(key: string, task: Task, priority = 0): boolean {
    if (this.has(key)) return false;
    this.pending.push({ key, task, priority, token: { cancelled: false } });
    this.pending.sort((a, b) => b.priority - a.priority);
    this.pump();
    return true;
  }

  /** Remove a pending task, or flag a running one as cancelled. */
  cancel(key: string): void {
    const idx = this.pending.findIndex((e) => e.key === key);
    if (idx >= 0) {
      this.pending[idx]!.token.cancelled = true;
      this.pending.splice(idx, 1);
      return;
    }
    const running = this.running.get(key);
    if (running) running.token.cancelled = true;
  }

  cancelAll(): void {
    for (const e of this.pending) e.token.cancelled = true;
    this.pending.length = 0;
    for (const e of this.running.values()) e.token.cancelled = true;
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.pending.length > 0) {
      const entry = this.pending.shift()!;
      this.running.set(entry.key, entry);
      // Yield to the event loop so scrolling stays smooth.
      setTimeout(() => {
        entry
          .task(entry.token)
          .catch(() => undefined)
          .finally(() => {
            this.running.delete(entry.key);
            this.pump();
          });
      }, 0);
    }
  }
}
