import { emulator } from './emulator';

/** Several controls can hold the same key. The emulator sees one edge per change. */
export class InputHolds {
  private owners = new Map<string, Set<string>>();

  replace(owner: string, names: string[]): void {
    const next = new Set(names.filter((name) => name.length > 0));
    const touched = new Set<string>(next);
    for (const [name, set] of this.owners) {
      if (set.has(owner)) touched.add(name);
    }
    for (const name of touched) {
      const before = (this.owners.get(name)?.size ?? 0) > 0;
      let set = this.owners.get(name);
      if (!set) {
        set = new Set();
        this.owners.set(name, set);
      }
      if (next.has(name)) set.add(owner);
      else set.delete(owner);
      if (set.size === 0) this.owners.delete(name);
      const after = (this.owners.get(name)?.size ?? 0) > 0;
      if (before !== after) this.send(name, after);
    }
  }

  releaseAll(): void {
    const names = [...this.owners.keys()];
    this.owners.clear();
    for (const name of names) this.send(name, false);
  }

  private send(name: string, down: boolean): void {
    try {
      emulator.setVirtualKey(name, down);
    } catch {
      /* the core is not running yet */
    }
  }
}

export const holds = new InputHolds();
