import { eqCurve } from '../geometry/curves';
import { evaluate } from './evaluate';
import type { ApplyResult, Command, ObjId, ObjSpec, Scene, SceneObject } from './types';

const LABELS = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const isPointDef = (t: string): boolean =>
  t === 'given-point' || t === 'free-point' || t === 'on-curve' || t === 'intersection';

/** What the last successful apply/undo/redo changed, and which of them it was. */
export interface Change {
  added: ObjId[];
  removed: ObjId[];
  kind: 'apply' | 'undo' | 'redo';
}

export class Construction {
  private commands: Command[] = [];
  private cursor = 0;
  private current: Scene;
  private nextId = 1;
  private last: Change = { added: [], removed: [], kind: 'apply' };

  constructor(
    private readonly givens: ObjSpec[],
    private readonly givenLabels: Record<ObjId, string>,
    private readonly sceneDiameter: number,
  ) {
    this.current = this.build(this.activeSpecs());
  }

  scene(): Scene {
    return this.current;
  }

  allocId(): ObjId {
    return `o${this.nextId++}`;
  }

  /** Non-given objects currently in the construction: adds after the last reset, up to cursor. */
  private activeAdds(): ObjSpec[] {
    let start = 0;
    for (let i = this.cursor - 1; i >= 0; i--) {
      if (this.commands[i]?.type === 'reset') {
        start = i + 1;
        break;
      }
    }
    const out: ObjSpec[] = [];
    for (let i = start; i < this.cursor; i++) {
      const c = this.commands[i];
      if (c?.type === 'add') out.push(...c.objects);
    }
    return out;
  }

  private activeSpecs(): ObjSpec[] {
    return [...this.givens, ...this.activeAdds()];
  }

  private build(specs: ObjSpec[]): Scene {
    const scene = evaluate(specs, this.sceneDiameter);
    const used = new Set(Object.values(this.givenLabels));
    const free = LABELS.filter((l) => !used.has(l));
    let n = 0;
    for (const o of scene.objects) {
      const given = this.givenLabels[o.id];
      if (given !== undefined) o.label = given;
      else if (isPointDef(o.def.type) && o.value && !o.given) o.label = free[n++];
    }
    return scene;
  }

  private ids(scene: Scene): Set<ObjId> {
    return new Set(scene.objects.map((o) => o.id));
  }

  private refresh(kind: Change['kind'] = 'apply'): void {
    const before = this.ids(this.current);
    this.current = this.build(this.activeSpecs());
    const after = this.ids(this.current);
    this.last = {
      added: [...after].filter((i) => !before.has(i)),
      removed: [...before].filter((i) => !after.has(i)),
      kind,
    };
  }

  apply(cmd: Command): ApplyResult {
    if (cmd.type === 'reset') {
      this.commands.length = this.cursor;
      this.commands.push(cmd);
      this.cursor++;
      this.refresh();
      return { ok: true, ids: [] };
    }
    const trial = this.build([...this.activeSpecs(), ...cmd.objects]);
    const existing = this.current.objects;
    const added: SceneObject[] = trial.objects.slice(existing.length);
    if (added.some((o) => o.value === null)) return { ok: false, reason: 'degenerate' };
    const seen: SceneObject[] = [...existing];
    for (const o of added) {
      const v = o.value;
      if (v && 'kind' in v) {
        for (const e of seen) {
          const ev = e.value;
          if (ev && 'kind' in ev && eqCurve(v, ev, trial.tol)) {
            return { ok: false, reason: 'duplicate', existingId: e.id };
          }
        }
      }
      seen.push(o);
    }
    this.commands.length = this.cursor;
    this.commands.push(cmd);
    this.cursor++;
    this.refresh();
    return { ok: true, ids: cmd.objects.map((o) => o.id) };
  }

  canUndo(): boolean {
    return this.cursor > 0;
  }

  canRedo(): boolean {
    return this.cursor < this.commands.length;
  }

  undo(): boolean {
    if (!this.canUndo()) return false;
    this.cursor--;
    this.refresh('undo');
    return true;
  }

  redo(): boolean {
    if (!this.canRedo()) return false;
    this.cursor++;
    this.refresh('redo');
    return true;
  }

  moves(): { L: number; E: number } {
    let L = 0;
    let E = 0;
    for (const s of this.activeAdds()) {
      if (s.def.type === 'line' || s.def.type === 'circle') {
        L += 1;
        E += 1;
      } else if (s.def.type === 'perp-bisector') {
        L += 1;
        E += 3;
      }
    }
    return { L, E };
  }

  specs(): ObjSpec[] {
    return this.activeSpecs();
  }

  lastChange(): Change {
    return { ...this.last, added: [...this.last.added], removed: [...this.last.removed] };
  }
}
