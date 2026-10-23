import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAFTS_KEY,
  loadDrafts,
  newDraft,
  saveDrafts,
  slugify,
  type Draft,
} from '../../../src/problems/drafts';

const store = (raw: string | null) => ({ getItem: () => raw });
const draft = (over: Partial<Draft> = {}): Draft => ({
  localId: 'abc1234567',
  createdAt: 1,
  updatedAt: 2,
  problem: { format: 'apollonius-problem', version: 1, title: 'T' },
  ...over,
});
const envelope = (drafts: unknown[]) => JSON.stringify({ version: 1, drafts });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('drafts storage', () => {
  it('uses the versioned key', () => {
    expect(DRAFTS_KEY).toBe('apollonius:problems:v1');
  });

  it('round-trips', () => {
    let saved = '';
    const d = draft({ testedHash: 'h', stars: [true, false, true] });
    expect(saveDrafts({ setItem: (_k, v) => (saved = v) }, [d])).toBe(true);
    expect(loadDrafts(store(saved))).toEqual([d]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns [] for null storage or missing key', () => {
    expect(loadDrafts(null)).toEqual([]);
    expect(loadDrafts(store(null))).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('discards corrupt JSON with a warning', () => {
    expect(loadDrafts(store('{nope'))).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('discards version 2 with a warning', () => {
    expect(loadDrafts(store(JSON.stringify({ version: 2, drafts: [draft()] })))).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('discards a bad envelope', () => {
    expect(loadDrafts(store('[]'))).toEqual([]);
    expect(loadDrafts(store(JSON.stringify({ version: 1, drafts: {} })))).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('drops only malformed drafts', () => {
    const good = draft();
    const bad = [
      null,
      { ...good, localId: 5 },
      { ...good, createdAt: 'x' },
      { ...good, updatedAt: null },
      { ...good, problem: null },
      { ...good, problem: { format: 'apollonius-problem', version: 2 } },
      { ...good, problem: { format: 'other', version: 1 } },
      { ...good, testedHash: 5 },
      { ...good, stars: [true, false] },
      { ...good, stars: [true, false, 'x'] },
    ];
    expect(loadDrafts(store(envelope([good, ...bad])))).toEqual([good]);
    expect(warn).toHaveBeenCalledTimes(bad.length);
  });

  it('rejects non-finite numbers (JSON null) and ignores inherited keys', () => {
    const raw =
      '{"version":1,"drafts":[{"localId":"a","createdAt":1e999,"updatedAt":1,"problem":{"format":"apollonius-problem","version":1}}]}';
    expect(loadDrafts(store(raw))).toEqual([]);
    const proto =
      '{"version":1,"drafts":[{"__proto__":{"localId":"a","createdAt":1,"updatedAt":1,"problem":{"format":"apollonius-problem","version":1}}}]}';
    expect(loadDrafts(store(proto))).toEqual([]);
  });

  it('saveDrafts never throws', () => {
    const boom = {
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(saveDrafts(boom, [draft()])).toBe(false);
    expect(saveDrafts(null, [draft()])).toBe(false);
  });

  it('loadDrafts never throws when getItem throws', () => {
    expect(
      loadDrafts({
        getItem: () => {
          throw new Error('denied');
        },
      }),
    ).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});

describe('newDraft', () => {
  it('makes a blank draft with a 10-char base-36 id', () => {
    const d = newDraft(5, () => 0.123456789);
    expect(d.localId).toMatch(/^[0-9a-z]{10}$/);
    expect(d.createdAt).toBe(5);
    expect(d.updatedAt).toBe(5);
    expect(d.problem.format).toBe('apollonius-problem');
    expect(d.problem.version).toBe(1);
    expect(d.problem.tools).toEqual(['point', 'line', 'circle']);
  });

  it('handles rand() extremes', () => {
    expect(newDraft(0, () => 0).localId).toBe('0000000000');
    expect(newDraft(0, () => 0.9999999999).localId).toMatch(/^[0-9a-z]{10}$/);
  });
});

describe('slugify', () => {
  it('slugifies', () => {
    expect(slugify('Kite Diagonal!')).toBe('kite-diagonal');
    expect(slugify('  A -- B  ')).toBe('a-b');
  });
  it('falls back', () => {
    expect(slugify('***')).toBe('problem');
    expect(slugify('')).toBe('problem');
  });
  it('caps at 40 without trailing dash', () => {
    const s = slugify('a'.repeat(39) + ' bbbb');
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith('-')).toBe(false);
  });
});
