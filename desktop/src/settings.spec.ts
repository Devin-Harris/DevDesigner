import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings, saveSettings } from './settings';

describe('desktop settings', () => {
  it('defaults when nothing is saved', () => {
    expect(loadSettings(mkdtempSync(join(tmpdir(), 'dd-set-')))).toEqual(DEFAULT_SETTINGS);
  });

  it('saves partial changes and keeps the rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dd-set-'));
    saveSettings(dir, { updates: 'off' });
    expect(saveSettings(dir, { backupsToKeep: 9 })).toEqual({ updates: 'off', backupsToKeep: 9 });
    expect(loadSettings(dir)).toEqual({ updates: 'off', backupsToKeep: 9 });
  });

  it('rejects invalid values', () => {
    expect(sanitizeSettings({ updates: 'always', backupsToKeep: 0 })).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ backupsToKeep: 2.5 }).backupsToKeep).toBe(5);
  });
});
