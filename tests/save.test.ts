import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSave, writeSave } from '../src/save';

function stubStorage(impl: Partial<Storage>) {
  vi.stubGlobal('localStorage', impl);
}
afterEach(() => vi.unstubAllGlobals());

describe('save', () => {
  it('copes with empty storage', () => {
    stubStorage({ getItem: () => null });
    expect(loadSave().settings).toEqual(DEFAULT_SETTINGS);
  });

  it('copes with storage that throws', () => {
    stubStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadSave().settings).toEqual(DEFAULT_SETTINGS);
    expect(() => writeSave(loadSave())).not.toThrow();
  });

  it('copes with corrupt json and wrong types', () => {
    stubStorage({ getItem: () => '{"settings":{"quality":"ultra","leftHanded":"yes","musicVolume":0.2}}' });
    const s = loadSave().settings;
    expect(s.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(s.leftHanded).toBe(false);
    expect(s.musicVolume).toBe(0.2);
    stubStorage({ getItem: () => '{not json' });
    expect(loadSave().settings).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips', () => {
    let stored = '';
    stubStorage({ getItem: () => stored, setItem: (_k, v) => void (stored = v) });
    const d = loadSave();
    d.settings.leftHanded = true;
    d.progress.unlockedChapters = 3;
    writeSave(d);
    const back = loadSave();
    expect(back.settings.leftHanded).toBe(true);
    expect(back.progress.unlockedChapters).toBe(3);
  });
});
