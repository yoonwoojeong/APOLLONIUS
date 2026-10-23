import type { Stars } from '../reasoning/stars';
import type { Problem } from './format';

export type DraftProblem = { format: 'apollonius-problem'; version: 1 } & Partial<
  Omit<Problem, 'format' | 'version'>
>;

export interface Draft {
  localId: string;
  createdAt: number;
  updatedAt: number;
  problem: DraftProblem;
  testedHash?: string;
  stars?: Stars;
}

export const DRAFTS_KEY = 'apollonius:problems:v1';

const has = (o: object, k: string): boolean => Object.hasOwn(o, k);
const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Own-property read; undefined when the key is absent. */
const own = (o: Record<string, unknown>, k: string): unknown => (has(o, k) ? o[k] : undefined);

function parseDraft(raw: unknown): Draft | null {
  if (!isObj(raw)) return null;
  const localId = own(raw, 'localId');
  const createdAt = own(raw, 'createdAt');
  const updatedAt = own(raw, 'updatedAt');
  const problem = own(raw, 'problem');
  const testedHash = own(raw, 'testedHash');
  const stars = own(raw, 'stars');
  if (typeof localId !== 'string' || !num(createdAt) || !num(updatedAt)) return null;
  if (!isObj(problem)) return null;
  if (own(problem, 'format') !== 'apollonius-problem' || own(problem, 'version') !== 1) {
    return null;
  }
  if (testedHash !== undefined && typeof testedHash !== 'string') return null;
  if (
    stars !== undefined &&
    !(Array.isArray(stars) && stars.length === 3 && stars.every((s) => typeof s === 'boolean'))
  ) {
    return null;
  }
  const d: Draft = { localId, createdAt, updatedAt, problem: problem as DraftProblem };
  if (testedHash !== undefined) d.testedHash = testedHash;
  if (stars !== undefined) d.stars = stars as Stars;
  return d;
}

export function loadDrafts(storage: Pick<Storage, 'getItem'> | null): Draft[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(DRAFTS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isObj(parsed) || own(parsed, 'version') !== 1 || !Array.isArray(own(parsed, 'drafts'))) {
      console.warn('apollonius: saved drafts have an unknown version or shape, discarding');
      return [];
    }
    const out: Draft[] = [];
    for (const item of own(parsed, 'drafts') as unknown[]) {
      const d = parseDraft(item);
      if (d) out.push(d);
      else console.warn('apollonius: discarding a malformed saved draft');
    }
    return out;
  } catch (e) {
    console.warn('apollonius: could not read saved drafts, discarding', e);
    return [];
  }
}

export function saveDrafts(storage: Pick<Storage, 'setItem'> | null, drafts: Draft[]): boolean {
  if (!storage) return false;
  try {
    storage.setItem(DRAFTS_KEY, JSON.stringify({ version: 1, drafts }));
    return true;
  } catch {
    return false;
  }
}

const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

export function newDraft(now: number, rand: () => number): Draft {
  let localId = '';
  for (let i = 0; i < 10; i++) {
    const n = Math.min(35, Math.max(0, Math.floor(rand() * 36)));
    localId += ID_CHARS[n];
  }
  return {
    localId,
    createdAt: now,
    updatedAt: now,
    problem: {
      format: 'apollonius-problem',
      version: 1,
      title: '',
      goalText: '',
      tools: ['point', 'line', 'circle'],
      givens: [],
      labels: {},
      solution: [],
      targets: [],
    },
  };
}

export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return s === '' ? 'problem' : s;
}
