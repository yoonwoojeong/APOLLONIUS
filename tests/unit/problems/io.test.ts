import { describe, expect, test } from 'vitest';
import type { DraftProblem } from '../../../src/problems/drafts';
import type { Problem } from '../../../src/problems/format';
import {
  MAX_IMPORT_BYTES,
  exportProblem,
  importProblemFile,
  importProblemText,
} from '../../../src/problems/io';
import level1Fixture from '../../fixtures/problems/level1.json';

const level1 = (): Problem => structuredClone(level1Fixture) as Problem;
const messages = (r: ReturnType<typeof importProblemText>): string[] =>
  r.ok ? [] : r.errors.map((e) => e.message);

describe('exportProblem', () => {
  test('names the file after the title slug', () => {
    expect(exportProblem(level1()).filename).toBe('equilateral-triangle.apollonius.json');
    const p = { ...level1(), title: '  Ångström: Two Circles!! ' };
    expect(exportProblem(p).filename).toBe('ngstr-m-two-circles.apollonius.json');
  });

  test('exports a draft too, falling back to `problem` for a missing or empty title', () => {
    const d: DraftProblem = { format: 'apollonius-problem', version: 1, givens: [] };
    expect(exportProblem(d).filename).toBe('problem.apollonius.json');
    expect(exportProblem({ ...d, title: '  ' }).filename).toBe('problem.apollonius.json');
    expect(exportProblem({ ...d, title: 42 } as never).filename).toBe('problem.apollonius.json');
    expect(JSON.parse(exportProblem(d).text)).toEqual(d);
  });

  test('writes pretty JSON that imports back to the same problem, with no id', () => {
    const { text } = exportProblem(level1());
    expect(text).toContain('\n  "format": "apollonius-problem"');
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).not.toHaveProperty('id');
    const r = importProblemText(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.problem.title).toBe('Equilateral Triangle');
  });
});

describe('importProblemText', () => {
  test('non-JSON gets a plain message', () => {
    const r = importProblemText('{ not json');
    expect(r.ok).toBe(false);
    expect(messages(r)).toEqual(["This file isn't a problem file (it isn't valid JSON)."]);
  });

  test('an invalid problem returns the validator errors', () => {
    const p = level1() as Partial<Problem>;
    delete p.title;
    const r = importProblemText(JSON.stringify(p));
    expect(r.ok).toBe(false);
    expect(messages(r).length).toBeGreaterThan(0);
  });

  test('a valid problem passes', () => {
    expect(importProblemText(JSON.stringify(level1())).ok).toBe(true);
  });
});

describe('importProblemFile', () => {
  const untouchable = (size: number) => ({
    size,
    text: (): Promise<string> => {
      throw new Error('read');
    },
  });

  test('rejects a file over the limit by its size, without reading it', async () => {
    expect(MAX_IMPORT_BYTES).toBe(200_000);
    const r = await importProblemFile(untouchable(300_000));
    expect(r.ok).toBe(false);
    expect(messages(r)).toEqual([
      'This file is too big to be a problem (300 KB; the limit is 200 KB).',
    ]);
  });

  test('reads a file within the limit', async () => {
    const text = JSON.stringify(level1());
    const r = await importProblemFile({ size: MAX_IMPORT_BYTES, text: async () => text });
    expect(r.ok).toBe(true);
  });

  test('a read failure gets a message', async () => {
    const r = await importProblemFile({ size: 10, text: () => Promise.reject(new Error('x')) });
    expect(messages(r)).toEqual(["Couldn't read this file."]);
  });
});
