import { emulator } from './emulator';

type KeySink = (name: string, down: boolean) => void;

/** Several controls can hold the same key. Arcade cores sample names() each frame. */
export class InputHolds {
  private owners = new Map<string, Set<string>>();
  private sink: KeySink | null = null;

  use(sink: KeySink): void {
    this.sink = sink;
  }

  useEmulator(): void {
    this.sink = null;
  }

  replace(owner: string, names: string[]): void {
    const before = new Set(this.owners.keys());
    const next = new Set(names.filter((name) => name.length > 0));
    for (const [name, set] of this.owners) {
      if (!next.has(name)) set.delete(owner);
      if (set.size === 0) this.owners.delete(name);
    }
    for (const name of next) {
      let set = this.owners.get(name);
      if (!set) {
        set = new Set();
        this.owners.set(name, set);
      }
      set.add(owner);
    }
    this.noteEdges(before);
  }

  /** SDL key names currently held by touch, combos, or anything else on the page. */
  names(): string[] {
    return [...this.owners.keys()];
  }

  releaseAll(): void {
    const names = [...this.owners.keys()];
    this.owners.clear();
    for (const name of names) this.sink?.(name, false);
    try {
      emulator.setHeldKeys('');
    } catch {
      /* the core is not running yet */
    }
  }

  private noteEdges(before: Set<string>): void {
    if (!this.sink) return;
    const after = new Set(this.owners.keys());
    for (const name of before) {
      if (!after.has(name)) this.sink(name, false);
    }
    for (const name of after) {
      if (!before.has(name)) this.sink(name, true);
    }
  }
}

export const holds = new InputHolds();
