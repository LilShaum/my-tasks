// @ts-check
/**
 * foryou.js — what is worth telling her today, ranked.
 *
 * Kittycal knows a lot that she would want to know and will never go looking
 * for: that her period is two days away, that the bloating usually starts
 * about now, that Insights has just found something new, that the short night
 * she logged is the dip her cycle brings every month. Each of those lived on a
 * screen she had to visit. This gathers them into one ranked list, which two
 * places read:
 *
 *   - the end of the daily check-in ("For you today"), at most three, and only
 *     when there is something worth saying — otherwise the check-in closes as
 *     it always did;
 *   - the Today screen's single "For you" card, which replaced a carousel of
 *     general articles chosen by phase and a random rotation.
 *
 * Rules every moment follows:
 *
 *   - It comes from her own data or her own forecast, or it is a tip keyed to
 *     something she logged today. Nothing generic is ranked above anything
 *     about her.
 *   - It says something she has not just been told. Each moment has an id and
 *     a cooldown, and a moment seen within its cooldown is not repeated. Most
 *     ids carry the thing that would make them new again (the date of the next
 *     period, the number of days late), so "in 3 days" and "in 2 days" are
 *     different moments, while the same pattern is said once a cycle.
 *   - Never alarming. Lateness is said with what usually explains it; nothing
 *     here diagnoses.
 *
 * Pure: everything is passed in, so it can be tested without a browser.
 *
 * @typedef {import('../utils/date.js').DateKey} DateKey
 * @typedef {import('./model.js').DayLog} DayLog
 * @typedef {import('./model.js').Settings} Settings
 * @typedef {import('./cycles.js').Cycle} Cycle
 * @typedef {import('./predict.js').Prediction} Prediction
 */

import { addDays, daysBetween, fmtDayMonth } from '../utils/date.js';
import { plural } from '../utils/fmt.js';
import { labelOf } from '../data/taxonomy.js';
import { pick } from '../data/tips.js';
import { premenstrualPatterns } from './heads-up.js';
import { bodyMap, moodCurve, sleepCurve, goesWith, periodFingerprint } from './rhythm.js';

/**
 * @typedef {Object} Moment
 * @property {string} id         stable, so it can be remembered as seen
 * @property {'timing'|'coming'|'logged'|'finding'|'tip'} kind
 * @property {string} icon       one emoji
 * @property {string} text       one or two short sentences
 * @property {string|null} anchor  an Insights card id to open, if any
 * @property {number} weight     how much she would want to know it
 * @property {number|null} cooldown  days before it may be said again; null = once ever
 */

/**
 * "about twice as often" from two rates. Same wording as the Insights card.
 * @param {number} a
 * @param {number} b
 */
function times(a, b) {
  if (b <= 0) return 'much more often';
  const r = a / b;
  if (r >= 2.75) return 'about three times as often';
  if (r >= 1.75) return 'about twice as often';
  return 'noticeably more often';
}

/**
 * Everything worth saying today, strongest first, before cooldowns.
 *
 * @param {Object} input
 * @param {DateKey} input.today
 * @param {Record<DateKey, DayLog>} input.logs
 * @param {Cycle[]} input.cycles
 * @param {Prediction} input.prediction
 * @param {Settings} input.settings
 * @param {number} input.hour  local hour, 0–23
 * @param {import('./phases.js').PhaseId} [input.phase]  for tips limited to a phase
 * @returns {Moment[]}
 */
export function momentsFor({ today, logs, cycles, prediction, settings, hour, phase = 'unknown' }) {
  /** @type {Moment[]} */
  const out = [];
  const log = logs[today];
  const symptoms = new Set([...(log?.symptoms ?? []), ...(log?.custom ?? [])]);
  const p = prediction;
  const usable = !p.stale && !p.expecting;

  /* ── When things are due ───────────────────────────────────────────── */
  if (usable && p.nextStart) {
    const until = p.daysUntilPeriod;
    if (p.isLate && p.daysLate != null && p.daysLate >= 1) {
      out.push({
        id: `late:${p.nextStart}:${p.daysLate}`,
        kind: 'timing',
        icon: '🗓️',
        text: `Your period is ${plural(p.daysLate, 'day')} later than forecast. `
          + (p.regularity && p.regularity !== 'regular'
            ? 'Your cycles vary, so this happens.'
            : 'Stress, travel or being unwell can shift it. If you could be pregnant, a test is reliable from now.'),
        anchor: null,
        weight: 5.5,
        cooldown: 0,
      });
    } else if (p.withinWindow) {
      out.push({
        id: `anyday:${p.nextStart}`, kind: 'timing', icon: '🩸',
        text: 'Your period could start any day now.',
        anchor: null, weight: 5, cooldown: null,
      });
    } else if (until != null && until >= 1 && until <= 3) {
      out.push({
        id: `soon:${p.nextStart}:${until}`, kind: 'timing', icon: '🎀',
        text: until === 1
          ? 'Your period is likely tomorrow. A good day to pack supplies.'
          : `Your period is likely in ${plural(until, 'day')}, around ${fmtDayMonth(p.nextStart)}. `
            + 'A good day to pack supplies.',
        anchor: null, weight: 5, cooldown: 0,
      });
    }

    if (p.showFertility && !p.onHormonal && p.fertileWindow) {
      const opensIn = daysBetween(today, p.fertileWindow.start);
      if (opensIn === 0 || opensIn === 1) {
        out.push({
          id: `fertile:${p.fertileWindow.start}:${opensIn}`, kind: 'timing', icon: '🌷',
          text: `Your fertile window opens ${opensIn ? 'tomorrow' : 'today'} `
            + `(${fmtDayMonth(p.fertileWindow.start)} to ${fmtDayMonth(p.fertileWindow.end)}).`,
          anchor: null,
          weight: settings.mode === 'conceive' ? 6 : 3.5,
          cooldown: 0,
        });
      }
    }

    /* ── What usually starts about now ───────────────────────────────── */
    if (until != null && until >= 1 && !p.isLate) {
      for (const pattern of premenstrualPatterns(logs, cycles)) {
        if (until > pattern.typicalBefore + 1) continue;
        // She already knows: she just logged it.
        if (symptoms.has(pattern.id) || log?.moods.includes(pattern.id)) continue;
        out.push({
          id: `coming:${pattern.id}:${p.nextStart}`, kind: 'coming', icon: '✨',
          text: `${labelOf(pattern.id)} usually starts around now for you `
            + `(${pattern.cyclesWith} of your last ${pattern.cyclesTotal} cycles).`,
          anchor: 'insight-body', weight: 4, cooldown: null,
        });
        break;
      }
    }
  }

  /* ── About what she just logged ────────────────────────────────────── */
  const map = bodyMap(logs, cycles, 16).filter((row) => row.kind !== 'moods');
  const day = p.cycleDay;
  if (log) {
    for (const row of map) {
      if (!symptoms.has(row.id) || !row.when) continue;
      const w = row.when;
      const usualNow = (w.where === 'period' && day != null && day >= w.from && day <= w.to)
        || (w.where === 'before' && p.daysUntilPeriod != null && p.daysUntilPeriod >= 1
          && p.daysUntilPeriod <= w.from);
      if (!usualNow) continue;
      out.push({
        id: `usual:${row.id}:${p.lastStart}`, kind: 'logged', icon: '💗',
        text: `${row.kind === 'custom' ? row.id : labelOf(row.id)} around now is usual for you `
          + `(${row.cyclesWith} of ${row.cyclesTotal} cycles). Your body is doing what it normally does.`,
        anchor: 'insight-body', weight: 3, cooldown: null,
      });
      break;
    }
  }

  const sleep = sleepCurve(logs, cycles);
  if (log?.sleep != null && log.sleep < 6 && sleep?.finding && sleep.finding.minutes < 0
    && p.daysUntilPeriod != null && p.daysUntilPeriod >= 1 && p.daysUntilPeriod <= 7) {
    out.push({
      id: `sleepdip:${p.nextStart}`, kind: 'logged', icon: '🌙',
      text: 'A short night. Your sleep usually dips in the week before your period, so it is not just you.',
      anchor: 'insight-sleep', weight: 3.2, cooldown: null,
    });
  }

  const pairs = goesWith(logs, today);
  const water = pairs.find((item) => item.condition === 'lowWater');
  if (water && log && log.water > 0 && log.water < 1000 && hour >= 15) {
    const outcome = water.outcome === 'hard-mood' ? 'hard moods' : labelOf(water.outcome).toLowerCase();
    out.push({
      id: `water:${today}`, kind: 'logged', icon: '💧',
      text: `Under 1 L of water so far. On your low-water days, ${outcome} showed up `
        + `${times(water.rateWith, water.rateWithout)}.`,
      anchor: 'insight-pairs', weight: 3, cooldown: null,
    });
  }

  /* ── New in Insights ───────────────────────────────────────────────── */
  /** @param {string} key @param {string} text @param {string} anchor @param {string} icon */
  const finding = (key, text, anchor, icon) => out.push({
    id: `finding:${key}`, kind: 'finding', icon, text: `New in Insights: ${text}`,
    anchor, weight: 4.5, cooldown: null,
  });
  const mood = moodCurve(logs, cycles);
  if (mood?.finding) {
    finding('mood-before', `harder days bunch up in the ${mood.finding.window} days before your period.`,
      'insight-mood', '💭');
  }
  if (sleep?.finding && sleep.finding.minutes < 0) {
    finding('sleep-dip', 'you sleep less in the week before your period.', 'insight-sleep', '🌙');
  }
  if (pairs[0]) {
    const item = pairs[0];
    const outcome = item.outcome === 'hard-mood' ? 'hard moods' : labelOf(item.outcome).toLowerCase();
    finding(`pairs:${item.condition}:${item.outcome}`,
      `${outcome} come ${times(item.rateWith, item.rateWithout)} ${item.condition === 'shortSleep'
        ? 'after short nights' : 'on low-water days'}.`,
      'insight-pairs', item.condition === 'shortSleep' ? '🌙' : '💧');
  }
  const lead = map.find((row) => row.when?.where === 'before');
  if (lead?.when && lead.when.where === 'before') {
    finding(`body:${lead.id}`, `${(lead.kind === 'custom' ? lead.id : labelOf(lead.id)).toLowerCase()} `
      + `usually starts about ${plural(lead.when.from, 'day')} before your period.`, 'insight-body', '✨');
  }
  const fp = periodFingerprint(logs, cycles);
  if (fp?.heaviestDay) {
    finding('heaviest', `day ${fp.heaviestDay.day} of your period is usually the heaviest.`, 'insight-periods', '🩸');
  }

  /* ── A tip about something she logged today ────────────────────────── */
  if (log) {
    const logged = [
      ...log.symptoms, ...log.moods, ...log.discharge, ...log.custom,
      ...(log.sleep != null ? ['sleep'] : []), ...(log.water ? ['water'] : []),
    ];
    const tips = pick({
      phase,
      cycleDay: p.cycleDay,
      loggedToday: logged,
      showFertility: p.showFertility,
      dateSeed: today,
      patternsReady: true,
      limit: 8,
    }).filter((tip) => tip.whenLogged?.some((id) => logged.includes(id)));
    if (tips[0]) {
      out.push({
        id: `tip:${tips[0].id}`, kind: 'tip', icon: '🎀',
        text: `${tips[0].title}. ${tips[0].body}`,
        anchor: null, weight: 2, cooldown: 14,
      });
    }
  }

  return out.sort((a, b) => b.weight - a.weight);
}

/**
 * The moments not said recently, at most `limit`, never two of the same kind
 * except timing (a period due and a fertile window can both matter).
 *
 * @param {Moment[]} moments
 * @param {Record<string, DateKey>} seen  id → the last day it was shown
 * @param {DateKey} today
 * @param {number} [limit]
 */
export function fresh(moments, seen, today, limit = 3) {
  /** @type {Moment[]} */
  const out = [];
  /** @type {Set<string>} */
  const kinds = new Set();
  for (const m of moments) {
    if (out.length >= limit) break;
    const last = seen[m.id];
    if (last) {
      if (m.cooldown == null) continue;
      if (last === today || daysBetween(last, today) <= m.cooldown) continue;
    }
    if (m.kind !== 'timing' && kinds.has(m.kind)) continue;
    kinds.add(m.kind);
    out.push(m);
  }
  return out;
}

/**
 * Seen-ids, with today's added and anything older than two months dropped,
 * so the record stays small however long she uses the app.
 *
 * @param {Record<string, DateKey>} seen
 * @param {Moment[]} shown
 * @param {DateKey} today
 */
export function markSeen(seen, shown, today) {
  /** @type {Record<string, DateKey>} */
  const next = {};
  const floor = addDays(today, -60);
  for (const [id, date] of Object.entries(seen)) {
    // Once-ever moments are kept regardless of age, or they would come back.
    if (date >= floor || id.startsWith('finding:')) next[id] = date;
  }
  for (const m of shown) next[m.id] = today;
  return next;
}
