// @ts-check
/**
 * export-action.js — "save everything to a file", as one action.
 *
 * This used to live inside settings.js. It moved out when the Today screen
 * gained a backup prompt: two buttons that both claim to export everything
 * must not be two implementations, or one of them eventually forgets to flush
 * pending writes or to record that a backup happened.
 *
 * Importing settings.js from today.js would have worked and would also have
 * dragged the entire settings view into the Today code path, so the shared
 * part is a module of its own instead.
 */

import { todayKey } from '../utils/date.js';
import { toast } from '../ui/toast.js';
import * as backup from './backup.js';
import * as store from '../state/store.js';

/**
 * Write every log, period day and setting to a downloaded JSON file.
 *
 * `flushNow` first, because a log edited seconds ago may still be sitting in
 * the debounced write queue — exporting from memory would be fine, but the
 * point of a backup is that it matches what is actually on disk.
 *
 * @returns {Promise<void>}
 */
export async function exportEverything() {
  await store.flushNow();

  // Read after the flush: the state object is replaced on write, so a
  // reference taken beforehand can be one revision stale.
  const state = store.getState();

  const text = backup.toJSON({
    settings: state.settings,
    logs: state.logs,
    periodDays: state.periodDays,
  });

  backup.downloadFile(text, backup.exportFilename());

  // Both are recorded: the date is what gets shown to a human ("last backup 8
  // days ago"), the timestamp is what the at-risk count compares against, and
  // day granularity is too coarse for that — it would count everything logged
  // earlier the same day as unprotected.
  store.updateSettings({ lastBackup: todayKey(), lastBackupAt: Date.now() });

  const days = Object.keys(state.logs).length;
  toast(`Exported ${days} logged ${days === 1 ? 'day' : 'days'}`);
}
