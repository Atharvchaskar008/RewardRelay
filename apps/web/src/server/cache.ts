import "server-only";

/**
 * A small per-instance cache for chain reads in the request path. Concurrent callers of the same key
 * share one in-flight call, a value is reused for `ttlMs`, failures are never cached, and the oldest
 * entries are dropped beyond `max`. The chain stays the source of truth: every cached value is either
 * immutable (a block's timestamp) or a few seconds old at most, and no privileged action relies on it.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<V>>();
  /** Bumped by `invalidate`, so a load that started earlier cannot store a stale value afterwards. */
  private generation = 0;

  constructor(private readonly options: { ttlMs: number; max: number; now?: () => number }) {}

  async get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.value;
    return this.inFlight.get(key) ?? this.start(key, load);
  }

  /** Always loads anew (never joins an earlier in-flight call) and stores the result. */
  refresh(key: string, load: () => Promise<V>): Promise<V> {
    this.entries.delete(key);
    return this.start(key, load);
  }

  /** Drops one key (after a write that changes it) or everything. */
  invalidate(key?: string): void {
    this.generation++;
    if (key === undefined) this.entries.clear();
    else this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }

  private start(key: string, load: () => Promise<V>): Promise<V> {
    const generation = this.generation;
    const call: Promise<V> = load()
      .then((value) => {
        if (generation === this.generation) this.store(key, value);
        return value;
      })
      .finally(() => {
        if (this.inFlight.get(key) === call) this.inFlight.delete(key);
      });
    this.inFlight.set(key, call);
    return call;
  }

  private store(key: string, value: V): void {
    this.entries.delete(key);
    if (this.entries.size >= this.options.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.options.ttlMs });
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}
