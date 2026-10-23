import { signal, type Signal } from '@preact/signals';
import type { Draft } from '../problems/drafts';
import type { Store } from '../state/store';
import { createEditor, type Editor } from './editorStore';

/** The editor each game store is showing on its `editor` screen (one per store). */
const slots = new WeakMap<Store, Signal<Editor | null>>();

/** The active editor of a game store (null until one is opened). */
export function activeEditor(game: Store): Signal<Editor | null> {
  let s = slots.get(game);
  if (!s) slots.set(game, (s = signal<Editor | null>(null)));
  return s;
}

/**
 * Opens a draft in the editor and shows the editor screen. A previously open editor is saved
 * and closed first (its Solve sandbox too).
 */
export function openEditor(game: Store, storage: Storage | null, draft: Draft): Editor {
  const slot = activeEditor(game);
  slot.peek()?.exit();
  const editor = createEditor(game, storage, draft);
  // Leaving the editor also clears the slot, so a closed editor is never shown again.
  const exit = editor.exit;
  editor.exit = (): void => {
    exit();
    if (slot.peek() === editor) slot.value = null;
  };
  slot.value = editor;
  game.screen.value = 'editor';
  return editor;
}
