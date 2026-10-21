import { emulator } from './emulator';

/** Several controls can hold the same key. The emulator sees one edge per change. */
export class InputHolds {
  private owners = new Map<string, Set<string>>();

  replace(owner: string, names: string[]): void {
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
  }

  /** SDL key names currently held by touch, combos, or anything else on the page. */
  names(): string[] {
    return [...this.owners.keys()];
  }

  releaseAll(): void {
    this.owners.clear();
    try {
      emulator.setHeldKeys('');
    } catch {
      /* the core is not running yet */
    }
  }
}

export const holds = new InputHolds();
