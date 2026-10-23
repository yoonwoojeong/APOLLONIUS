import type { ComponentChildren } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { openEditor } from '../editor/session';
import { loadDrafts, newDraft, saveDrafts, type Draft } from '../problems/drafts';
import type { Problem } from '../problems/format';
import { problemHash } from '../problems/hash';
import { exportProblem, importProblemFile } from '../problems/io';
import { toLevel } from '../problems/load';
import { validate } from '../problems/validate';
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
    const status: Status = !problem
      ? 'Draft'
      : draft.testedHash !== undefined && draft.testedHash === problemHash(problem)
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

/** Stores whose last Play could not save its stars (the screen was closed at the time). */
const playUnsaved = new WeakSet<Store>();

/** Merges a Play's stars into the stored draft; progress is never touched. */
function saveStars(store: Store, storage: Storage | null, localId: string, s: Stars): void {
  const all = loadDrafts(storage);
  const i = all.findIndex((d) => d.localId === localId);
  if (i < 0) return;
  const old = all[i]!.stars;
  all[i] = { ...all[i]!, stars: old ? mergeStars(old, s) : s };
  if (!saveDrafts(storage, all)) playUnsaved.add(store);
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

interface Toast {
  key: number;
  text: string;
  undo?: () => void;
}

interface ImportError {
  file: string;
  messages: string[];
}

/**
 * My problems (§6): the author's drafts on this device, newest first, with New, Open, Play,
 * Duplicate, Delete (with an undo toast), Export and Import.
 */
export function ProblemsScreen({ store, storage }: Props) {
  // Read on every mount, so returning from the editor or a Play shows what was saved there.
  const [drafts, setDrafts] = useState<Draft[]>(() => loadDrafts(storage));
  /** The latest list, for handlers that run after a later render (Undo, an import). */
  const current = useRef(drafts);
  current.current = drafts;
  const [saveFailed, setSaveFailed] = useState(() => playUnsaved.has(store));
  const [toast, setToast] = useState<Toast | null>(null);
  const [importError, setImportError] = useState<ImportError | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importBtn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  /** A selector to focus after the next render (actions that add or remove cards). */
  const focusNext = useRef<string | null>(null);
  const toastKey = useRef(0);

  useEffect(() => {
    playUnsaved.delete(store);
  }, [store]);

  useLayoutEffect(() => {
    const sel = focusNext.current;
    if (!sel) return;
    focusNext.current = null;
    list.current?.querySelector<HTMLElement>(sel)?.focus({ preventScroll: false });
  });

  const sorted = [...drafts].sort(newestFirst).map(rowOf);

  const commit = (next: Draft[]): void => {
    current.current = next;
    setDrafts(next);
    setSaveFailed(!saveDrafts(storage, next));
  };
  const showToast = (text: string, undo?: () => void): void =>
    setToast({ key: ++toastKey.current, text, ...(undo ? { undo } : {}) });
  const openSel = (localId: string): string => `[data-open="${localId}"]`;

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
    const now = Date.now();
    const fresh = newDraft(now, Math.random);
    const problem = structuredClone(row.draft.problem);
    if (typeof problem.title === 'string') problem.title = copyTitle(problem.title.trim());
    const copy: Draft = { ...fresh, problem };
    commit([...current.current, copy]);
    focusNext.current = openSel(copy.localId);
    showToast(`Made a copy of “${row.name}”.`);
  };

  const remove = (row: Row): void => {
    const at = drafts.indexOf(row.draft);
    const next = drafts.filter((d) => d !== row.draft);
    // Focus moves to the card that takes this one's place, else the one before, else New.
    const pos = sorted.indexOf(row);
    const neighbour = sorted[pos + 1] ?? sorted[pos - 1];
    focusNext.current = neighbour ? openSel(neighbour.draft.localId) : '[data-new]';
    commit(next);
    showToast(`Deleted “${row.name}”.`, () => {
      const cur = current.current;
      if (cur.some((d) => d.localId === row.draft.localId)) return;
      const restored = [...cur];
      restored.splice(Math.min(at, restored.length), 0, row.draft);
      focusNext.current = openSel(row.draft.localId);
      commit(restored);
    });
  };

  const exportRow = (row: Row): void => {
    if (!row.problem) return;
    const { filename, text } = exportProblem(row.problem);
    download(filename, text);
  };

  const onFile = async (e: Event): Promise<void> => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Cleared at once, so picking the same file again still fires a change.
    input.value = '';
    if (!file) return;
    const r = await importProblemFile(file);
    if (!r.ok) {
      setImportError({
        file: (file as Partial<File>).name ?? 'this file',
        messages: [...new Set(r.errors.map((x) => x.message))],
      });
      return;
    }
    const d: Draft = { ...newDraft(Date.now(), Math.random), problem: r.problem };
    focusNext.current = openSel(d.localId);
    commit([...current.current, d]);
    showToast(`Imported “${r.problem.title}”.`);
  };

  const closeImportError = (): void => {
    setImportError(null);
    importBtn.current?.focus();
  };

  const n = drafts.length;
  const actions = (
    <div class="pb-actions">
      <button type="button" class="btn is-primary" data-new onClick={create}>
        <PlusIcon />
        New problem
      </button>
      <button ref={importBtn} type="button" class="btn" onClick={() => fileInput.current?.click()}>
        <UploadIcon />
        Import
      </button>
    </div>
  );

  return (
    <>
      <main class="pb" inert={importError !== null}>
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
            <h1 class="pb-title">My problems</h1>
            <p class="pb-summary">
              {n === 0 ? 'Puzzles you make' : `${n} ${n === 1 ? 'problem' : 'problems'}`} · saved on
              this device
            </p>
          </div>
        </header>

        <p class="pb-save-warn" role="status">
          {saveFailed ? SAVE_WARNING : ''}
        </p>

        <div class="pb-body" ref={list}>
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
                  onDelete={() => remove(row)}
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

      <ToastRegion toast={toast} onDone={() => setToast(null)} />

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
            {importError.messages.slice(0, ERRORS_SHOWN).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          {importError.messages.length > ERRORS_SHOWN && (
            <p class="pb-errors-more">…and {importError.messages.length - ERRORS_SHOWN} more.</p>
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
  onDelete: () => void;
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
        {stars && (
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
          {row.problem && (
            <IconButton label={`Export ${q}`} tip="Export file" onClick={p.onExport}>
              <DownloadIcon />
            </IconButton>
          )}
          <IconButton label={`Delete ${q}`} tip="Delete" onClick={p.onDelete} danger>
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
  onClick: () => void;
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
 * The toast slot: an always-mounted polite live region. A toast stays 5 s; hovering or
 * focusing it holds it, and leaving starts the 5 s again.
 */
function ToastRegion({ toast, onDone }: { toast: Toast | null; onDone: () => void }) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!toast || held) return;
    const t = setTimeout(onDone, TOAST_MS);
    return () => clearTimeout(t);
  }, [toast, held]);
  // A new toast starts unheld.
  useEffect(() => setHeld(false), [toast?.key]);
  return (
    <div class="pb-toast-region" aria-live="polite">
      {toast && (
        <div
          key={toast.key}
          class="pb-toast"
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocusIn={() => setHeld(true)}
          onFocusOut={() => setHeld(false)}
        >
          <span class="pb-toast-text">{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              class="btn pb-toast-undo"
              onClick={() => {
                toast.undo!();
                onDone();
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** A small modal dialog: focus moves in, Tab stays inside, Esc or the scrim closes it. */
function Dialog(p: {
  title: string;
  description: ComponentChildren;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const ok = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => ok.current?.focus(), []);
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
    <div class="pb-scrim" onClick={(e) => e.target === e.currentTarget && p.onClose()}>
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
