// @ts-check
/**
 * partner-sync.js — keeps her shared summary current, quietly.
 *
 * Only does anything while she is sharing. Then, a few seconds after anything
 * changes (a check-in, an edited period, a new choice in the share sheet), it
 * rebuilds the summary and sends it — unless it is identical to the last one
 * sent, which is most of the time: logging a mood does not move her forecast.
 *
 * A failed send is not an error she needs to see. The phone may be offline;
 * the next change, or coming back online, tries again.
 */

import * as store from './store.js';
import { todayKey } from '../utils/date.js';
import { buildCycles } from '../domain/cycles.js';
import { predict } from '../domain/predict.js';
import { premenstrualPatterns } from '../domain/heads-up.js';
import { moodCurve, bodyMap, sleepCurve, easierDays } from '../domain/rhythm.js';
import { cycleLengths } from '../domain/cycles.js';
import { predictionAccuracy, MIN_SCORED } from '../domain/accuracy.js';
import { buildSnapshot } from '../domain/partner.js';
import { trackedCycles } from '../domain/stats.js';
import { putShare } from '../storage/share.js';

/** Long enough to fold a burst of taps into one send. */
const DEBOUNCE_MS = 3000;

let timer = /** @type {ReturnType<typeof setTimeout>|null} */ (null);
let sending = false;

/**
 * The summary her phone would send now — or, given choices she has not saved
 * yet, the one it would send with those.
 *
 * @param {{choices: import('../domain/partner.js').ShareChoices, helps: string, status?: {id: string, at: number}|null}|null} [share]
 */
export function currentSnapshot(share = store.getState().settings.partnerShare) {
  const { settings, logs, periodDays } = store.getState();
  if (!share) return null;
  const today = todayKey();
  const cycles = buildCycles(periodDays);
  const prediction = predict({ periodDays, settings, today, logs });
  const lengths = cycleLengths(cycles).slice(-6);
  const record = predictionAccuracy(cycles);
  const sleep = sleepCurve(logs, cycles);
  return buildSnapshot({
    settings,
    prediction,
    choices: share.choices,
    helps: share.helps,
    patterns: premenstrualPatterns(logs, cycles),
    moodWindow: moodCurve(logs, cycles)?.finding?.window ?? null,
    today,
    rows: bodyMap(logs, cycles, 8),
    sleepDip: Boolean(sleep?.finding && sleep.finding.minutes < 0),
    easy: easierDays(logs, cycles),
    stats: lengths.length ? {
      min: Math.min(...lengths),
      max: Math.max(...lengths),
      cycles: cycleLengths(cycles).length,
      regularity: prediction.regularity,
      hits: record.total >= MIN_SCORED ? record.hits : null,
      total: record.total >= MIN_SCORED ? record.total : null,
    } : null,
    status: share.status ?? null,
    tracked: trackedCycles(logs, cycles).length,
  });
}

/**
 * Send the summary if it has changed. Resolves true when the server has the
 * current one.
 * @param {{force?: boolean}} [opts]
 */
export async function syncNow({ force = false } = {}) {
  const share = store.getState().settings.partnerShare;
  if (!share || sending) return false;
  const snapshot = currentSnapshot();
  // The date it was made is the only thing that changes every day without
  // anything else changing, and it is not news worth a send.
  const hash = JSON.stringify({ ...snapshot, updated: '' });
  if (!force && hash === share.sentHash) return true;
  sending = true;
  try {
    await putShare(share, snapshot);
    const latest = store.getState().settings.partnerShare;
    // She may have stopped sharing while this was in flight.
    if (latest && latest.id === share.id) {
      store.updateSettings({ partnerShare: { ...latest, sentHash: hash, sentAt: Date.now() } });
    }
    return true;
  } catch {
    return false;
  } finally {
    sending = false;
  }
}

function schedule() {
  if (!store.getState().settings.partnerShare) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void syncNow(); }, DEBOUNCE_MS);
}

/** Start watching. Safe to call once at start-up whether or not she shares. */
export function startPartnerSync() {
  store.subscribe(schedule);
  addEventListener('online', schedule);
  schedule();
}
