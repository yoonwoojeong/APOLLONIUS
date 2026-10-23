import { Construction } from '../construction/construction';
import { describe } from '../construction/describe';
import { evaluate } from '../construction/evaluate';
import type { ObjDef, ObjId, ObjSpec, Scene, SceneObject } from '../construction/types';
import { tooCloseCrossings } from '../levels/tappability';
import type { Level, ToolId } from '../levels/types';
import { frame } from '../levels/view';
import { isRobust, mulberry32 } from '../reasoning/robustness';
import { GIVEN_TYPES, LIMITS, problemPoints, SOLUTION_TYPES, type Problem } from './format';
import { sameValue, targetGoal } from './goal';

export type ValidationCode =
  | 'shape'
  | 'limit'
  | 'text'
  | 'id'
  | 'reference'
  | 'type'
  | 'tool'
  | 'degenerate'
  | 'target-given'
  | 'unsolved'
  | 'not-robust'
  | 'par'
  | 'untappable';

export interface ValidationError {
  code: ValidationCode;
  path: string;
  message: string;
}

export type ValidationResult =
  { ok: true; problem: Problem } | { ok: false; errors: ValidationError[] };

/** Fixed seed so validation is reproducible. */
const ROBUSTNESS_SEED = 1;
const ROBUSTNESS_TRIALS = 5;
/** Free choices (free points, points on curves) move by up to this share of the scene diameter. */
const FREE_SHIFT = 0.02;
/** …and points on circles by up to this many radians. */
const FREE_TURN = 0.05;

const ID_RE = /^[A-Za-z0-9_-]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
/**
 * Invisible or direction-changing characters: soft hyphen, Arabic letter mark, Mongolian vowel
 * separator, zero-width characters and direction marks, line/paragraph separators, bidi
 * embeddings/overrides/isolates, word joiner and invisible operators, BOM and tag characters.
 */
const INVISIBLE_RE =
  /[\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/u;
/** Untrusted text echoed in a message or path is cut to this many characters. */
const ECHO_MAX = 24;

/**
 * An untrusted value as a message or path shows it: at most 24 characters (then "…"), with
 * control, invisible and direction-changing characters spelled out as `\uXXXX`.
 */
export function echo(v: unknown): string {
  const s = String(v);
  // Only the head is looked at, so a huge string is never spread.
  const chars = [...s.slice(0, ECHO_MAX * 2 + 2)];
  const cut = chars.length > ECHO_MAX;
  return (
    chars
      .slice(0, ECHO_MAX)
      .map((ch) =>
        CONTROL_RE.test(ch) || INVISIBLE_RE.test(ch)
          ? `\\u${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
          : ch,
      )
      .join('') + (cut ? '…' : '')
  );
}
const TOOLS: readonly ToolId[] = ['point', 'line', 'circle', 'perp-bisector'];
const REQUIRED_TOOLS: readonly ToolId[] = ['point', 'line', 'circle'];

type Field = 'vec' | 'num' | 'id' | 'extent' | 'index';
/** Fields of every ObjDef type: the structural schema, and (`id` fields) its references. */
const DEF_FIELDS: Record<ObjDef['type'], Record<string, Field>> = {
  'given-point': { pos: 'vec' },
  'given-line': { a: 'id', b: 'id', extent: 'extent' },
  'given-circle': { c: 'vec', r: 'num' },
  'free-point': { pos: 'vec' },
  'on-curve': { curve: 'id', t: 'num' },
  intersection: { a: 'id', b: 'id', index: 'index' },
  line: { a: 'id', b: 'id' },
  circle: { center: 'id', through: 'id' },
  'perp-bisector': { a: 'id', b: 'id' },
};

const POINT_TYPES: readonly ObjDef['type'][] = [
  'given-point',
  'free-point',
  'on-curve',
  'intersection',
];

const TOP_REQUIRED = [
  'format',
  'version',
  'title',
  'goalText',
  'tools',
  'givens',
  'labels',
  'solution',
  'targets',
  'par',
];
const TOP_OPTIONAL = ['explain', 'author'];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const own = (o: object, k: PropertyKey): boolean => Object.hasOwn(o, k);
/** True if every index of the array is present (no holes). */
const dense = (a: unknown[]): boolean => {
  for (let i = 0; i < a.length; i++) if (!own(a, i)) return false;
  return true;
};
/**
 * Length in characters (code points). Strings far over `max` are not spread: anything longer
 * than `2 * max` UTF-16 units is over the limit anyway, so its unit count is returned instead.
 */
const len = (s: string, max: number): number => (s.length > max * 2 ? s.length : [...s].length);
/** The label the author gave `id`, if any (own properties only, never Object.prototype). */
const labelOf = (p: Problem, id: ObjId): string | undefined =>
  own(p.labels, id) ? p.labels[id] : undefined;

/** A specs entry with where it sits: `step` is the 0-based solution step, or null for givens. */
interface Located {
  spec: ObjSpec;
  path: string;
  step: number | null;
}

function located(p: Problem): Located[] {
  return [
    ...p.givens.map((spec, i) => ({ spec, path: `givens[${i}]`, step: null })),
    ...p.solution.flatMap((s, si) =>
      s.objects.map((spec, oi) => ({ spec, path: `solution[${si}].objects[${oi}]`, step: si })),
    ),
  ];
}

const allSpecs = (p: Problem): ObjSpec[] => [...p.givens, ...p.solution.flatMap((s) => s.objects)];

/** "Step 3" for solution objects, "Given A" for givens. */
function where(p: Problem, l: Located): string {
  return l.step === null
    ? `Given ${echo(labelOf(p, l.spec.id) ?? l.spec.id)}`
    : `Step ${l.step + 1}`;
}

// ---------------------------------------------------------------- 1. shape

function checkShape(input: unknown): ValidationError[] {
  const errs: ValidationError[] = [];
  const err = (path: string, message: string): void => {
    errs.push({ code: 'shape', path, message });
  };
  if (!isObj(input)) {
    err('', 'This is not a problem file: expected a JSON object.');
    return errs;
  }
  for (const k of Object.keys(input)) {
    if (!TOP_REQUIRED.includes(k) && !TOP_OPTIONAL.includes(k)) {
      err(echo(k), `Unknown field "${echo(k)}" — remove it.`);
    }
  }
  for (const k of TOP_REQUIRED) {
    if (!own(input, k)) err(k, `The field "${k}" is missing.`);
  }
  if (own(input, 'format') && input.format !== 'apollonius-problem') {
    err('format', 'This is not an Apollonius problem file (format must be "apollonius-problem").');
  }
  if (own(input, 'version') && input.version !== 1) {
    err(
      'version',
      'This problem was made by a newer version of Apollonius (only version 1 is supported).',
    );
  }
  for (const k of ['title', 'goalText', 'explain', 'author']) {
    if (own(input, k) && typeof input[k] !== 'string') err(k, `The ${k} must be text.`);
  }
  if (own(input, 'tools')) {
    const t = input.tools;
    if (!Array.isArray(t) || !dense(t) || !t.every((x) => typeof x === 'string')) {
      err('tools', 'The tools must be a list of tool names.');
    }
  }
  if (own(input, 'labels')) {
    const l = input.labels;
    if (!isObj(l) || !Object.values(l).every((x) => typeof x === 'string')) {
      err('labels', 'The labels must map object ids to text.');
    }
  }
  if (own(input, 'targets')) {
    const t = input.targets;
    if (!Array.isArray(t) || !dense(t) || !t.every((x) => typeof x === 'string')) {
      err('targets', 'The targets must be a list of object ids.');
    }
  }
  if (own(input, 'par')) {
    const par = input.par;
    const count = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 0;
    if (
      !isObj(par) ||
      Object.keys(par).length !== 2 ||
      !own(par, 'L') ||
      !own(par, 'E') ||
      !count(par.L) ||
      !count(par.E)
    ) {
      err('par', 'Par must be { "L": n, "E": n } with whole numbers of moves.');
    }
  }

  const spec = (v: unknown, path: string, name: string): void => {
    if (
      !isObj(v) ||
      Object.keys(v).length !== 2 ||
      !own(v, 'id') ||
      !own(v, 'def') ||
      typeof v.id !== 'string' ||
      !isObj(v.def)
    ) {
      err(path, `${name}: each object needs exactly an "id" and a "def".`);
      return;
    }
    const def = v.def;
    const fields =
      own(def, 'type') && typeof def.type === 'string' && own(DEF_FIELDS, def.type)
        ? DEF_FIELDS[def.type as ObjDef['type']]
        : undefined;
    if (!fields) {
      err(`${path}.def.type`, `${name}: unknown object type "${echo(def.type)}".`);
      return;
    }
    for (const k of Object.keys(def)) {
      if (k !== 'type' && !own(fields, k))
        err(`${path}.def.${echo(k)}`, `${name}: unknown field "${echo(k)}".`);
    }
    for (const [k, kind] of Object.entries(fields)) {
      const fv = own(def, k) ? def[k] : undefined;
      const fp = `${path}.def.${k}`;
      if (kind === 'vec') {
        if (!isObj(fv) || Object.keys(fv).length !== 2 || !own(fv, 'x') || !own(fv, 'y')) {
          err(fp, `${name}: "${k}" must be a position { "x", "y" }.`);
        } else {
          for (const c of ['x', 'y']) {
            if (!isFiniteNum(fv[c])) err(`${fp}.${c}`, `${name}: ${c} must be an ordinary number.`);
          }
        }
      } else if (kind === 'num' && !isFiniteNum(fv)) {
        err(fp, `${name}: "${k}" must be an ordinary number.`);
      } else if (kind === 'id' && typeof fv !== 'string') {
        err(fp, `${name}: "${k}" must be an object id.`);
      } else if (kind === 'extent' && fv !== 'line' && fv !== 'segment' && fv !== 'ray') {
        err(fp, `${name}: extent must be "line", "segment" or "ray".`);
      } else if (kind === 'index' && fv !== 0 && fv !== 1) {
        err(fp, `${name}: index must be 0 or 1.`);
      }
    }
  };

  if (own(input, 'givens')) {
    const g = input.givens;
    if (!Array.isArray(g) || !dense(g)) err('givens', 'The givens must be a list of objects.');
    else g.forEach((v, i) => spec(v, `givens[${i}]`, `Given ${i + 1}`));
  }
  if (own(input, 'solution')) {
    const s = input.solution;
    if (!Array.isArray(s) || !dense(s)) {
      err('solution', 'The solution must be a list of steps.');
    } else {
      s.forEach((step, si) => {
        const path = `solution[${si}]`;
        const name = `Step ${si + 1}`;
        if (
          !isObj(step) ||
          !Object.keys(step).every((k) => k === 'objects' || k === 'nudge') ||
          !own(step, 'objects') ||
          !Array.isArray(step.objects) ||
          !dense(step.objects) ||
          (own(step, 'nudge') && typeof step.nudge !== 'string')
        ) {
          err(path, `${name}: each step needs "objects" (a list) and optionally "nudge" (text).`);
          return;
        }
        step.objects.forEach((v, oi) => spec(v, `${path}.objects[${oi}]`, name));
      });
    }
  }
  return errs;
}

// ---------------------------------------------------------------- 2. limits and text

function checkLimits(p: Problem): ValidationError[] {
  const errs: ValidationError[] = [];
  const limit = (path: string, message: string): void => {
    errs.push({ code: 'limit', path, message });
  };
  const text = (
    path: string,
    name: string,
    s: string,
    min: number,
    max: number,
    unit = 'characters',
  ): void => {
    const n = len(s, max);
    if (n < min || n > max) {
      limit(
        path,
        min > 0
          ? `${name} must be ${min}–${max} ${unit} (it is ${n}).`
          : `${name} must be at most ${max} ${unit} (it is ${n}).`,
      );
    }
    if (s.includes('<') || s.includes('>')) {
      errs.push({ code: 'text', path, message: `${name} can't contain "<" or ">".` });
    }
    if (CONTROL_RE.test(s)) {
      errs.push({ code: 'text', path, message: `${name} can't contain line breaks or tabs.` });
    }
    if (INVISIBLE_RE.test(s)) {
      errs.push({
        code: 'text',
        path,
        message: `${name} can't contain invisible or direction-changing characters.`,
      });
    }
    if (s !== s.trim()) {
      errs.push({ code: 'text', path, message: `${name} can't start or end with spaces.` });
    }
  };

  const nGivens = p.givens.length;
  if (nGivens < LIMITS.givensMin || nGivens > LIMITS.givensMax) {
    limit(
      'givens',
      `A problem needs ${LIMITS.givensMin}–${LIMITS.givensMax} givens (it has ${nGivens}).`,
    );
  }
  const nObjects = p.solution.reduce((n, s) => n + s.objects.length, 0);
  if (nObjects < LIMITS.solutionMin || nObjects > LIMITS.solutionMax) {
    limit(
      'solution',
      `The solution needs ${LIMITS.solutionMin}–${LIMITS.solutionMax} objects (it has ${nObjects}).`,
    );
  }
  p.solution.forEach((s, i) => {
    if (s.objects.length === 0) limit(`solution[${i}].objects`, `Step ${i + 1} is empty.`);
  });
  const nTargets = p.targets.length;
  if (nTargets < LIMITS.targetsMin || nTargets > LIMITS.targetsMax) {
    limit(
      'targets',
      `Choose ${LIMITS.targetsMin}–${LIMITS.targetsMax} target objects (there are ${nTargets}).`,
    );
  }

  text('title', 'The title', p.title, LIMITS.titleMin, LIMITS.titleMax);
  text('goalText', 'The goal sentence', p.goalText, LIMITS.goalTextMin, LIMITS.goalTextMax);
  if (p.explain !== undefined) text('explain', 'The explanation', p.explain, 0, LIMITS.explainMax);
  if (p.author !== undefined) text('author', 'The author name', p.author, 0, LIMITS.authorMax);
  p.solution.forEach((s, i) =>
    text(`solution[${i}].nudge`, `Step ${i + 1}: the hint`, s.nudge, 0, LIMITS.nudgeMax),
  );
  for (const [id, label] of Object.entries(p.labels)) {
    text(`labels.${echo(id)}`, `The label of ${echo(id)}`, label, LIMITS.labelMin, LIMITS.labelMax);
  }

  const max = LIMITS.coordMax;
  for (const l of located(p)) {
    const d = l.spec.def;
    const name = where(p, l);
    const vec = (v: { x: number; y: number }, path: string): void => {
      if (Math.abs(v.x) > max || Math.abs(v.y) > max) {
        limit(path, `${name}: positions must stay within ±${max} (this one is at ${v.x}, ${v.y}).`);
      }
    };
    if (d.type === 'given-point' || d.type === 'free-point') vec(d.pos, `${l.path}.def.pos`);
    if (d.type === 'given-circle') {
      vec(d.c, `${l.path}.def.c`);
      if (Math.abs(d.r) > max)
        limit(`${l.path}.def.r`, `${name}: the radius must be at most ${max}.`);
    }
    if (d.type === 'on-curve' && Math.abs(d.t) > max) {
      limit(
        `${l.path}.def.t`,
        `${name}: the point's position on its curve must be within ±${max}.`,
      );
    }
  }
  return errs;
}

// ---------------------------------------------------------------- 3. references

function checkReferences(p: Problem): ValidationError[] {
  const errs: ValidationError[] = [];
  const err = (code: ValidationCode, path: string, message: string): void => {
    errs.push({ code, path, message });
  };
  const defined = new Map<ObjId, Located>();
  for (const l of located(p)) {
    const { id, def } = l.spec;
    const name = where(p, l);
    if (len(id, LIMITS.idMax) > LIMITS.idMax || !ID_RE.test(id)) {
      err(
        'id',
        `${l.path}.id`,
        `${name}: the id "${echo(id)}" must be 1–${LIMITS.idMax} letters, digits, "_" or "-".`,
      );
    } else if (id in Object.prototype) {
      err('id', `${l.path}.id`, `${name}: "${echo(id)}" is a reserved word — pick another id.`);
    } else if (defined.has(id)) {
      err('id', `${l.path}.id`, `${name}: the id "${echo(id)}" is used twice.`);
    }
    const allowed = l.step === null ? GIVEN_TYPES : SOLUTION_TYPES;
    if (!allowed.includes(def.type)) {
      err(
        'type',
        `${l.path}.def.type`,
        l.step === null
          ? `${name}: a given can't be a "${def.type}".`
          : `${name}: a "${def.type}" can't be built with the tools — use a free point instead.`,
      );
    }
    const fields = DEF_FIELDS[def.type];
    const d = def as unknown as Record<string, unknown>;
    for (const [k, kind] of Object.entries(fields)) {
      if (kind !== 'id') continue;
      const ref = d[k] as ObjId;
      const target = defined.get(ref);
      const fp = `${l.path}.def.${k}`;
      if (!target) {
        err('reference', fp, `${name}: it uses "${echo(ref)}", which isn't defined before it.`);
        continue;
      }
      const isPt = POINT_TYPES.includes(target.spec.def.type);
      const refName = echo(labelOf(p, ref) ?? ref);
      if (l.step === null) {
        if (target.spec.def.type !== 'given-point') {
          err('type', fp, `${name}: it must be built from given points, but ${refName} isn't one.`);
        }
      } else if (def.type === 'intersection' || def.type === 'on-curve') {
        if (isPt) err('type', fp, `${name}: ${refName} is a point, not a line or circle.`);
      } else if (!isPt) {
        err('type', fp, `${name}: ${refName} is a line or circle, not a point.`);
      }
    }
    if (!defined.has(id)) defined.set(id, l);
  }

  const seen = new Set<ObjId>();
  p.targets.forEach((id, i) => {
    const path = `targets[${i}]`;
    const l = defined.get(id);
    if (seen.has(id)) err('reference', path, `Target ${echo(id)} is listed twice.`);
    else if (!l) err('reference', path, `Target "${echo(id)}" isn't an object in the solution.`);
    else if (l.step === null) {
      err(
        'target-given',
        path,
        `Target ${echo(labelOf(p, id) ?? id)} is a given — the player would have nothing to construct.`,
      );
    }
    seen.add(id);
  });

  for (const id of Object.keys(p.labels)) {
    if (defined.get(id)?.step !== null) {
      err(
        'reference',
        `labels.${echo(id)}`,
        `There is a label for "${echo(id)}", which isn't a given.`,
      );
    }
  }
  return errs;
}

// ---------------------------------------------------------------- 4. tools

function checkTools(p: Problem): ValidationError[] {
  const errs: ValidationError[] = [];
  const err = (path: string, message: string): void => {
    errs.push({ code: 'tool', path, message });
  };
  const seen = new Set<string>();
  p.tools.forEach((t, i) => {
    if (!TOOLS.includes(t)) err(`tools[${i}]`, `Unknown tool "${echo(t)}".`);
    else if (seen.has(t)) err(`tools[${i}]`, `The tool "${t}" is listed twice.`);
    seen.add(t);
  });
  for (const t of REQUIRED_TOOLS) {
    if (!p.tools.includes(t)) err('tools', `The ${t} tool is always available — add "${t}".`);
  }
  if (!p.tools.includes('perp-bisector')) {
    p.solution.forEach((s, si) => {
      s.objects.forEach((o, oi) => {
        if (o.def.type === 'perp-bisector') {
          err(
            `solution[${si}].objects[${oi}]`,
            `Step ${si + 1}: uses Perpendicular Bisector, which this problem doesn't allow — allow the tool or build it from circles.`,
          );
        }
      });
    });
  }
  return errs;
}

// ---------------------------------------------------------------- 5. geometry

function sceneDiameterOf(p: Problem): number {
  const pts = problemPoints(p);
  return pts.length ? frame(pts).sceneDiameter : NaN;
}

const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

function whyNull(o: SceneObject, scene: Scene, refsOk: boolean): string {
  if (!refsOk) return "it is built from something that can't be drawn";
  switch (o.def.type) {
    case 'given-circle':
      return 'its radius must be more than 0';
    case 'intersection':
      return "those two curves don't cross there";
    default:
      return `${lower(describe(o, scene))} needs two different points`;
  }
}

/** Builds the solution step by step as the game would, so duplicates are rejected as in play. */
function replay(
  p: Problem,
  sceneDiameter: number,
): { c: Construction; failed?: number; existing?: ObjId } {
  const c = new Construction(p.givens, p.labels, sceneDiameter);
  for (let i = 0; i < p.solution.length; i++) {
    const r = c.apply({ type: 'add', objects: p.solution[i]?.objects ?? [] });
    if (!r.ok)
      return { c, failed: i, existing: r.reason === 'duplicate' ? r.existingId : undefined };
  }
  return { c };
}

/** True if the goal still holds when free points and points on curves move a little. */
function freeChoicesRobust(
  specs: ObjSpec[],
  scene: Scene,
  sceneDiameter: number,
  goal: (s: Scene) => unknown,
  rng: () => number,
): boolean {
  const free = specs.filter((s) => s.def.type === 'free-point' || s.def.type === 'on-curve');
  if (!free.length) return true;
  const signed = (max: number): number => (rng() < 0.5 ? -1 : 1) * max * (0.5 + 0.5 * rng());
  for (let i = 0; i < ROBUSTNESS_TRIALS; i++) {
    const overrides = new Map<ObjId, ObjDef>();
    for (const { id, def } of free) {
      if (def.type === 'free-point') {
        const len = FREE_SHIFT * sceneDiameter * (0.5 + 0.5 * rng());
        const ang = 2 * Math.PI * rng();
        overrides.set(id, {
          type: 'free-point',
          pos: { x: def.pos.x + len * Math.cos(ang), y: def.pos.y + len * Math.sin(ang) },
        });
      } else if (def.type === 'on-curve') {
        const v = scene.byId.get(def.curve)?.value;
        const circle = !!v && 'kind' in v && v.kind === 'circle';
        const dt = signed(circle ? FREE_TURN : FREE_SHIFT * sceneDiameter);
        overrides.set(id, { ...def, t: def.t + dt });
      }
    }
    const s = evaluate(specs, sceneDiameter, overrides);
    if (s.objects.some((o) => o.value === null) || goal(s) === null) return false;
  }
  return true;
}

function checkGeometry(p: Problem): ValidationError[] {
  const errs: ValidationError[] = [];
  const err = (code: ValidationCode, path: string, message: string): void => {
    errs.push({ code, path, message });
  };
  const D = sceneDiameterOf(p);
  if (!(D > 0) || !Number.isFinite(D)) {
    err('degenerate', 'givens', 'The givens all sit at one spot — spread them out.');
    return errs;
  }
  const specs = allSpecs(p);
  const scene = evaluate(specs, D);
  for (const o of scene.objects) o.label = labelOf(p, o.id);
  const locs = located(p);
  scene.objects.forEach((o, i) => {
    if (o.value !== null) return;
    const l = locs[i];
    if (!l) return;
    const refs = Object.entries(DEF_FIELDS[o.def.type])
      .filter(([, kind]) => kind === 'id')
      .map(([k]) => (o.def as unknown as Record<string, ObjId>)[k] ?? '');
    const refsOk = refs.every((r) => scene.byId.get(r)?.value);
    if (!refsOk && errs.length) return; // Report root causes, not everything built on them.
    err(
      'degenerate',
      l.path,
      `${where(p, l)}: this can't be drawn — ${whyNull(o, scene, refsOk)}.`,
    );
  });
  if (errs.length) return errs;

  const r = replay(p, D);
  if (r.failed !== undefined) {
    const n = r.failed + 1;
    const labelled = r.c.scene();
    const existing = r.existing ? labelled.byId.get(r.existing) : undefined;
    err(
      'degenerate',
      `solution[${r.failed}]`,
      existing
        ? `Step ${n}: ${lower(describe(existing, labelled))} is already on the board — remove the step.`
        : `Step ${n}: this can't be drawn.`,
    );
    return errs;
  }

  const solution = p.solution.flatMap((s) => s.objects);
  const name = (id: ObjId): string => r.c.scene().byId.get(id)?.label ?? labelOf(p, id) ?? id;
  p.targets.forEach((id, i) => {
    const v = scene.byId.get(id)?.value ?? null;
    const g = p.givens.find((gv) => sameValue(v, scene.byId.get(gv.id)?.value ?? null, scene.tol));
    if (g) {
      err(
        'target-given',
        `targets[${i}]`,
        `Target ${name(id)} is the same as the given ${name(g.id)} — the player would have nothing to construct.`,
      );
    }
  });
  if (errs.length) return errs;

  const goal = targetGoal(p.givens, solution, p.targets, D);
  if (goal(scene) === null) {
    let message = "The solution doesn't produce every target as a separate object.";
    for (let i = 0; i < p.targets.length; i++) {
      for (let j = i + 1; j < p.targets.length; j++) {
        const a = p.targets[i] as ObjId;
        const b = p.targets[j] as ObjId;
        const va = scene.byId.get(a)?.value ?? null;
        if (sameValue(va, scene.byId.get(b)?.value ?? null, scene.tol)) {
          message = `Targets ${name(a)} and ${name(b)} are the same — keep only one of them.`;
        }
      }
    }
    err('unsolved', 'targets', message);
    return errs;
  }

  // isRobust reads only givens, sceneDiameter and goal.
  const level = { givens: p.givens, sceneDiameter: D, goal } as Pick<
    Level,
    'givens' | 'sceneDiameter' | 'goal'
  > as Level;
  const rng = mulberry32(ROBUSTNESS_SEED);
  if (!isRobust(level, specs, rng, ROBUSTNESS_TRIALS)) {
    err(
      'not-robust',
      'solution',
      'The solution only works for this exact picture — when the givens move a little, it no longer makes the targets.',
    );
  } else if (!freeChoicesRobust(specs, scene, D, goal, rng)) {
    err(
      'not-robust',
      'solution',
      'The solution depends on exactly where a free point was placed — build the targets from the givens instead.',
    );
  }
  return errs;
}

// ---------------------------------------------------------------- 6. par

/** L/E cost of the solution, counted by replaying it as game moves (points are free). */
export function solutionMoves(p: Problem): { L: number; E: number } {
  return replay(p, sceneDiameterOf(p)).c.moves();
}

function checkPar(p: Problem): ValidationError[] {
  const errs: ValidationError[] = [];
  const m = solutionMoves(p);
  if (p.par.L < m.L) {
    errs.push({
      code: 'par',
      path: 'par.L',
      message: `Par L is ${p.par.L}, but your solution draws ${m.L} lines and circles — set it to at least ${m.L}.`,
    });
  }
  if (p.par.E < m.E) {
    errs.push({
      code: 'par',
      path: 'par.E',
      message: `Par E is ${p.par.E}, but your solution takes ${m.E} elementary moves — set it to at least ${m.E}.`,
    });
  }
  return errs;
}

// ---------------------------------------------------------------- 7. tappability

function checkTappability(p: Problem): ValidationError[] {
  const pts = problemPoints(p);
  const { view, sceneDiameter } = frame(pts);
  const labelled = replay(p, sceneDiameter).c.scene();
  const issues = tooCloseCrossings(
    p.givens,
    p.solution.map((s) => s.objects),
    view,
  );
  return issues.map((issue) => {
    const near = labelled.byId.get(issue.nearId);
    const nearName = near?.label ?? labelOf(p, issue.nearId) ?? issue.nearId;
    const movable = near?.def.type === 'given-point' || near?.def.type === 'free-point';
    return {
      code: 'untappable' as const,
      path: `solution[${issue.stepIndex}]`,
      message: `Step ${issue.stepIndex + 1}: the crossing is too close to point ${nearName} to tap on a phone — ${
        movable ? `move ${nearName} or pick` : 'pick'
      } another construction.`,
    };
  });
}

// ---------------------------------------------------------------- entry point

/**
 * The single gate for user-authored problems. Rules run in the spec's order and a phase's
 * errors stop the later phases, so geometry rules only ever see well-formed, finite input.
 */
export function validate(input: unknown): ValidationResult {
  try {
    const shape = checkShape(input);
    if (shape.length) return { ok: false, errors: shape };
    const raw = input as Problem;
    // A step's nudge may be left out of a file; it means "no hint".
    const p: Problem = {
      ...raw,
      solution: raw.solution.map((s) => ({ objects: s.objects, nudge: s.nudge ?? '' })),
    };
    const phases = [
      checkLimits,
      checkReferences,
      checkTools,
      checkGeometry,
      checkPar,
      checkTappability,
    ];
    for (const phase of phases) {
      const errors = phase(p);
      if (errors.length) return { ok: false, errors };
    }
    return { ok: true, problem: p };
  } catch {
    return {
      ok: false,
      errors: [{ code: 'shape', path: '', message: "This file isn't a valid problem." }],
    };
  }
}
