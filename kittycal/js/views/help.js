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
        'Everything works offline and stays on this phone.' }),

      section('The basics', [
        p('Kittycal learns your cycle from the days you mark as bleeding. ' +
          'Everything else is optional.'),
      ]),

      section('The daily check-in', [
        p('Three questions when you open the app on a new day. On a day when ' +
          'nothing is going on, "Nothing to report today" answers all three at ' +
          'once.'),
        p('Light, medium and heavy mark the day as a period day. Spotting does ' +
          'not — it means bleeding outside a period, and counting it as day one ' +
          'would throw your cycle lengths off.'),
        p('The first question moves on as soon as you tap. "← Back" returns to ' +
          'it with nothing lost.'),
        p('Pick a symptom and you can say how bad it was. Skipping that is fine ' +
          '— it only ever adds to what a symptom means, never subtracts.'),
      ]),

      section('Days you missed', [
        p('The row of seven days under the check-in: a tick means logged, a ' +
          'dashed outline means not. Tap a dashed day to answer the same three ' +
          'questions for it. For anything older, tap the day on the calendar.'),
      ]),

      section('The calendar', [
        legendRow('is-period', 'Filled', 'A period day you logged.'),
        legendRow('is-predicted', 'Dashed outline', 'A period Kittycal expects.'),
        legendRow('is-fertile', 'Tinted', 'The fertile window.'),
        legendRow('is-ovulation', 'Dotted ring', 'The estimated ovulation day.'),
        p('A small dot means something else was logged that day.'),
        p('"Edit period dates" marks days by tapping or dragging. Filling in ' +
          'past months improves every prediction after them.'),
      ]),

      section('The diary', [
        p(`Everything the check-in does not ask about — ${optionCount()} things ` +
          `across ${CATEGORIES.length} categories, plus your own.`),
        p('The search box understands everyday wording, so "sore boobs" and ' +
          '"tired" both work.'),
        p('Nothing is saved until you tap Apply.'),
      ]),

      section('Insights', [
        p('After three complete cycles Kittycal starts looking for things that ' +
          'recur, and where in the cycle they land — "cramps, 8 of 9 cycles, ' +
          'most often on day 1 and 2". Something has to show up in most of your ' +
          'cycles before it counts as a pattern.'),
        p('The report for a doctor is at the bottom: a plain summary of the last ' +
          'six months, sent to your print dialogue. Choose "Save as PDF" there ' +
          'to email it instead.'),
      ]),

      section('How the predictions work', [
        p('Until you have three logged cycles it uses the average you gave it ' +
          'during setup. After that it uses your own cycles, weighting recent ' +
          'ones more heavily.'),
        p('Ovulation is counted backwards from your next expected period, not by ' +
          'halving the cycle. Every prediction shows how confident it is, and ' +
          'the fertile window is drawn wide rather than falsely precise when ' +
          'there is not much history.'),
        p('On hormonal birth control, ovulation and fertile windows are hidden ' +
          'entirely. Period tracking carries on as normal.'),
        p('If your period is more than about two weeks late Kittycal stops ' +
          'naming a phase, and after three months it stops predicting and asks ' +
          'you to mark your most recent period. Nothing is lost.'),
      ]),

      section('What it will not do', [
        p('Kittycal is not contraception. Predicted fertile windows are ' +
          'estimates from your own history, and ovulation moves.'),
        p('It does not diagnose anything. It can tell you when something falls ' +
          `outside the ranges published by ACOG (cycles ${acog.CYCLE_MIN}–` +
          `${acog.CYCLE_MAX} days, bleeding ${acog.PERIOD_MIN}–` +
          `${acog.PERIOD_MAX} days) and suggest mentioning it to a doctor. That ` +
          'is as far as it goes, on purpose.'),
      ]),

      section('Reminders', [
        p('In Settings. They arrive when you next open the app on the day they ' +
          'are due — apps that buzz you out of nowhere run a server that knows ' +
          'your cycle, and Kittycal has none.'),
      ]),

      section('Privacy and passcode', [
        p('No account, no server, no analytics. The app makes no internet ' +
          'requests at all.'),
        p('Settings can put a four-digit code in front of the app. The code is ' +
          'never stored, only a scrambled version. It is not encryption: ' +
          'someone determined, with your unlocked phone, could still reach the ' +
          'data underneath.'),
      ]),

      section('Why it asks you to install it', [
        p('Safari deletes what a website has stored if you go about a week ' +
          'without opening it. Everything Kittycal knows is in that storage, ' +
          'and there is no copy on a server to put it back.'),
        p('A web app on your Home Screen is exempt from that rule, which is ' +
          'why Today asks once you have a few days recorded. Tap the Share ' +
          'button in Safari, then Add to Home Screen. "Not now" hides the ' +
          'message for a fortnight; it comes back because the risk does not go ' +
          'away when the message does.'),
      ]),

      section('Backups and a new phone', [
        p('Settings → Export everything saves a file. That file is the only ' +
          'copy that survives losing or replacing the phone.'),
        p('A "Worth backing up" card appears on Today once there is a fortnight ' +
          'of entries that are not in any backup. "Not now" hides it for a month.'),
        p('Settings → Check a backup file opens a file and says what is in it ' +
          'without importing anything: when it was made, how much it holds, ' +
          'and what restoring it would cost you. It is safe to run on a file ' +
          'you are unsure about.'),
        p('On a new phone, open Kittycal and use Import.'),
      ]),

      section('Shortcuts', [
        p('Once Kittycal is on your home screen, pressing and holding its icon ' +
          'opens a short menu: today\'s diary, the calendar, or Insights, in ' +
          'one tap instead of three.'),
      ]),

      section('Using your own pictures', [
        p('The built-in emblems are original artwork — a bow, a cloud, a star. ' +
          'They are motifs rather than the characters the themes are named ' +
          'after, because those characters belong to somebody else and are not ' +
          'ours to draw or ship.'),
        p('Your phone is a different matter. Settings → Themes → the picture ' +
          'row under the theme you are using lets you put any image from your ' +
          'camera roll in its place. It is cropped in the app, stored on the ' +
          'device, and never uploaded anywhere — Kittycal makes no internet ' +
          'requests at all.'),
      ]),

      section('Themes', [
        p(`${THEMES.length} themes, each with a light and dark version. Any of ` +
          'them can use your own picture instead of the built-in art.'),
        p('The Plain theme turns off all the pattern and colour, which is handy ' +
          'if you want to show a screen to someone.'),
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
