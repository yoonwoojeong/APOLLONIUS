// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeEditor } from '../../../src/editor/session';
import { DRAFTS_KEY, loadDrafts, type Draft } from '../../../src/problems/drafts';
import type { Problem } from '../../../src/problems/format';
import { problemHash } from '../../../src/problems/hash';
import { validate } from '../../../src/problems/validate';
import { STORAGE_KEY } from '../../../src/state/persistence';
import { createStore, type Store } from '../../../src/state/store';
import { App } from '../../../src/ui/App';
import level1Fixture from '../../fixtures/problems/level1.json';
import { playReferenceInto } from '../helpers';

const level1 = (): Problem => structuredClone(level1Fixture) as Problem;

function memoryStorage(drafts: Draft[] = []): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>([[DRAFTS_KEY, JSON.stringify({ version: 1, drafts })]]);
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  } as unknown as Storage & { map: Map<string, string> };
}

const draft = (localId: string, updatedAt: number, problem: Partial<Problem>, extra = {}): Draft =>
  ({
    localId,
    createdAt: updatedAt,
    updatedAt,
    problem: { format: 'apollonius-problem', version: 1, ...problem },
    ...extra,
  }) as Draft;

function mount(storage: Storage | null, store: Store = createStore(storage)) {
  store.goToProblems();
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => render(<App store={store} storage={storage} />, host));
  return { store, host };
}

const titles = (host: HTMLElement) =>
  [...host.querySelectorAll('.pb-card-title')].map((e) => e.textContent);
const statuses = (host: HTMLElement) =>
  [...host.querySelectorAll('.pb-status')].map((e) => e.textContent);
const byLabel = (host: ParentNode, label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const byText = (host: ParentNode, text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  ) ?? null;
const click = (el: Element | null) => {
  expect(el).not.toBeNull();
  act(() => (el as HTMLElement).click());
};
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
};

async function pick(host: HTMLElement, file: { size: number; text: () => Promise<string> }) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(input.accept).toBe('.json');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
}

const textFile = (text: string) => ({ size: text.length, text: async () => text });

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const el of [...document.body.children]) act(() => render(null, el));
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A pointer click (detail 1); `click()` above is a keyboard activation (detail 0). */
const mouseClick = (el: Element | null) => {
  expect(el).not.toBeNull();
  act(() => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  });
};
const toasts = () => [...document.querySelectorAll('.pb-toast')].map((t) => t.textContent);
const undoKey = (init: KeyboardEventInit = { ctrlKey: true }, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true, ...init }),
    );
  });

/** Stubs the Blob URL API and anchor clicks; returns what was downloaded. */
function stubDownload() {
  const create = vi.fn((blob: Blob) => (blob ? 'blob:x' : ''));
  const revoke = vi.fn();
  class FakeURL extends URL {
    static createObjectURL = create;
    static revokeObjectURL = revoke;
  }
  vi.stubGlobal('URL', FakeURL);
  const got = { name: '', create, revoke };
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    got.name = this.download;
  });
  return got;
}

describe('My problems: list', () => {
  it('lists drafts newest first with title or Untitled, status and best stars', () => {
    const p = level1();
    const t = validate({ ...p, title: 'Tested one' });
    if (!t.ok) throw new Error('fixture');
    const storage = memoryStorage([
      draft('old', 100, { title: '' }),
      draft('tested', 300, t.problem, {
        testedHash: problemHash(t.problem),
        stars: [true, true, false],
      }),
      draft('valid', 200, p),
    ]);

    const { host } = mount(storage);
    expect(host.querySelector('h1')!.textContent).toBe('My problems');
    expect(titles(host)).toEqual(['Tested one', 'Equilateral Triangle', 'Untitled']);
    expect(statuses(host)).toEqual(['Tested ✓', 'Valid', 'Draft']);
    expect(host.querySelector('.pb-card .pb-stars')!.getAttribute('aria-label')).toBe(
      '2 of 3 stars',
    );
    expect(host.textContent).toContain('Uploading to the public gallery is coming');
    // Play only for problems that pass validation; Export for every draft.
    expect(byLabel(host, 'Play “Equilateral Triangle”')).not.toBeNull();
    expect(byLabel(host, 'Play “Untitled”')).toBeNull();
    expect(byLabel(host, 'Export “Untitled”')).not.toBeNull();
  });

  it('shows an empty state with New and Import', () => {
    const { host } = mount(memoryStorage());
    expect(host.textContent).toContain('No problems yet');
    expect(byText(host, 'New problem')).not.toBeNull();
    expect(byText(host, 'Import')).not.toBeNull();
  });

  it('New opens the editor on a fresh draft; Open opens that draft', () => {
    const storage = memoryStorage([draft('abc', 100, level1())]);
    const { store, host } = mount(storage);
    click(byLabel(host, 'Open “Equilateral Triangle”'));
    expect(store.screen.value).toBe('editor');
    expect(activeEditor(store).value!.localId).toBe('abc');
    act(() => activeEditor(store).value!.exit());
    expect(store.screen.value).toBe('problems');

    click(byText(host, 'New problem'));
    expect(store.screen.value).toBe('editor');
    expect(activeEditor(store).value!.localId).not.toBe('abc');
  });

  it('re-reads drafts on return, so edits made in the editor show', () => {
    const storage = memoryStorage([draft('abc', 100, level1())]);
    const { store, host } = mount(storage);
    click(byLabel(host, 'Open “Equilateral Triangle”'));
    const ed = activeEditor(store).value!;
    act(() => ed.setDetails({ title: 'Renamed' }));
    act(() => ed.exit());
    expect(titles(host)).toEqual(['Renamed']);
  });

  it('warns when drafts cannot be saved', () => {
    const storage = memoryStorage([draft('abc', 100, level1())]);
    storage.setItem = () => {
      throw new Error('quota');
    };
    const { host } = mount(storage);
    expect(host.textContent).not.toContain("Couldn't save drafts on this device.");
    click(byLabel(host, 'Duplicate “Equilateral Triangle”'));
    expect(host.querySelector('.pb-save-warn')!.textContent).toBe(
      "Couldn't save drafts on this device.",
    );
  });
});

describe('My problems: actions', () => {
  it('Duplicate adds a copy on top, focuses it and keeps the original', () => {
    const storage = memoryStorage([draft('abc', 100, level1())]);
    const { host } = mount(storage);
    click(byLabel(host, 'Duplicate “Equilateral Triangle”'));
    expect(titles(host)).toEqual(['Equilateral Triangle (copy)', 'Equilateral Triangle']);
    const saved = loadDrafts(storage);
    expect(saved).toHaveLength(2);
    expect(new Set(saved.map((d) => d.localId)).size).toBe(2);
    expect(document.activeElement).toBe(byLabel(host, 'Open “Equilateral Triangle (copy)”'));
  });

  it('Delete removes the draft, and Undo within 5 s restores it', () => {
    vi.useFakeTimers();
    const storage = memoryStorage([draft('a', 100, { title: 'One' }), draft('b', 200, level1())]);
    const { host } = mount(storage);
    click(byLabel(host, 'Delete “One”'));
    expect(titles(host)).toEqual(['Equilateral Triangle']);
    expect(loadDrafts(storage).map((d) => d.localId)).toEqual(['b']);
    const toast = host.querySelector('.pb-toast')!;
    expect(toast.closest('[aria-live="polite"]')).not.toBeNull();
    expect(toast.textContent).toContain('Deleted “One”');
    act(() => void vi.advanceTimersByTime(4900));
    click(byText(host, 'Undo'));
    expect(titles(host)).toEqual(['Equilateral Triangle', 'One']);
    expect(
      loadDrafts(storage)
        .map((d) => d.localId)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(host.querySelector('.pb-toast')).toBeNull();
  });

  it('the undo toast goes away after 5 s and the delete stands', () => {
    vi.useFakeTimers();
    const storage = memoryStorage([draft('a', 100, { title: 'One' })]);
    const { host } = mount(storage);
    mouseClick(byLabel(host, 'Delete “One”'));
    act(() => void vi.advanceTimersByTime(5000));
    expect(host.querySelector('.pb-toast')).toBeNull();
    expect(loadDrafts(storage)).toEqual([]);
    expect(host.textContent).toContain('No problems yet');
  });

  it('Play opens a custom level; completion saves stars to the draft, never progress', () => {
    const storage = memoryStorage([draft('abc', 100, level1())]);
    const { store, host } = mount(storage);
    click(byLabel(host, 'Play “Equilateral Triangle”'));
    expect(store.screen.value).toBe('level');
    expect(store.isCustom.value).toBe(true);
    expect(store.levelId.value).toBe('problem:abc');
    act(() => playReferenceInto(store));
    expect(store.completion.value).not.toBeNull();
    expect(loadDrafts(storage)[0]!.stars).toEqual(store.completion.value!.stars);
    expect(storage.map.has(STORAGE_KEY)).toBe(false);
    act(() => store.exitCustomLevel());
    expect(store.screen.value).toBe('problems');
    expect(store.isCustom.value).toBe(false);
    expect(host.querySelector('.pb-card .pb-stars')).not.toBeNull();
  });

  it('Export downloads <slug>.apollonius.json and revokes the URL afterwards', () => {
    vi.useFakeTimers();
    const dl = stubDownload();
    const { host } = mount(memoryStorage([draft('abc', 100, level1())]));
    click(byLabel(host, 'Export “Equilateral Triangle”'));
    expect(dl.create).toHaveBeenCalledTimes(1);
    expect(dl.name).toBe('equilateral-triangle.apollonius.json');
    expect(dl.revoke).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1000));
    expect(dl.revoke).toHaveBeenCalledWith('blob:x');
    expect(toasts()).toEqual([]);
  });

  it('Export also works for a draft that is not valid yet, with a warning', async () => {
    const dl = stubDownload();
    const { host } = mount(memoryStorage([draft('abc', 100, { title: '' })]));
    click(byLabel(host, 'Export “Untitled”'));
    expect(dl.name).toBe('problem.apollonius.json');
    const text = await (dl.create.mock.calls[0]![0] as Blob).text();
    expect(JSON.parse(text)).toMatchObject({ format: 'apollonius-problem', title: '' });
    expect(toasts()).toEqual([
      "This problem isn't valid yet — the file won't import until it passes the checks.",
    ]);
  });
});

describe('My problems: undo', () => {
  it('a keyboard Delete puts focus on Undo; the toast holds while focused', () => {
    vi.useFakeTimers();
    const storage = memoryStorage([draft('a', 100, { title: 'One' }), draft('b', 200, level1())]);
    const { host } = mount(storage);
    click(byLabel(host, 'Delete “One”'));
    expect(document.activeElement).toBe(byText(document, 'Undo'));
    act(() => void vi.advanceTimersByTime(20000));
    expect(toasts()).toHaveLength(1);
    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(toasts()).toEqual([]);
    // Focus goes back to the neighbouring card.
    expect(document.activeElement).toBe(byLabel(host, 'Open “Equilateral Triangle”'));
  });

  it('when the last card is deleted and the toast closes, focus goes to the heading', () => {
    vi.useFakeTimers();
    const { host } = mount(memoryStorage([draft('a', 100, { title: 'One' })]));
    click(byLabel(host, 'Delete “One”'));
    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(host.querySelector('h1'));
  });

  it('a mouse Delete keeps focus in the list; the toast holds while hovered', () => {
    vi.useFakeTimers();
    const storage = memoryStorage([draft('a', 100, { title: 'One' }), draft('b', 200, level1())]);
    const { host } = mount(storage);
    mouseClick(byLabel(host, 'Delete “Equilateral Triangle”'));
    expect(document.activeElement).toBe(byLabel(host, 'Open “One”'));
    const toast = document.querySelector('.pb-toast')!;
    act(() => {
      toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      toast.dispatchEvent(new MouseEvent('mouseenter'));
    });
    act(() => void vi.advanceTimersByTime(20000));
    expect(toasts()).toHaveLength(1);
    act(() => {
      toast.dispatchEvent(new MouseEvent('mouseleave'));
    });
    act(() => void vi.advanceTimersByTime(5000));
    expect(toasts()).toEqual([]);
  });

  it('Ctrl/Cmd+Z undoes while the toast shows, but not from a text field', () => {
    vi.useFakeTimers();
    const storage = memoryStorage([draft('a', 100, { title: 'One' }), draft('b', 200, level1())]);
    const { host } = mount(storage);
    mouseClick(byLabel(host, 'Delete “One”'));
    const field = document.createElement('input');
    document.body.appendChild(field);
    undoKey({ ctrlKey: true }, field);
    expect(titles(host)).toEqual(['Equilateral Triangle']);
    undoKey({ metaKey: true });
    expect(titles(host)).toEqual(['Equilateral Triangle', 'One']);
    expect(toasts()).toEqual([]);
    // No toast, no undo.
    mouseClick(byLabel(host, 'Delete “One”'));
    act(() => void vi.advanceTimersByTime(5000));
    undoKey();
    expect(titles(host)).toEqual(['Equilateral Triangle']);
  });

  it('deletes stack: Undo restores every pending delete in place, other toasts keep them', () => {
    vi.useFakeTimers();
    const storage = memoryStorage([
      draft('a', 100, { title: 'One' }),
      draft('b', 200, { title: 'Two' }),
      draft('c', 300, { title: 'Three' }),
    ]);
    const { host } = mount(storage);
    mouseClick(byLabel(host, 'Delete “Two”'));
    act(() => void vi.advanceTimersByTime(3000));
    mouseClick(byLabel(host, 'Delete “Three”'));
    expect(toasts()).toEqual(['Deleted 2 problems.Undo']);
    act(() => void vi.advanceTimersByTime(3000));
    mouseClick(byLabel(host, 'Duplicate “One”'));
    expect(toasts()).toContain('Deleted 2 problems.Undo');
    click(byText(document, 'Undo'));
    expect(titles(host)).toEqual(['One (copy)', 'Three', 'Two', 'One']);
    expect(
      loadDrafts(storage)
        .map((d) => d.localId)
        .slice(0, 3),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('My problems: tested status', () => {
  it('a draft tested in the editor shows Tested ✓', () => {
    const storage = memoryStorage([draft('abc', 100, level1())]);
    const { store, host } = mount(storage);
    click(byLabel(host, 'Open “Equilateral Triangle”'));
    const ed = activeEditor(store).value!;
    act(() => void ed.startTest());
    act(() => playReferenceInto(store));
    act(() => store.exitCustomLevel());
    act(() => ed.exit());
    expect(statuses(host)).toEqual(['Tested ✓']);
  });
});

describe('My problems: import', () => {
  it('a 300 KB file is refused by size without being read', async () => {
    const { host } = mount(memoryStorage());
    const text = vi.fn(() => {
      throw new Error('must not read');
    });
    await pick(host, { size: 300_000, text });
    expect(text).not.toHaveBeenCalled();
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('too big');
  });

  it('a non-JSON file shows a message', async () => {
    const { host } = mount(memoryStorage());
    await pick(host, textFile('hello'));
    expect(host.querySelector('[role="dialog"]')!.textContent).toContain("isn't valid JSON");
  });

  it('an invalid problem lists its errors and imports nothing; Esc closes', async () => {
    const storage = memoryStorage();
    const { host } = mount(storage);
    const p = level1() as Partial<Problem>;
    delete p.title;
    delete p.goalText;
    await pick(host, textFile(JSON.stringify(p)));
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.querySelectorAll('li').length).toBeGreaterThan(0);
    expect(document.activeElement && dialog.contains(document.activeElement)).toBe(true);
    expect(loadDrafts(storage)).toEqual([]);
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(byText(host, 'Import'));
  });

  it('a valid problem is added as a new draft and existing drafts stay', async () => {
    const storage = memoryStorage([draft('keep', 100, { title: 'Mine' })]);
    const { host } = mount(storage);
    await pick(host, textFile(JSON.stringify(level1())));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(titles(host)).toEqual(['Equilateral Triangle', 'Mine']);
    expect(document.activeElement).toBe(byLabel(host, 'Open “Equilateral Triangle”'));
    const saved = loadDrafts(storage);
    expect(saved).toHaveLength(2);
    expect(saved.find((d) => d.localId !== 'keep')!.problem.title).toBe('Equilateral Triangle');
  });
});

describe('My problems: import hardening', () => {
  it('everything outside the dialog is inert while it is open', async () => {
    vi.useFakeTimers();
    const { host } = mount(memoryStorage([draft('a', 100, { title: 'One' })]));
    mouseClick(byLabel(host, 'Delete “One”'));
    await pick(host, textFile('nope'));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(host.querySelector('.screen-corner')!.closest('[inert]')).not.toBeNull();
    expect(document.querySelector('.pb-toast')!.closest('[inert]')).not.toBeNull();
    expect(host.querySelector('main')!.closest('[inert]')).not.toBeNull();
    expect(dialog.closest('[inert]')).toBeNull();
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('import errors are deduped by path and message, with the path shown', async () => {
    const { host } = mount(memoryStorage());
    const p = level1();
    (p.labels as Record<string, string>).A = 'TOOLONG';
    (p.labels as Record<string, string>).B = 'TOOLONG';
    await pick(host, textFile(JSON.stringify(p)));
    const items = [...document.querySelectorAll('.pb-errors li')];
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(new Set(items.map((li) => li.textContent)).size).toBe(items.length);
    expect(items[0]!.querySelector('.pb-err-path')!.textContent).toMatch(/labels/);
  });

  it('an import appends to what is stored now, not to a stale list', async () => {
    const storage = memoryStorage([draft('keep', 100, { title: 'Mine' })]);
    const { host } = mount(storage);
    // Something else saves a draft while the file is being read.
    let release!: (t: string) => void;
    const file = { size: 10, text: () => new Promise<string>((r) => (release = r)) };
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    act(() => void input.dispatchEvent(new Event('change', { bubbles: true })));
    const other = draft('other', 150, { title: 'Elsewhere' });
    storage.setItem(
      DRAFTS_KEY,
      JSON.stringify({ version: 1, drafts: [...loadDrafts(storage), other] }),
    );
    release(JSON.stringify(level1()));
    await flush();
    expect(loadDrafts(storage).map((d) => d.problem.title)).toEqual([
      'Mine',
      'Elsewhere',
      'Equilateral Triangle',
    ]);
    expect(titles(host)).toEqual(['Equilateral Triangle', 'Elsewhere', 'Mine']);
  });

  it('an import that finishes after leaving the screen is saved without touching the UI', async () => {
    const storage = memoryStorage();
    const { store, host } = mount(storage);
    let release!: (t: string) => void;
    const file = { size: 10, text: () => new Promise<string>((r) => (release = r)) };
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    act(() => void input.dispatchEvent(new Event('change', { bubbles: true })));
    act(() => store.goToMap());
    const err = vi.spyOn(console, 'error');
    release(JSON.stringify(level1()));
    await flush();
    expect(err).not.toHaveBeenCalled();
    expect(loadDrafts(storage)).toHaveLength(1);
    expect(document.querySelector('.pb-toast')).toBeNull();
  });
});

describe('Create entry points', () => {
  it('the title screen and the level map have a Create button that opens My problems', () => {
    const storage = memoryStorage();
    const store = createStore(storage);
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => render(<App store={store} storage={storage} />, host));
    click(byText(host, 'Create'));
    expect(store.screen.value).toBe('problems');
    act(() => store.goToMap());
    click(byText(host, 'Create'));
    expect(store.screen.value).toBe('problems');
    click(byLabel(host, 'Back to levels'));
    expect(store.screen.value).toBe('map');
  });
});
