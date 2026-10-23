import type { ComponentChildren } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { openEditor } from '../editor/session';
import { loadDrafts, newDraft, saveDrafts, type Draft } from '../problems/drafts';
import type { Problem } from '../problems/format';
import { isTested, problemHash } from '../problems/hash';
import { exportProblem, importProblemFile } from '../problems/io';
import { toLevel } from '../problems/load';
import {
  clearUnsaved,
  hasUnsavedDrafts,
  markUnsaved,
  saveHasFailed,
  withUnsaved,
} from '../problems/unsaved';
import { echo, validate } from '../problems/validate';
import { mergeStars, type Stars } from '../reasoning/stars';
import type { Store } from '../state/store';
import {
  BackIcon,
  CopyIcon,
  DownloadIcon,
  PlayIcon,
  PlusIcon,
  STAR_PATH,
  TrashIcon,
  UploadIcon,
} from './icons';
import './screens.css';
import './problems.css';

interface Props {
  store: Store;
  storage: Storage | null;
}

type Status = 'Draft' | 'Valid' | 'Tested';

interface Row {
  draft: Draft;
  /** The validated problem, or null while the draft does not pass validation. */
  problem: Problem | null;
  status: Status;
  /** The display title (`Untitled` when empty). */
  name: string;
}

export const TOAST_MS = 5000;
const SAVE_WARNING = "Couldn't save drafts on this device.";
export const EXPORT_INVALID_NOTE =
  "This problem isn't valid yet — the file won't import until it passes the checks.";
const TITLE_MAX = 40;
/** Errors shown in the import dialog before "and N more". */
const ERRORS_SHOWN = 8;

/** Rows by draft object: validation replays the geometry, so each draft is checked once. */
const rows = new WeakMap<Draft, Row>();
function rowOf(draft: Draft): Row {
  let row = rows.get(draft);
  if (!row) {
    const v = validate(draft.problem);
    const problem = v.ok ? v.problem : null;
    // Hashed exactly as the editor hashes it (the stored draft problem), via the shared helper.
    const status: Status = !problem
      ? 'Draft'
      : isTested(draft.testedHash, draft.problem)
        ? 'Tested'
        : 'Valid';
    const title = typeof draft.problem.title === 'string' ? draft.problem.title.trim() : '';
    row = { draft, problem, status, name: title || 'Untitled' };
    rows.set(draft, row);
  }
  return row;
}

const newestFirst = (a: Draft, b: Draft): number =>
  b.updatedAt - a.updatedAt || b.createdAt - a.createdAt;

/**
 * Records a Play's stars on the stored draft; progress is never touched. Stars belong to the
 * problem they were earned on (its `testedHash`): a Play of the tested problem keeps the best,
 * and a Play of an untested one — which plays it to completion — marks it tested afresh.
 */
function saveStars(store: Store, storage: Storage | null, localId: string, s: Stars): void {
  const all = withUnsaved(store, loadDrafts(storage));
  const i = all.findIndex((d) => d.localId === localId);
  if (i < 0) return;
  const d = all[i]!;
  const same = isTested(d.testedHash, d.problem);
  all[i] = {
    ...d,
    testedHash: same ? d.testedHash! : problemHash(d.problem as Problem),
    stars: same && d.stars ? mergeStars(d.stars, s) : s,
  };
  if (saveDrafts(storage, all)) clearUnsaved(store);
  else markUnsaved(store, all[i]);
}

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const copyTitle = (title: string): string => {
  const suffix = ' (copy)';
  return title ? `${title.slice(0, TITLE_MAX - suffix.length).trimEnd()}${suffix}` : '';
};

/** Typing targets keep their own Ctrl/Cmd+Z. */
const isTextField = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement &&
  (t.isContentEditable ||
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT');

interface Notice {
  key: number;
  text: string;
}

/** A delete that Undo can still take back. */
interface Pending {
  draft: Draft;
  /** Its index in the stored list when it was deleted. */
  at: number;
  /** The card that took its place on screen (focus returns there), if any. */
  neighbour: string | null;
  name: string;
}

interface ImportError {
  file: string;
  errors: { path: string; message: string }[];
}

/**
 * My problems (§6): the author's drafts on this device, newest first, with New, Open, Play,
 * Duplicate, Delete (with an undo toast), Export and Import.
 */
export function ProblemsScreen({ store, storage }: Props) {
  // Read on every mount, so returning from the editor or a Play shows what was saved there.
  // Drafts the editor could not save are kept in memory and listed too.
  const [drafts, setDrafts] = useState<Draft[]>(() => withUnsaved(store, loadDrafts(storage)));
  /** The latest list, for handlers that run after a later render (Undo, an import). */
  const current = useRef(drafts);
  current.current = drafts;
  const [saveFailed, setSaveFailed] = useState(() => saveHasFailed(store));
  const failedRef = useRef(saveFailed);
  failedRef.current = saveFailed;
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  /** Bumped on every delete, so the undo toast's 5 s start again. */
  const [undoKey, setUndoKey] = useState(0);
  const [importError, setImportError] = useState<ImportError | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** A selector to focus after the next render (actions that add or remove cards). */
  const focusNext = useRef<string | null>(null);
  const noticeKey = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    // Kept drafts are tried again; while that fails they stay kept (and the warning stays).
    if (!hasUnsavedDrafts(store) || saveDrafts(storage, current.current)) clearUnsaved(store);
    else setSaveFailed(true);
    mounted.current = true;
    return () => void (mounted.current = false);
  }, [store]);

  useLayoutEffect(() => {
    const sel = focusNext.current;
    if (!sel) return;
    focusNext.current = null;
    document.querySelector<HTMLElement>(sel)?.focus();
  });

  const sorted = [...drafts].sort(newestFirst).map(rowOf);

  const commit = (next: Draft[]): void => {
    current.current = next;
    setDrafts(next);
    const ok = saveDrafts(storage, next);
    // Everything listed (kept drafts too) is on the device now.
    if (ok) clearUnsaved(store);
    setSaveFailed(!ok);
  };
  const showNotice = (text: string): void => setNotice({ key: ++noticeKey.current, text });
  const openSel = (localId: string): string => `[data-open="${localId}"]`;
  /** Where focus goes when the undo toast closes under it: the neighbour, a card, the heading. */
  const afterToastSel = (neighbour: string | null): string => {
    const ids = new Set(current.current.map((d) => d.localId));
    if (neighbour && ids.has(neighbour)) return openSel(neighbour);
    return ids.size ? '.pb-open' : '.pb-title';
  };

  const create = (): void => {
    openEditor(store, storage, newDraft(Date.now(), Math.random));
  };

  const open = (d: Draft): void => {
    openEditor(store, storage, d);
  };

  const play = (row: Row): void => {
    if (!row.problem) return;
    const { localId } = row.draft;
    store.openCustomLevel(toLevel(structuredClone(row.problem), `problem:${localId}`), {
      onComplete: (s) => saveStars(store, storage, localId, s),
      onExit: () => store.closeCustomLevel('problems'),
    });
  };

  const duplicate = (row: Row): void => {
    const fresh = newDraft(Date.now(), Math.random);
    const problem = structuredClone(row.draft.problem);
    if (typeof problem.title === 'string') problem.title = copyTitle(problem.title.trim());
    const copy: Draft = { ...fresh, problem };
    commit([...current.current, copy]);
    focusNext.current = openSel(copy.localId);
    showNotice(`Made a copy of “${row.name}”.`);
  };

  /** Deletes at once; Undo (button or Ctrl/Cmd+Z) brings back every pending delete. */
  const remove = (row: Row, byKeyboard: boolean): void => {
    const list = current.current;
    const at = list.indexOf(row.draft);
    const pos = sorted.indexOf(row);
    const neighbour = (sorted[pos + 1] ?? sorted[pos - 1])?.draft.localId ?? null;
    commit(list.filter((d) => d !== row.draft));
    setPending((p) => [...p, { draft: row.draft, at, neighbour, name: row.name }]);
    setUndoKey((k) => k + 1);
    // Keyboard users go straight to Undo (it holds the toast while focused); pointer users stay
    // in the list, on the card that took this one's place.
    focusNext.current = byKeyboard ? '[data-undo]' : neighbour ? openSel(neighbour) : '[data-new]';
  };

  const undoAll = (): void => {
    const stack = pendingRef.current;
    if (!stack.length) return;
    const restored = [...current.current];
    for (const p of [...stack].reverse()) {
      if (restored.some((d) => d.localId === p.draft.localId)) continue;
      restored.splice(Math.min(p.at, restored.length), 0, p.draft);
    }
    pendingRef.current = [];
    setPending([]);
    focusNext.current = openSel(stack[stack.length - 1]!.draft.localId);
    commit(restored);
  };

  /** The undo toast timed out or was dismissed: the deletes stand. */
  const closeUndo = (focusWasInside: boolean): void => {
    const stack = pendingRef.current;
    if (focusWasInside)
      focusNext.current = afterToastSel(stack[stack.length - 1]?.neighbour ?? null);
    pendingRef.current = [];
    setPending([]);
  };

  useEffect(() => {
    if (!pending.length) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) {
        return;
      }
      if (isTextField(e.target) || importError) return;
      e.preventDefault();
      undoAll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending.length > 0, importError]);

  const exportRow = (row: Row): void => {
    const { filename, text } = exportProblem(row.problem ?? row.draft.problem);
    download(filename, text);
    if (!row.problem) showNotice(EXPORT_INVALID_NOTE);
  };

  const onFile = async (e: Event): Promise<void> => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Cleared at once, so picking the same file again still fires a change.
    input.value = '';
    if (!file) return;
    const r = await importProblemFile(file);
    if (!r.ok) {
      if (!mounted.current) return;
      const seen = new Set<string>();
      const errors = r.errors.filter((x) => {
        const k = `${x.path}\u0000${x.message}`;
        return !seen.has(k) && !!seen.add(k);
      });
      const name = (file as Partial<File>).name;
      setImportError({ file: name === undefined ? 'this file' : echo(name), errors });
      return;
    }
    const d: Draft = { ...newDraft(Date.now(), Math.random), problem: r.problem };
    // Appended to what is stored now: the list may have changed while the file was read.
    // (After a failed save the stored list is stale, so the screen's own list is the truth.)
    const base = storage && !failedRef.current ? loadDrafts(storage) : current.current;
    const next = [...base, d];
    const ok = saveDrafts(storage, next);
    if (!mounted.current) {
      if (!ok) markUnsaved(store, d);
      return;
    }
    current.current = next;
    setDrafts(next);
    setSaveFailed(!ok);
    focusNext.current = openSel(d.localId);
    showNotice(`Imported “${r.problem.title}”.`);
  };

  const closeImportError = (): void => {
    setImportError(null);
    // After the render, once the rest of the page is no longer inert.
    focusNext.current = '[data-import]';
  };

  const n = drafts.length;
  const actions = (
    <div class="pb-actions">
      <button type="button" class="btn is-primary" data-new onClick={create}>
        <PlusIcon />
        New problem
      </button>
      <button type="button" class="btn" data-import onClick={() => fileInput.current?.click()}>
        <UploadIcon />
        Import
      </button>
    </div>
  );
  const undoText =
    pending.length === 1 ? `Deleted “${pending[0]!.name}”.` : `Deleted ${pending.length} problems.`;

  return (
    <>
      <main class="pb">
        <header class="pb-head">
          <button
            type="button"
            class="icon-btn pb-back"
            aria-label="Back to levels"
            title="Levels"
            onClick={() => store.goToMap()}
          >
            <BackIcon />
          </button>
          <div class="pb-head-text">
            <h1 class="pb-title" tabIndex={-1}>
              My problems
            </h1>
            <p class="pb-summary">
              {n === 0 ? 'Puzzles you make' : `${n} ${n === 1 ? 'problem' : 'problems'}`} · saved on
              this device
            </p>
          </div>
        </header>

        <p class="pb-save-warn" role="status">
          {saveFailed ? SAVE_WARNING : ''}
        </p>

        <div class="pb-body">
          {n > 0 && actions}
          {n === 0 ? (
            <section class="pb-empty" aria-labelledby="pb-empty-title">
              <EmptyFigure />
              <h2 id="pb-empty-title" class="pb-empty-title">
                No problems yet
              </h2>
              <p class="pb-empty-text">
                Set up a figure, construct its solution, and play it — or import a problem someone
                shared with you.
              </p>
              {actions}
            </section>
          ) : (
            <ul class="pb-list">
              {sorted.map((row) => (
                <ProblemCard
                  key={row.draft.localId}
                  row={row}
                  onOpen={() => open(row.draft)}
                  onPlay={() => play(row)}
                  onDuplicate={() => duplicate(row)}
                  onExport={() => exportRow(row)}
                  onDelete={(byKeyboard) => remove(row, byKeyboard)}
                />
              ))}
            </ul>
          )}
          <p class="pb-note">Uploading to the public gallery is coming</p>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept=".json"
          class="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void onFile(e)}
        />
      </main>

      {/* Always mounted, so each toast is announced. */}
      <div class="pb-toast-region" aria-live="polite">
        {notice && (
          <ToastItem key={`n${notice.key}`} text={notice.text} onClose={() => setNotice(null)} />
        )}
        {pending.length > 0 && (
          <ToastItem
            key={`u${undoKey}`}
            text={undoText}
            onClose={closeUndo}
            action={{ label: 'Undo', run: undoAll }}
          />
        )}
      </div>

      {importError && (
        <Dialog
          title="Couldn't import this file"
          onClose={closeImportError}
          description={
            <>
              Nothing was imported from <span class="pb-file">{importError.file}</span>:
            </>
          }
        >
          <ul class="pb-errors">
            {importError.errors.slice(0, ERRORS_SHOWN).map((x) => (
              <li key={`${x.path}\u0000${x.message}`}>
                {x.path && <span class="pb-err-path">{x.path}</span>}
                {x.message}
              </li>
            ))}
          </ul>
          {importError.errors.length > ERRORS_SHOWN && (
            <p class="pb-errors-more">…and {importError.errors.length - ERRORS_SHOWN} more.</p>
          )}
        </Dialog>
      )}
    </>
  );
}

function ProblemCard(p: {
  row: Row;
  onOpen: () => void;
  onPlay: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  /** `byKeyboard`: the press came from Enter/Space (a click with no pointer detail). */
  onDelete: (byKeyboard: boolean) => void;
}) {
  const { row } = p;
  const { draft, name, status } = row;
  const titleId = useId();
  const goal = typeof draft.problem.goalText === 'string' ? draft.problem.goalText.trim() : '';
  const stars = draft.stars;
  const earned = stars?.filter(Boolean).length ?? 0;
  const q = `“${name}”`;
  return (
    <li class="pb-card" aria-labelledby={titleId}>
      <div class="pb-card-head">
        <h2
          id={titleId}
          class={name === 'Untitled' ? 'pb-card-title is-untitled' : 'pb-card-title'}
        >
          {name}
        </h2>
        {/* Stars belong to the tested problem; once it changes they no longer apply. */}
        {stars && status === 'Tested' && (
          <span class="pb-stars" role="img" aria-label={`${earned} of 3 stars`}>
            {stars.map((s, k) => (
              <svg key={k} class="pb-star" data-earned={String(s)} viewBox="0 0 24 24">
                <path d={STAR_PATH} />
              </svg>
            ))}
          </span>
        )}
      </div>
      <p class="pb-card-meta">
        <span class="pb-status" data-status={status.toLowerCase()}>
          {status}
          {status === 'Tested' && <span aria-hidden="true"> ✓</span>}
        </span>
        {goal && <span class="pb-goal">{goal}</span>}
      </p>
      <div class="pb-card-actions">
        <button
          type="button"
          class="btn pb-open"
          data-open={draft.localId}
          aria-label={`Open ${q}`}
          onClick={p.onOpen}
        >
          Open
        </button>
        {row.problem && (
          <button type="button" class="btn pb-play" aria-label={`Play ${q}`} onClick={p.onPlay}>
            <PlayIcon />
            Play
          </button>
        )}
        <span class="pb-card-tools">
          <IconButton label={`Duplicate ${q}`} tip="Duplicate" onClick={p.onDuplicate}>
            <CopyIcon />
          </IconButton>
          <IconButton label={`Export ${q}`} tip="Export file" onClick={p.onExport}>
            <DownloadIcon />
          </IconButton>
          <IconButton
            label={`Delete ${q}`}
            tip="Delete"
            onClick={(e) => p.onDelete(e.detail === 0)}
            danger
          >
            <TrashIcon />
          </IconButton>
        </span>
      </div>
    </li>
  );
}

function IconButton(p: {
  label: string;
  tip: string;
  onClick: (e: MouseEvent) => void;
  danger?: boolean;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      class={p.danger ? 'icon-btn pb-icon is-danger' : 'icon-btn pb-icon'}
      aria-label={p.label}
      title={p.tip}
      onClick={p.onClick}
    >
      {p.children}
    </button>
  );
}

/** A compass figure for the empty list: a circle through a point, its centre, a ghost line. */
function EmptyFigure() {
  return (
    <svg class="pb-empty-figure" viewBox="0 0 160 96" aria-hidden="true">
      <path class="pb-fig-ghost" d="M6 78 154 30" />
      <circle class="pb-fig-circle draw-in" cx="66" cy="50" r="34" pathLength={1} />
      <circle class="pb-fig-point" cx="66" cy="50" r="3" />
      <circle class="pb-fig-point pop-in" cx="98" cy="38.5" r="3" />
    </svg>
  );
}

/**
 * One toast. It closes after 5 s; hovering or focusing it holds it, and leaving starts the 5 s
 * again. Esc dismisses it. `onClose` is told whether focus was inside it.
 */
function ToastItem(p: {
  text: string;
  onClose: (focusWasInside: boolean) => void;
  action?: { label: string; run: () => void };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const close = (): void => p.onClose(!!ref.current?.contains(document.activeElement));
  useEffect(() => {
    if (hovered || focused) return;
    const t = setTimeout(close, TOAST_MS);
    return () => clearTimeout(t);
  }, [hovered, focused]);
  return (
    <div
      ref={ref}
      class="pb-toast"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusIn={() => setFocused(true)}
      onFocusOut={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      }}
    >
      <span class="pb-toast-text">{p.text}</span>
      {p.action && (
        <button type="button" class="btn pb-toast-action" data-undo onClick={p.action.run}>
          {p.action.label}
        </button>
      )}
    </div>
  );
}

/** Marks everything outside `el` inert (each ancestor's other children); returns the undo. */
function inertOutside(el: HTMLElement): () => void {
  const marked: Element[] = [];
  for (
    let node: HTMLElement | null = el;
    node && node !== document.body;
    node = node.parentElement
  ) {
    for (const sib of node.parentElement?.children ?? []) {
      if (sib === node || sib.hasAttribute('inert')) continue;
      sib.setAttribute('inert', '');
      marked.push(sib);
    }
  }
  return () => marked.forEach((m) => m.removeAttribute('inert'));
}

/**
 * A small modal dialog: the rest of the page goes inert, focus moves in, Tab stays inside, and
 * Esc or the scrim closes it.
 */
function Dialog(p: {
  title: string;
  description: ComponentChildren;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const scrim = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const ok = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();
  useLayoutEffect(() => {
    const restore = scrim.current ? inertOutside(scrim.current) : () => {};
    ok.current?.focus();
    return restore;
  }, []);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      p.onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('button, [tabindex="0"]') ?? [])];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div ref={scrim} class="pb-scrim" onClick={(e) => e.target === e.currentTarget && p.onClose()}>
      <div
        ref={ref}
        class="pb-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={onKey}
      >
        <h2 id={titleId} class="pb-dialog-title">
          {p.title}
        </h2>
        <p id={descId} class="pb-dialog-text">
          {p.description}
        </p>
        <div class="pb-dialog-body" tabIndex={0}>
          {p.children}
        </div>
        <div class="pb-dialog-actions">
          <button ref={ok} type="button" class="btn is-primary" onClick={p.onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
