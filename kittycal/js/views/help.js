// @ts-check
/**
 * help.js — what everything does.
 *
 * Opened from the "?" in the header and from Settings, rather than living in
 * the tab bar: a help tab would take a quarter of the main navigation for
 * something read a handful of times.
 *
 * Written for someone who did not build the app. It explains what each screen
 * is for, what the calendar colours mean, and — the part most apps skip — how
 * the predictions are actually calculated and where they stop being reliable.
 */

import { el } from '../utils/dom.js';
import { openSheet } from '../ui/sheet.js';
import { optionCount, CATEGORIES } from '../data/taxonomy.js';
import { THEMES } from '../data/themes.js';
import * as acog from '../domain/acog.js';

/** Open the help sheet. */
export function openHelp() {
  openSheet({
    title: 'How Kittycal works',
    body: [
      el('p', { class: 'hint', text:
        'Everything here works offline and stays on this phone. Tap a heading ' +
        'to read more.' }),

      section('The basics', [
        p('Kittycal learns your cycle from the days you mark as bleeding. That ' +
          'is the only thing it needs — everything else is optional.'),
        p('The more you log, the better it gets, but you can use it perfectly ' +
          'well by only marking your period each month.'),
      ]),

      section('The Today screen', [
        p('The ring is your whole cycle. The marker shows where today sits, and ' +
          'the big number counts down to whatever comes next — your period, or ' +
          'ovulation if that is sooner.'),
        p('Under it is the phase you are in and what tends to happen during it. ' +
          '"Log today" opens the diary. Below that are the next period, the ' +
          'fertile window if it applies to you, and a few cards worth knowing.'),
      ]),

      section('The calendar and its colours', [
        p('Tap any day — past or future — to see what was logged and add to it.'),
        legendRow('is-period', 'Filled', 'A period day you logged.'),
        legendRow('is-predicted', 'Dashed outline', 'A period Kittycal expects. ' +
          'Never filled in, so a guess can never look like a record.'),
        legendRow('is-fertile', 'Tinted', 'The fertile window.'),
        legendRow('is-ovulation', 'Dotted ring', 'The estimated ovulation day.'),
        p('A small dot under a date means something else was logged that day.'),
        p('"Edit period dates" lets you tap or drag across days to mark them. ' +
          'Filling in past months is worth doing — every prediction after them ' +
          'improves. "Year" shows all twelve months at once, which is the view ' +
          'to bring to an appointment.'),
      ]),

      section('Logging a day', [
        p(`There are ${optionCount()} things you can record across ` +
          `${CATEGORIES.length} categories, plus anything you add yourself.`),
        p('Categories start closed so the screen is not a wall of buttons. Use ' +
          'the search box at the top to find something instantly — it ' +
          'understands everyday wording, so "sore boobs" and "tired" both work.'),
        p('Nothing is saved until you tap Apply, so you can tap around freely. ' +
          'Closing the sheet throws the changes away.'),
        p('Marking light, medium, heavy or clots also marks that day as a period ' +
          'day. Spotting deliberately does not — it means bleeding outside a ' +
          'period, and counting it as day one would throw the maths off.'),
      ]),

      section('The look back at each cycle', [
        p('When a new period starts, the cycle before it is finally complete — ' +
          'so Kittycal puts a short summary of it at the top of Today for the ' +
          'week after.'),
        p('It says how long the cycle and period were, how that compares with ' +
          'your usual, and anything that came up on more than one day. If you ' +
          'have not logged enough cycles for "usual" to mean anything yet, it ' +
          'leaves the comparison out rather than guessing.'),
        p('Tap the ✕ to dismiss it. It will not come back for that cycle, and ' +
          'the next one will still appear.'),
      ]),

      section('Insights and patterns', [
        p('Cycle and period length are charted against the typical ranges, with ' +
          'anything unusual highlighted.'),
        p('Patterns is the useful one. After three complete cycles Kittycal ' +
          'starts looking for things that recur — and, more importantly, where ' +
          'in the cycle they land. "Cramps, 8 of 9 cycles, most often on day 1 ' +
          'and 2" is something you can act on.'),
        p('It is deliberately cautious: something has to show up in most of your ' +
          'cycles before it is called a pattern.'),
      ]),

      section('The report for a doctor', [
        p('At the bottom of Insights. It builds a plain summary of the last six ' +
          'months — cycle lengths, period lengths, recurring symptoms, and ' +
          'anything outside the typical ranges — and opens your print dialogue.'),
        p('Choose "Save as PDF" there if you would rather email it than print it.'),
      ]),

      section('How the predictions work', [
        p('Until you have three logged cycles, Kittycal uses the average you ' +
          'gave it during setup.'),
        p('After that it uses your own cycles, weighting recent ones more ' +
          'heavily. If your cycle length changes and stays changed for three ' +
          'cycles, it re-anchors onto the new normal instead of being dragged ' +
          'back by old data.'),
        p('Ovulation is estimated by counting backwards from your next expected ' +
          'period, not by halving the cycle. The second half of a cycle is the ' +
          'consistent part, so counting back from it is more reliable.'),
        p('Every prediction shows how confident it is. When there is not enough ' +
          'history, the fertile window is drawn deliberately wide rather than ' +
          'narrow and falsely precise.'),
        p('If you use hormonal birth control, ovulation and fertile windows are ' +
          'hidden entirely. Ovulation is not happening, so a prediction would ' +
          'be worse than nothing. Period tracking carries on as normal.'),
      ]),

      section('What it will not do', [
        p('Kittycal is not contraception. Predicted fertile windows are ' +
          'estimates from your own history, and ovulation moves.'),
        p('It does not diagnose anything. It can tell you when something you ' +
          'logged falls outside the ranges published by ACOG ' +
          `(cycles ${acog.CYCLE_MIN}–${acog.CYCLE_MAX} days, bleeding ` +
          `${acog.PERIOD_MIN}–${acog.PERIOD_MAX} days), and it will suggest ` +
          'mentioning that to a doctor. That is as far as it goes, on purpose.'),
      ]),

      section('Reminders', [
        p('In Settings. You can be reminded when a period is coming, when it is ' +
          'late, when the fertile window opens, to take birth control, or just ' +
          'to log.'),
        p('These arrive when you next open the app on the day they are due. ' +
          'Apps that buzz you out of nowhere do it by running a server that ' +
          'knows your cycle. Kittycal has no server, so this is the honest ' +
          'limit of what it can do.'),
      ]),

      section('Passcode and privacy', [
        p('Settings can put a four-digit code in front of the app.'),
        p('The code itself is never stored — only a scrambled version that ' +
          'cannot be turned back. It keeps the app shut to whoever picks up ' +
          'your phone. It is not encryption: someone determined, with your ' +
          'unlocked phone, could still reach the data underneath.'),
        p('There is no account, no server and no analytics. The app makes no ' +
          'internet requests at all — even the fonts are part of it.'),
      ]),

      section('Backups and a new phone', [
        p('Your data lives in this browser on this phone. Adding Kittycal to ' +
          'your Home Screen — which you have done — stops it being cleared ' +
          'automatically.'),
        p('Settings → Export everything saves a file with all of it. That file ' +
          'is the only copy that survives losing or replacing the phone, so it ' +
          'is worth doing occasionally.'),
        p('Because that is easy to forget, Kittycal keeps an eye on it. Once ' +
          'there are about two weeks of entries that are not in any backup, a ' +
          '"Worth backing up" card appears near the bottom of Today with a ' +
          'button that does it in one tap.'),
        p('"Not now" hides it for a month rather than for good — the data is ' +
          'still only in one place, and by then there is more of it. Backing ' +
          'up makes it go away properly.'),
        p('On a new phone, open Kittycal and use Import to bring it all back.'),
      ]),

      section('Themes and pictures', [
        p(`There are ${THEMES.length} themes, each with a light and dark ` +
          'version. Settings → Themes.'),
        p('Any theme can use your own picture instead of the built-in art — tap ' +
          'the picture row under the theme grid and pick something from your ' +
          'camera roll. It stays on the phone like everything else.'),
        p('The Plain theme turns off all the patterns and colour, which is ' +
          'handy if you ever want to show a screen to someone.'),
      ]),
    ],
  });
}

/**
 * @param {string} title
 * @param {(Node|string|false|null)[]} children
 */
function section(title, children) {
  return el('details', { class: 'log-section' }, [
    el('summary', { class: 'log-section-head' }, [
      el('span', { class: 'log-section-title', text: title }),
      el('span', { class: 'log-chevron', 'aria-hidden': 'true', text: '⌄' }),
    ]),
    el('div', { class: 'log-section-body help-body' }, children),
  ]);
}

/** @param {string} text */
const p = (text) => el('p', { class: 'hint', text });

/**
 * A calendar-swatch example, so the colours are explained by showing them
 * rather than only describing them.
 * @param {string} cls
 * @param {string} name
 * @param {string} meaning
 */
function legendRow(cls, name, meaning) {
  return el('div', { class: 'help-legend' }, [
    el('span', { class: `cal-legend-swatch ${cls}`, 'aria-hidden': 'true' }),
    el('span', {}, [el('strong', { text: `${name}. ` }), meaning]),
  ]);
}
