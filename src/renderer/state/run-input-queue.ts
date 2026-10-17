import { ForgeError } from "../../shared/errors";
import { z } from "zod";
import { type RunInput, type SessionId, runInputSchema } from "../../shared/schemas";

export class RunInputQueue {
  private readonly sessions = new Map<SessionId, { items: RunInput[]; paused: boolean }>();
  static restore(raw: unknown): RunInputQueue {
    const queue = new RunInputQueue();
    for (const input of z.array(runInputSchema).max(1000).parse(raw)) {
      queue.add(input);
      queue.pause(input.sessionId);
    }
    return queue;
  }
  snapshot(): readonly RunInput[] { return [...this.sessions.values()].flatMap(queue => queue.items); }

  add(raw: RunInput): RunInput {
    const input = runInputSchema.parse(raw);
    const all = [...this.sessions.values()].flatMap(queue => queue.items);
    const bytes = new TextEncoder();
    if (all.length >= 1000 || all.reduce((size, item) => size + bytes.encode(item.prompt).length, bytes.encode(input.prompt).length) > 1000000)
      throw new ForgeError("invalid_input", "待发队列已满，草稿已保留。");
    if ([...all, input].reduce((size, item) => size + (item.images ?? []).reduce((sum, image) => sum + image.dataUrl.length, 0), 0) > 16 * 1024 * 1024)
      throw new ForgeError("invalid_input", "待发图片过多，草稿已保留。");
    const queue = this.sessions.get(input.sessionId) ?? { items: [], paused: false };
    queue.items.push(input);
    this.sessions.set(input.sessionId, queue);
    return input;
  }
  remove(input: RunInput): void {
    const queue = this.sessions.get(input.sessionId);
    if (!queue) return;
    const index = queue.items.indexOf(input);
    if (index >= 0) queue.items.splice(index, 1);
    if (!queue.items.length) this.sessions.delete(input.sessionId);
  }
  items(id: SessionId): readonly RunInput[] { return this.sessions.get(id)?.items ?? []; }
  isPaused(id: SessionId): boolean { return this.sessions.get(id)?.paused ?? false; }
  peek(id: SessionId): RunInput | undefined { return this.isPaused(id) ? undefined : this.items(id)[0]; }
  consume(input: RunInput): void {
    const queue = this.sessions.get(input.sessionId);
    if (queue?.items[0] === input) queue.items.shift();
    if (queue?.items.length === 0) this.sessions.delete(input.sessionId);
  }
  pause(id: SessionId): void { const queue = this.sessions.get(id); if (queue) queue.paused = true; }
  resume(id: SessionId): void { const queue = this.sessions.get(id); if (queue) queue.paused = false; }
  clear(id: SessionId): void { this.sessions.delete(id); }
}
