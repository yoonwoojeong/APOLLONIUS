import type { Draft } from './drafts';

/**
 * What could not be written to this device, per session (keyed by the game store); in memory
 * only. `failed` makes My problems show its warning; `drafts` are edits the editor could not
 * save, kept so My problems can still list them (and save them with its next write).
 */
interface Unsaved {
  failed: boolean;
  drafts: Map<string, Draft>;
}

const bySession = new WeakMap<object, Unsaved>();

const of = (session: object): Unsaved => {
  let u = bySession.get(session);
  if (!u) bySession.set(session, (u = { failed: false, drafts: new Map() }));
  return u;
};

/** A save failed; with a draft, that draft's latest state is kept in memory. */
export function markUnsaved(session: object, draft?: Draft): void {
  const u = of(session);
  u.failed = true;
  if (draft) u.drafts.set(draft.localId, draft);
}

/** A draft was saved after all: it no longer needs keeping (nor, if it was the last, warning). */
export function markSaved(session: object, localId: string): void {
  const u = bySession.get(session);
  if (!u) return;
  u.drafts.delete(localId);
  if (!u.drafts.size) u.failed = false;
}

/** Whether a save failed since the last `clearUnsaved`. */
export const saveHasFailed = (session: object): boolean => !!bySession.get(session)?.failed;

/** Whether drafts the editor could not save are being kept. */
export const hasUnsavedDrafts = (session: object): boolean => !!bySession.get(session)?.drafts.size;

/** `stored` with every kept draft in place of (or after) its stored copy. */
export function withUnsaved(session: object, stored: Draft[]): Draft[] {
  const kept = bySession.get(session)?.drafts;
  if (!kept?.size) return stored;
  const out = stored.map((d) => kept.get(d.localId) ?? d);
  for (const d of kept.values()) if (!stored.some((s) => s.localId === d.localId)) out.push(d);
  return out;
}

/** Everything is on the device now (or the warning has been shown and nothing is kept). */
export function clearUnsaved(session: object, drafts = true): void {
  const u = bySession.get(session);
  if (!u) return;
  u.failed = false;
  if (drafts) u.drafts.clear();
}
