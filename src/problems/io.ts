import { slugify } from './drafts';
import type { Problem } from './format';
import { validate, type ValidationResult } from './validate';

/** Larger files are refused before they are read: a real problem is a few kilobytes. */
export const MAX_IMPORT_BYTES = 200_000;

const fail = (code: 'shape' | 'limit', message: string): ValidationResult => ({
  ok: false,
  errors: [{ code, path: '', message }],
});

/** A problem as a downloadable file: `<slug>.apollonius.json`, pretty-printed. */
export function exportProblem(p: Problem): { filename: string; text: string } {
  return {
    filename: `${slugify(p.title)}.apollonius.json`,
    text: `${JSON.stringify(p, null, 2)}\n`,
  };
}

/** Parses and validates a problem file's text. */
export function importProblemText(text: string): ReturnType<typeof validate> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('shape', "This file isn't a problem file (it isn't valid JSON).");
  }
  return validate(data);
}

/** Imports a picked file: its size is checked first, so an oversized file is never read. */
export async function importProblemFile(
  file: Pick<File, 'size' | 'text'>,
): Promise<ReturnType<typeof validate>> {
  if (file.size > MAX_IMPORT_BYTES) {
    const kb = (n: number): string => `${Math.ceil(n / 1000)} KB`;
    return fail(
      'limit',
      `This file is too big to be a problem (${kb(file.size)}; the limit is ${kb(MAX_IMPORT_BYTES)}).`,
    );
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return fail('shape', "Couldn't read this file.");
  }
  return importProblemText(text);
}
