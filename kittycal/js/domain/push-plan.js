// @ts-check
/**
 * push-plan.js — the heads-ups his phone schedules, and what each says.
 *
 * Two kinds, both his choice, both rare:
 *
 *   - the evening before her period is likely to start;
 *   - the morning her harder days usually start, when she shares that.
 *
 * The plan stays on his phone. The server is only told the times, and wakes
 * the phone with an empty push at each; the service worker then shows the
 * entry planned for about now. Nothing about her ever reaches the server.
 *
 * @typedef {import('./partner.js').Snapshot} Snapshot
 * @typedef {{at: number, title: string, body: string}} PlannedPush
 */

import { partnerDays } from './partner.js';
import { addDays } from '../utils/date.js';

/** Local hours the heads-ups go out at: after work, and over breakfast. */
export const EVENING_HOUR = 19;
export const MORNING_HOUR = 9;
/** No more than the server keeps. */
export const PLAN_LIMIT = 12;

/**
 * @param {import('../utils/date.js').DateKey} key
 * @param {number} hour
 */
const at = (key, hour) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0).getTime();
};

/**
 * Every heads-up due in the next few months, soonest first.
 *
 * @param {Snapshot} snap
 * @param {{period: boolean, harder: boolean}} prefs
 * @param {import('../utils/date.js').DateKey} today
 * @param {number} now  epoch ms; nothing in the past (or within five minutes) is planned
 * @returns {PlannedPush[]}
 */
export function pushPlan(snap, prefs, today, now) {
  if (!prefs.period && !prefs.harder) return [];
  const who = snap.name ?? 'Her';
  const whose = snap.name ? `${snap.name}’s` : 'Her';
  const mood = snap.lanes.find((l) => l.kind === 'mood');
  /** @type {PlannedPush[]} */
  const out = [];
  for (const day of partnerDays(snap, today, 110)) {
    if (prefs.period && day.period === 'expected' && day.cycleDay === 1) {
      out.push({
        at: at(addDays(day.date, -1), EVENING_HOUR),
        title: `${whose} period is likely tomorrow`,
        body: 'Worth having supplies, and some slack, ready.',
      });
    }
    if (prefs.harder && mood && !day.period && day.untilNext === -mood.from) {
      out.push({
        at: at(day.date, MORNING_HOUR),
        title: `Harder days usually start about now for ${who === 'Her' ? 'her' : who}`,
        body: 'Extra patience goes a long way. It’s hormones, not you.',
      });
    }
  }
  return out.filter((p) => p.at > now + 5 * 60_000).sort((a, b) => a.at - b.at).slice(0, PLAN_LIMIT);
}

/**
 * The planned heads-up a push that arrived at `now` is for: the closest one
 * within a few hours either side, or null if none is (the phone was offline
 * and it arrived late, or the plan changed since).
 *
 * The service worker keeps its own copy of this (it cannot import modules on
 * every browser); this one is what the tests hold it to.
 *
 * @param {PlannedPush[]} plan
 * @param {number} now
 */
export function pushFor(plan, now) {
  let best = null;
  for (const p of plan) {
    const off = Math.abs(p.at - now);
    if (off <= 6 * 3600e3 && (!best || off < Math.abs(best.at - now))) best = p;
  }
  return best;
}
