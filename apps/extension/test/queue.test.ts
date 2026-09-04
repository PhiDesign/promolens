import { describe, expect, it } from "vitest";
import { TaskQueue } from "../src/content/queue.js";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("TaskQueue", () => {
  it("never runs more than `concurrency` tasks at once", async () => {
    const q = new TaskQueue(2);
    let running = 0;
    let peak = 0;
    const done: string[] = [];
    const task = (name: string) => async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 15));
      running--;
      done.push(name);
    };
    for (const n of ["a", "b", "c", "d"]) q.enqueue(n, task(n));
    expect(q.pendingCount + q.runningCount).toBe(4);
    await new Promise((r) => setTimeout(r, 120));
    expect(peak).toBe(2);
    expect(done.sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("ignores duplicate keys", () => {
    const q = new TaskQueue(1);
    expect(q.enqueue("k", async () => undefined)).toBe(true);
    expect(q.enqueue("k", async () => undefined)).toBe(false);
  });

  it("cancels pending tasks before they start and flags running ones", async () => {
    const q = new TaskQueue(1);
    const seen: string[] = [];
    let runningToken: { cancelled: boolean } | undefined;
    q.enqueue("first", async (token) => {
      runningToken = token;
      await new Promise((r) => setTimeout(r, 30));
      seen.push(`first:${token.cancelled}`);
    });
    q.enqueue("second", async () => {
      seen.push("second");
    });
    await tick();
    q.cancel("second"); // still pending -> removed
    q.cancel("first"); // running -> token flagged
    await new Promise((r) => setTimeout(r, 60));
    expect(seen).toEqual(["first:true"]);
    expect(runningToken?.cancelled).toBe(true);
    expect(q.has("second")).toBe(false);
  });

  it("runs higher priority tasks first", async () => {
    const q = new TaskQueue(1);
    const order: string[] = [];
    // Block the queue so the priorities of the rest matter.
    q.enqueue("block", async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    q.enqueue("low", async () => {
      order.push("low");
    }, 0);
    q.enqueue("high", async () => {
      order.push("high");
    }, 10);
    await new Promise((r) => setTimeout(r, 60));
    expect(order).toEqual(["high", "low"]);
  });

  it("keeps going when a task throws", async () => {
    const q = new TaskQueue(1);
    const order: string[] = [];
    q.enqueue("bad", async () => {
      throw new Error("boom");
    });
    q.enqueue("good", async () => {
      order.push("good");
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual(["good"]);
  });
});
