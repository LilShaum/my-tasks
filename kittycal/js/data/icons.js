// @ts-check
/**
 * icons.js — a mark for every option in the diary.
 *
 * ── Why this exists
 *
 * Every one of the 111 loggable options used to carry a system emoji: 🌀 for
 * cramps, 🎈 for bloating, 😴 for fatigue. On the screen this app is used on
 * most, that meant a wall of multi-colour glyphs drawn by the operating system
 * — a different set on every phone, none of them in the palette, all of them
 * louder than the pastel they sat on. Onboarding and the sticker book ship
 * original artwork; the diary was borrowing its pictures from Apple.
 *
 * ── The construction contract
 *
 * One contract, stated here, obeyed by every mark below. The app already has an
 * icon language — the tab bar and the header control — and this is that
 * language, extended rather than invented:
 *
 *   - 24×24 viewBox, always.
 *   - `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, round caps
 *     and joins. Nothing carries its own colour.
 *   - Nothing clips. A stroke is two units wide, so a path reaching 22 is
 *     painted to 23, and `test/icons.mjs` measures the real stroked extent of
 *     every mark and fails anything that comes within half a unit of the box.
 *     Aim for 3…21 when drawing a new one — most marks sit there and it leaves
 *     room to breathe — but a wide mark like "cramps" or "swimming" is allowed
 *     the space it needs. This used to be stated as a flat 3…21 rule, which
 *     fourteen marks quietly broke, so it now says what is actually enforced.
 *
 * `currentColor` is the load-bearing part. A mark inherits the colour of the
 * chip it sits in, so it is correct in all fourteen themes and both colour
 * modes without a single extra declaration — and it goes on being correct when
 * a chip is selected and its text colour flips. That is the whole reason not
 * to draw these with fills.
 *
 * Weight is uniform on purpose. Mascots are illustration and carry three line
 * weights; these are icons and carry one. Mixing the two vocabularies is what
 * makes an icon set look assembled from several places.
 *
 * ── What is deliberately not here
 *
 * No mark tries to be a picture of a sensation. "Backache", "joint pain" and
 * "muscle ache" are not three different drawings, and pretending otherwise
 * produces three identical human silhouettes that are slower to tell apart
 * than the words underneath them. The label is what names the thing; the mark
 * is what lets the eye find it again in a list of thirty-nine.
 *
 * ── The rule that had to be measured before it was believed
 *
 * The first version of this file put related options on a shared base form and
 * varied one element inside it, which reads well written down and failed in
 * the only place that counts. `test/icons.mjs` draws every mark at the 18px a
 * chip really uses and scores each pair: the ten discharge options came out 90
 * to 96% identical to each other, and the ovulation readings "peak" and "high"
 * 98.9%. The shared outline was nearly all of the ink and the element carrying
 * the entire meaning was two or three pixels across. Ten options, one picture.
 *
 * So the rule is now the other way round: **the thing that differs owns the
 * silhouette.** Watery discharge falls as separate drips where creamy is a
 * dollop; sex drive is counted like the flow scale rather than sized; a test
 * mark is the reading itself rather than a stick with the reading drawn inside.
 * Where two options genuinely are near neighbours — "happy" and "playful" are
 * both smiling faces — they are allowed to stay near neighbours, because
 * forcing them apart would misrepresent what they mean.
 *
 * The probe fails any pair in a category that is both over 90% alike and less
 * than 8px of ink apart at 18px — roughly one full stroke. The second half is
 * what lets faces share a head: a smile against a frown is 93% alike and plainly
 * different, where the old "peak" against "high" was 1.5px apart. It is a floor
 * and not a verdict; a mark can pass it and still be a poor drawing of the
 * thing it names, and that part still wants eyes on a contact sheet.
 *
 * ── Where the marks come from
 *
 * Most are Lucide's (see the block that credits it below). The hand-drawn first
 * set followed this contract and still looked wrong on a phone — moods were two
 * dots and a dash with no head, most symptoms filled under half their box, and
 * "Travel" was a sparkle. A professionally drawn set built on the same contract
 * fixed that without a seam. The handful Lucide cannot draw honestly are drawn
 * here, at the same scale.
 *
 * Exported as inner SVG markup rather than as elements, so the same string can
 * be used by `icon()` in the DOM and by the printable report.
 */

/* ── The marks drawn for this app ────────────────────────────────────── */

/**
 * Option id → inner SVG markup.
 *
 * Keyed by the same ids `taxonomy.js` stores, so a renamed option fails the
 * coverage test in taxonomy.test.js rather than silently losing its mark.
 *
 * These are the ones no general icon set can draw honestly — flow counted in
 * droplets, discharge by its consistency, and the two breast symptoms — so
 * they are drawn here. They were first drawn small, using a fraction of the
 * box, and next to the full-size marks below they read as specks. They are
 * redrawn at the same scale and with Lucide's own droplet shape, so the two
 * sources sit together without a seam. Everything else comes from Lucide, in
 * the block that follows.
 *
 * Flow counts rather than sizes (one drop, two, three) because at 18px a count
 * reads and a level does not. Discharge gives each consistency its own
 * outline — drips, a dollop, a stretched strand, curds — because a shared
 * droplet with a texture inside measured 90–96% identical across all ten;
 * brown and grey are colours with no honest silhouette, so they keep the
 * droplet and differ by hatching against stippling.
 *
 * @type {Record<string, string>}
 */
export const ICONS = {
  none: '<path d="M5 12h14"/>',
  spotting: '<circle cx="8" cy="7.5" r="1.4"/><circle cx="15.5" cy="10.5" r="1.4"/><circle cx="10" cy="16.5" r="1.4"/>',
  light: '<path d="M12 3C9.72 8.18 5.5 12.55 5.5 14.5A6.5 6.5 0 0 0 18.5 14.5C18.5 12.55 14.28 8.18 12 3Z"/>',
  medium: '<path d="M7.5 6C6 10.81 3.2 15.41 3.2 16.7A4.3 4.3 0 0 0 11.8 16.7C11.8 15.41 9 10.81 7.5 6Z"/><path d="M16.5 6C15 10.81 12.2 15.41 12.2 16.7A4.3 4.3 0 0 0 20.8 16.7C20.8 15.41 18 10.81 16.5 6Z"/>',
  heavy: '<path d="M5.2 9C4.12 13 2.1 16.97 2.1 17.9A3.1 3.1 0 0 0 8.3 17.9C8.3 16.97 6.29 13 5.2 9Z"/><path d="M12 9C10.91 13 8.9 16.97 8.9 17.9A3.1 3.1 0 0 0 15.1 17.9C15.1 16.97 13.09 13 12 9Z"/><path d="M18.8 9C17.71 13 15.7 16.97 15.7 17.9A3.1 3.1 0 0 0 21.9 17.9C21.9 16.97 19.89 13 18.8 9Z"/>',
  clots: '<circle cx="9" cy="10" r="5.5"/><circle cx="16.5" cy="16" r="4"/>',
  'tender-breasts': '<path d="M2.5 11c0 4.4 2.2 7.5 4.75 7.5S12 15.4 12 11M12 11c0 4.4 2.2 7.5 4.75 7.5S21.5 15.4 21.5 11"/><path d="M7.25 3.5V6M16.75 3.5V6M3.5 5l1.6 1.6M20.5 5l-1.6 1.6"/>',
  'breast-lumps': '<path d="M2.5 11c0 4.4 2.2 7.5 4.75 7.5S12 15.4 12 11M12 11c0 4.4 2.2 7.5 4.75 7.5S21.5 15.4 21.5 11"/><circle cx="16.75" cy="13.2" r="2"/><circle cx="7.25" cy="13.6" r="1.3"/>',
  sticky: '<circle cx="12" cy="7.5" r="4.5"/><path d="M12 12c-1.6 2 1.6 3.5 0 5.5"/><circle cx="12" cy="20.5" r="1"/>',
  creamy: '<path d="M4.5 17a7.5 7.5 0 0 1 15 0Z"/><path d="M2.5 20.5h19"/>',
  watery: '<path d="M6.5 3C5.52 5.79 3.7 8.36 3.7 9.2A2.8 2.8 0 0 0 9.3 9.2C9.3 8.36 7.48 5.79 6.5 3Z"/><path d="M17.5 6C16.52 8.79 14.7 11.36 14.7 12.2A2.8 2.8 0 0 0 20.3 12.2C20.3 11.36 18.48 8.79 17.5 6Z"/><path d="M12 12C11.02 15.02 9.2 17.86 9.2 18.7A2.8 2.8 0 0 0 14.8 18.7C14.8 17.86 12.98 15.02 12 12Z"/>',
  'egg-white': '<path d="M6 3h12M6 21h12"/><path d="M12 3c5 2.5 5 6.5 0 9s-5 6.5 0 9"/>',
  'clumpy-white': '<circle cx="8" cy="9.5" r="4"/><circle cx="16" cy="9" r="4.5"/><circle cx="12" cy="16.5" r="4"/>',
  brown: '<path d="M12 3C9.72 8.18 5.5 12.55 5.5 14.5A6.5 6.5 0 0 0 18.5 14.5C18.5 12.55 14.28 8.18 12 3Z"/><path d="M7.5 15.5 11 19M8.5 12l6.5 6.5M11 10.5l6 6"/>',
  grey: '<path d="M12 3C9.72 8.18 5.5 12.55 5.5 14.5A6.5 6.5 0 0 0 18.5 14.5C18.5 12.55 14.28 8.18 12 3Z"/><circle cx="10" cy="14" r="0.9"/><circle cx="14" cy="14" r="0.9"/><circle cx="12" cy="17.5" r="0.9"/>',
  'unusual-smell': '<path d="M9 5C7.08 9.73 3.5 13.85 3.5 15.5A5.5 5.5 0 0 0 14.5 15.5C14.5 13.85 10.93 9.73 9 5Z"/><path d="M17 3c1.5 1.5 1.5 3 0 4.5s-1.5 3 0 4.5M20.5 3c1.5 1.5 1.5 3 0 4.5s-1.5 3 0 4.5"/>',
  atypical: '<path d="M9.5 5C7.58 9.73 4 13.85 4 15.5A5.5 5.5 0 0 0 15 15.5C15 13.85 11.43 9.73 9.5 5Z"/><path d="M19 4v7M19 15h.01"/>',
};

/*
  ── Marks drawn from Lucide ─────────────────────────────────────────────

  Most of the diary's marks were drawn by hand for this app, and on a phone
  they looked it: faces with no heads (a mood was two dots and a dash),
  symptoms reduced to specks that filled less than half their box, a sparkle
  for "Travel", a capital I for "Alcohol", an eye for "Oral sex". They passed
  every rule this file sets and still read as noise next to the words.

  Lucide is a professionally drawn set built on exactly this file's contract
  — 24×24, open strokes at width 2, round caps and joins, currentColor — so
  its marks sit beside the app's own without a seam, and each one is a
  recognisable picture of something. Used for every option it can draw
  honestly. The ones it cannot — flow counted in droplets, discharge
  textures, the flame scale for sex drive, and the breast marks — stay
  drawn here.

  Lucide is distributed under the ISC licence, which asks that this notice
  travel with the copied work:

    ISC License

    Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2026 as
    part of Feather (MIT). All other copyright (c) for Lucide are held by
    Lucide Contributors 2026.

    Permission to use, copy, modify, and/or distribute this software for any
    purpose with or without fee is hereby granted, provided that the above
    copyright notice and this permission notice appear in all copies.

    THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
    WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
    MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
    SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
    WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
    ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
    IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

  The comment beside each entry names the Lucide icon it came from.
*/
Object.assign(ICONS, {
  calm: "<path d=\"M15 10V9\"/><path d=\"M16.472 15a6 6 0 01-8.943 0\"/><path d=\"M9 10V9\"/><circle cx=\"12\" cy=\"12\" r=\"10\"/>", // face-slightly-smiling
  happy: "<path d=\"M15 10V9\"/><path d=\"M7.084 14.302a5.12 5.12 0 009.833 0 .24.24 0 00-.235-.302H7.32a.24.24 0 00-.235.302\"/><path d=\"M9 10V9\"/><circle cx=\"12\" cy=\"12\" r=\"10\"/>", // laugh
  energetic: "<path d=\"M10 10v4\"/><path d=\"M14 10v4\"/><path d=\"M22 14v-4\"/><path d=\"M6 10v4\"/><rect x=\"2\" y=\"6\" width=\"16\" height=\"12\" rx=\"2\"/>", // battery-full
  playful: "<path d=\"M5.8 11.3 2 22l10.7-3.79\"/><path d=\"M4 3h.01\"/><path d=\"M22 8h.01\"/><path d=\"M15 2h.01\"/><path d=\"M22 20h.01\"/><path d=\"m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10\"/><path d=\"m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17\"/><path d=\"m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7\"/><path d=\"M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z\"/>", // party-popper
  confident: "<path d=\"M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z\"/>", // star
  neutral: "<path d=\"M12 3v18\"/><path d=\"m19 8 3 8a5 5 0 0 1-6 0zV7\"/><path d=\"M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1\"/><path d=\"m5 8 3 8a5 5 0 0 1-6 0zV7\"/><path d=\"M7 21h10\"/>", // scale
  "mood-swings": "<path d=\"m3 16 4 4 4-4\"/><path d=\"M7 20V4\"/><path d=\"m21 8-4-4-4 4\"/><path d=\"M17 4v16\"/>", // arrow-down-up
  irritable: "<path d=\"M14 10h2\"/><path d=\"M8 10h2\"/><path d=\"M8 16h8\"/><circle cx=\"12\" cy=\"12\" r=\"10\"/>", // annoyed
  angry: "<path d=\"M15 12v-1.584\"/><path d=\"M17 10a5 5 0 00-3 1\"/><path d=\"M7 10a5 5 0 013 1\"/><path d=\"M9 12v-1.584\"/><path d=\"M9 17a5 5 0 016.001 0\"/><circle cx=\"12\" cy=\"12\" r=\"10\"/>", // angry
  sad: "<path d=\"M15 10V9\"/><path d=\"M9 10V9\"/><path d=\"M9 16a5 5 0 016 0\"/><circle cx=\"12\" cy=\"12\" r=\"10\"/>", // frown
  anxious: "<path d=\"M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5\"/><path d=\"M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27\"/>", // heart-pulse
  panicky: "<path d=\"M7 18v-6a5 5 0 1 1 10 0v6\"/><path d=\"M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z\"/><path d=\"M21 12h1\"/><path d=\"M18.5 4.5 18 5\"/><path d=\"M2 12h1\"/><path d=\"M12 2v1\"/><path d=\"m4.929 4.929.707.707\"/><path d=\"M12 12v6\"/>", // siren
  low: "<path d=\"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242\"/><path d=\"M16 14v6\"/><path d=\"M8 14v6\"/><path d=\"M12 16v6\"/>", // cloud-rain
  apathetic: "<circle cx=\"12\" cy=\"12\" r=\"1\"/><circle cx=\"19\" cy=\"12\" r=\"1\"/><circle cx=\"5\" cy=\"12\" r=\"1\"/>", // ellipsis
  "low-energy": "<path d=\"M22 14v-4\"/><path d=\"M6 14v-4\"/><rect x=\"2\" y=\"6\" width=\"16\" height=\"12\" rx=\"2\"/>", // battery-low
  confused: "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3\"/><path d=\"M12 17h.01\"/>", // circle-help
  guilty: "<circle cx=\"12\" cy=\"5\" r=\"3\"/><path d=\"M6.5 8a2 2 0 0 0-1.905 1.46L2.1 18.5A2 2 0 0 0 4 21h16a2 2 0 0 0 1.925-2.54L19.4 9.5A2 2 0 0 0 17.48 8Z\"/>", // weight
  obsessive: "<path d=\"m17 2 4 4-4 4\"/><path d=\"M3 11v-1a4 4 0 0 1 4-4h14\"/><path d=\"m7 22-4-4 4-4\"/><path d=\"M21 13v1a4 4 0 0 1-4 4H3\"/>", // repeat
  "self-critical": "<path d=\"M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z\"/><path d=\"M17 14V2\"/>", // thumbs-down
  cramps: "<path d=\"M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z\"/>", // zap
  "abdominal-pain": "<circle cx=\"12\" cy=\"12\" r=\"1\"/><circle cx=\"12\" cy=\"12\" r=\"10\"/>", // circle-dot
  "ovulation-pain": "<path d=\"M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12\"/>", // egg
  backache: "<circle cx=\"12\" cy=\"5\" r=\"1\"/><path d=\"m9 20 3-6 3 6\"/><path d=\"m6 8 6 2 6-2\"/><path d=\"M12 10v4\"/>", // person-standing
  headache: "<path d=\"M12 18V5\"/><path d=\"M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4\"/><path d=\"M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5\"/><path d=\"M17.997 5.125a4 4 0 0 1 2.526 5.77\"/><path d=\"M18 18a4 4 0 0 0 2-7.464\"/><path d=\"M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517\"/><path d=\"M6 18a4 4 0 0 1-2-7.464\"/><path d=\"M6.003 5.125a4 4 0 0 0-2.526 5.77\"/>", // brain
  migraine: "<path d=\"M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z\"/><path d=\"M9 13a4.5 4.5 0 0 0 3-4\"/><path d=\"M6.003 5.125A3 3 0 0 0 6.401 6.5\"/><path d=\"M3.477 10.896a4 4 0 0 1 .585-.396\"/><path d=\"M6 18a4 4 0 0 1-1.967-.516\"/><path d=\"M12 13h4\"/><path d=\"M12 18h6a2 2 0 0 1 2 2v1\"/><path d=\"M12 8h8\"/><path d=\"M16 8V5a2 2 0 0 1 2-2\"/><circle cx=\"16\" cy=\"13\" r=\".5\"/><circle cx=\"18\" cy=\"3\" r=\".5\"/><circle cx=\"20\" cy=\"21\" r=\".5\"/><circle cx=\"20\" cy=\"8\" r=\".5\"/>", // brain-circuit
  bloating: "<path d=\"M12 16v1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v1\"/><path d=\"M12 6a2 2 0 0 1 2 2\"/><path d=\"M18 8c0 4-3.5 8-6 8s-6-4-6-8a6 6 0 0 1 12 0\"/>", // balloon
  gas: "<path d=\"M7.001 15.085A1.5 1.5 0 0 1 9 16.5\"/><circle cx=\"18.5\" cy=\"8.5\" r=\"3.5\"/><circle cx=\"7.5\" cy=\"16.5\" r=\"5.5\"/><circle cx=\"7.5\" cy=\"4.5\" r=\"2.5\"/>", // bubbles
  nausea: "<path d=\"M2 12q2.5 2 5 0t5 0 5 0 5 0\"/><path d=\"M2 19q2.5 2 5 0t5 0 5 0 5 0\"/><path d=\"M2 5q2.5 2 5 0t5 0 5 0 5 0\"/>", // waves
  vomiting: "<path d=\"M12 2v8\"/><path d=\"M2 15c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1\"/><path d=\"M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1\"/><path d=\"m8 6 4-4 4 4\"/>", // waves-arrow-up
  diarrhea: "<path d=\"M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z\"/><path d=\"M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97\"/>", // droplets
  constipation: "<path d=\"M5 22h14\"/><path d=\"M5 2h14\"/><path d=\"M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22\"/><path d=\"M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2\"/>", // hourglass
  indigestion: "<path d=\"M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4\"/>", // flame
  fatigue: "<path d=\"M2 4v16\"/><path d=\"M2 8h18a2 2 0 0 1 2 2v10\"/><path d=\"M2 17h20\"/><path d=\"M6 8v9\"/>", // bed
  dizziness: "<path d=\"M20.341 6.484A10 10 0 0 1 10.266 21.85\"/><path d=\"M3.659 17.516A10 10 0 0 1 13.74 2.152\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/><circle cx=\"19\" cy=\"5\" r=\"2\"/><circle cx=\"5\" cy=\"19\" r=\"2\"/>", // orbit
  fainting: "<path d=\"M12 17V3\"/><path d=\"m6 11 6 6 6-6\"/><path d=\"M19 21H5\"/>", // arrow-down-to-line
  insomnia: "<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>", // eye
  "restless-sleep": "<path d=\"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401\"/>", // moon
  "night-sweats": "<path d=\"M11 20v2\"/><path d=\"M18.376 14.512a6 6 0 0 0 3.461-4.127c.148-.625-.659-.97-1.248-.714a4 4 0 0 1-5.259-5.26c.255-.589-.09-1.395-.716-1.248a6 6 0 0 0-4.594 5.36\"/><path d=\"M3 20a5 5 0 1 1 8.9-4H13a3 3 0 0 1 2 5.24\"/><path d=\"M7 19v2\"/>", // cloud-moon-rain
  "hot-flashes": "<path d=\"M12 2v2\"/><path d=\"M12 8a4 4 0 0 0-1.645 7.647\"/><path d=\"M2 12h2\"/><path d=\"M20 14.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z\"/><path d=\"m4.93 4.93 1.41 1.41\"/><path d=\"m6.34 17.66-1.41 1.41\"/>", // thermometer-sun
  "vaginal-dryness": "<path d=\"M18.715 13.186C18.29 11.858 17.384 10.607 16 9.5c-2-1.6-3.5-4-4-6.5a10.7 10.7 0 0 1-.884 2.586\"/><path d=\"m2 2 20 20\"/><path d=\"M8.795 8.797A11 11 0 0 1 8 9.5C6 11.1 5 13 5 15a7 7 0 0 0 13.222 3.208\"/>", // droplet-off
  chills: "<path d=\"m10 20-1.25-2.5L6 18\"/><path d=\"M10 4 8.75 6.5 6 6\"/><path d=\"M10.585 15H10\"/><path d=\"M2 12h6.5L10 9\"/><path d=\"M20 14.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z\"/><path d=\"m4 10 1.5 2L4 14\"/><path d=\"m7 21 3-6-1.5-3\"/><path d=\"m7 3 3 6h2\"/>", // thermometer-snowflake
  fever: "<path d=\"M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z\"/>", // thermometer
  acne: "<path d=\"M3 7V5a2 2 0 0 1 2-2h2\"/><path d=\"M17 3h2a2 2 0 0 1 2 2v2\"/><path d=\"M21 17v2a2 2 0 0 1-2 2h-2\"/><path d=\"M7 21H5a2 2 0 0 1-2-2v-2\"/><path d=\"M8 14s1.5 2 4 2 4-2 4-2\"/><path d=\"M9 9h.01\"/><path d=\"M15 9h.01\"/>", // scan-face
  "oily-skin": "<path d=\"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z\"/>", // sparkle
  "dry-skin": "<path d=\"M11 20a10 10 0 0010-10 25.9 25.9 0 00-1.04-7.281 1 1 0 00-1.755-.325C15.833 5.5 13 5.5 9.8 6.1A7 7 0 0011 20\"/><path d=\"M2 21a5 5 0 012.911-4.544C7.613 15.212 8.351 15.24 11 13\"/>", // leaf
  itching: "<path d=\"M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2\"/><path d=\"M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2\"/><path d=\"M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8\"/><path d=\"M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15\"/>", // hand
  "hair-loss": "<circle cx=\"6\" cy=\"6\" r=\"3\"/><path d=\"M8.12 8.12 12 12\"/><path d=\"M20 4 8.12 15.88\"/><circle cx=\"6\" cy=\"18\" r=\"3\"/><path d=\"M14.8 14.8 20 20\"/>", // scissors
  "joint-pain": "<path d=\"M17 10c.7-.7 1.69 0 2.5 0a2.5 2.5 0 1 0 0-5 .5.5 0 0 1-.5-.5 2.5 2.5 0 1 0-5 0c0 .81.7 1.8 0 2.5l-7 7c-.7.7-1.69 0-2.5 0a2.5 2.5 0 0 0 0 5c.28 0 .5.22.5.5a2.5 2.5 0 1 0 5 0c0-.81-.7-1.8 0-2.5Z\"/>", // bone
  "brain-fog": "<path d=\"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242\"/><path d=\"M16 17H7\"/><path d=\"M17 21H9\"/>", // cloud-fog
  swelling: "<path d=\"M15 3h6v6\"/><path d=\"m21 3-7 7\"/><path d=\"m3 21 7-7\"/><path d=\"M9 21H3v-6\"/>", // maximize-2
  cravings: "<path d=\"M11 17h.01\"/><path d=\"M11.496 2c.324-.016.558.292.529.615a4 4 0 004.235 4.368.713.713 0 01.758.757 4 4 0 004.366 4.237c.323-.03.63.204.614.527a10 10 0 01-2.915 6.566A1 1 0 114.93 4.918 10 10 0 0111.496 2\"/><path d=\"M12 12h.01\"/><path d=\"M16 16h.01\"/><path d=\"M16 3h.01\"/><path d=\"M21 4h.01\"/><path d=\"M21 8h.01\"/><path d=\"M7 14h.01\"/><path d=\"M9 8h.01\"/>", // cookie
  "increased-appetite": "<path d=\"M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2\"/><path d=\"M7 2v20\"/><path d=\"M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7\"/>", // utensils
  "low-appetite": "<path d=\"m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8\"/><path d=\"M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7\"/><path d=\"m2.1 21.8 6.4-6.3\"/><path d=\"m19 5-7 7\"/>", // utensils-crossed
  "frequent-urination": "<path d=\"M7 12h13a1 1 0 0 1 1 1 5 5 0 0 1-5 5h-.598a.5.5 0 0 0-.424.765l1.544 2.47a.5.5 0 0 1-.424.765H5.402a.5.5 0 0 1-.424-.765L7 18\"/><path d=\"M8 18a5 5 0 0 1-5-5V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8\"/>", // toilet
  "uti-pain": "<path d=\"M12 2c1 3 2.5 3.5 3.5 4.5A5 5 0 0 1 17 10a5 5 0 1 1-10 0c0-.3 0-.6.1-.9a2 2 0 1 0 3.3-2C8 4.5 11 2 12 2Z\"/><path d=\"m5 22 14-4\"/><path d=\"m5 18 14 4\"/>", // flame-kindling
  thrush: "<path d=\"M12 20v-9\"/><path d=\"M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z\"/><path d=\"M14.12 3.88 16 2\"/><path d=\"M21 21a4 4 0 0 0-3.81-4\"/><path d=\"M21 5a4 4 0 0 1-3.55 3.97\"/><path d=\"M22 13h-4\"/><path d=\"M3 21a4 4 0 0 1 3.81-4\"/><path d=\"M3 5a4 4 0 0 0 3.55 3.97\"/><path d=\"M6 13H2\"/><path d=\"m8 2 1.88 1.88\"/><path d=\"M9 7.13V6a3 3 0 1 1 6 0v1.13\"/>", // bug
  protected: "<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\"/><path d=\"m9 12 2 2 4-4\"/>", // shield-check
  unprotected: "<path d=\"m2 2 20 20\"/><path d=\"M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.67 8.94a1 1 0 0 0 .67.01c2.35-.82 4.48-1.97 5.9-3.71\"/><path d=\"M9.309 3.652A12.252 12.252 0 0 0 11.24 2.28a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7a9.784 9.784 0 0 1-.08 1.264\"/>", // shield-off
  oral: "<path d=\"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719\"/><path d=\"M7.828 13.07A3 3 0 0 1 12 8.764a3 3 0 0 1 5.004 2.224 3 3 0 0 1-.832 2.083l-3.447 3.62a1 1 0 0 1-1.45-.001z\"/>", // message-circle-heart
  anal: "<path d=\"M19.414 14.414C21 12.828 22 11.5 22 9.5a5.5 5.5 0 0 0-9.591-3.676.6.6 0 0 1-.818.001A5.5 5.5 0 0 0 2 9.5c0 2.3 1.5 4 3 5.5l5.535 5.362a2 2 0 0 0 2.879.052 2.12 2.12 0 0 0-.004-3 2.124 2.124 0 1 0 3-3 2.124 2.124 0 0 0 3.004 0 2 2 0 0 0 0-2.828l-1.881-1.882a2.41 2.41 0 0 0-3.409 0l-1.71 1.71a2 2 0 0 1-2.828 0 2 2 0 0 1 0-2.828l2.823-2.762\"/>", // heart-handshake
  masturbation: "<path d=\"M11 14h2a2 2 0 0 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 16\"/><path d=\"m14.45 13.39 5.05-4.694C20.196 8 21 6.85 21 5.75a2.75 2.75 0 0 0-4.797-1.837.276.276 0 0 1-.406 0A2.75 2.75 0 0 0 11 5.75c0 1.2.802 2.248 1.5 2.946L16 11.95\"/><path d=\"m2 15 6 6\"/><path d=\"m7 20 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a1 1 0 0 0-2.75-2.91\"/>", // hand-heart
  toys: "<path d=\"m2 8 2 2-2 2 2 2-2 2\"/><path d=\"m22 8-2 2 2 2-2 2 2 2\"/><rect width=\"8\" height=\"14\" x=\"8\" y=\"5\" rx=\"1\"/>", // vibrate
  orgasm: "<path d=\"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z\"/><path d=\"M20 2v4\"/><path d=\"M22 4h-4\"/><circle cx=\"4\" cy=\"20\" r=\"2\"/>", // sparkles
  painful: "<path d=\"M12.409 5.824c-.702.792-1.15 1.496-1.415 2.166l2.153 2.156a.5.5 0 0 1 0 .707l-2.293 2.293a.5.5 0 0 0 0 .707L12 15\"/><path d=\"M13.508 20.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5a5.5 5.5 0 0 1 9.591-3.677.6.6 0 0 0 .818.001A5.5 5.5 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5z\"/>", // heart-crack
  walking: "<path d=\"M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z\"/><path d=\"M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z\"/><path d=\"M16 17h4\"/><path d=\"M4 13h4\"/>", // footprints
  running: "<line x1=\"10\" x2=\"14\" y1=\"2\" y2=\"2\"/><line x1=\"12\" x2=\"15\" y1=\"14\" y2=\"11\"/><circle cx=\"12\" cy=\"14\" r=\"8\"/>", // timer
  gym: "<path d=\"M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z\"/><path d=\"m2.5 21.5 1.4-1.4\"/><path d=\"m20.1 3.9 1.4-1.4\"/><path d=\"M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z\"/><path d=\"m9.6 14.4 4.8-4.8\"/>", // dumbbell
  yoga: "<path d=\"M12 5a3 3 0 1 1 3 3m-3-3a3 3 0 1 0-3 3m3-3v1M9 8a3 3 0 1 0 3 3M9 8h1m5 0a3 3 0 1 1-3 3m3-3h-1m-2 3v-1\"/><circle cx=\"12\" cy=\"8\" r=\"2\"/><path d=\"M12 10v12\"/><path d=\"M12 22c4.2 0 7-1.667 7-5-4.2 0-7 1.667-7 5Z\"/><path d=\"M12 22c-4.2 0-7-1.667-7-5 4.2 0 7 1.667 7 5Z\"/>", // flower-2
  pilates: "<circle cx=\"12\" cy=\"12\" r=\"10\"/><circle cx=\"12\" cy=\"12\" r=\"6\"/><circle cx=\"12\" cy=\"12\" r=\"2\"/>", // target
  cycling: "<circle cx=\"18.5\" cy=\"17.5\" r=\"3.5\"/><circle cx=\"5.5\" cy=\"17.5\" r=\"3.5\"/><circle cx=\"15\" cy=\"5\" r=\"1\"/><path d=\"M12 17.5V14l-3-3 4-3 2 3h2\"/>", // bike
  swimming: "<path d=\"M19 5a2 2 0 0 0-2 2v11\"/><path d=\"M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1\"/><path d=\"M7 13h10\"/><path d=\"M7 9h10\"/><path d=\"M9 5a2 2 0 0 0-2 2v11\"/>", // waves-ladder
  dance: "<path d=\"M9 18V5l12-2v13\"/><circle cx=\"6\" cy=\"18\" r=\"3\"/><circle cx=\"18\" cy=\"16\" r=\"3\"/>", // music
  "team-sport": "<path d=\"M11 7a16 16 20 0 1 10.98 4.362\"/><path d=\"M12 12a13 13 0 0 1-8.66 5\"/><path d=\"M16.83 13.634a16 16 0 0 1-9.267 7.328\"/><path d=\"M20.66 17A13 13 0 0 0 12 12a13 13 0 0 1 0-10\"/><path d=\"M8.17 15.366a16 16 0 0 1-1.713-11.69\"/><circle cx=\"12\" cy=\"12\" r=\"10\"/>", // volleyball
  aerobics: "<path d=\"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2\"/>", // activity
  travel: "<path d=\"M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z\"/>", // plane
  stress: "<path d=\"m12 14 4-4\"/><path d=\"M3.34 19a10 10 0 1 1 17.32 0\"/>", // gauge
  alcohol: "<path d=\"M8 22h8\"/><path d=\"M7 10h10\"/><path d=\"M12 15v7\"/><path d=\"M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z\"/>", // wine
  illness: "<path d=\"M10 10.01h.01\"/><path d=\"M10 14.01h.01\"/><path d=\"M14 10.01h.01\"/><path d=\"M14 14.01h.01\"/><path d=\"M18 6v12\"/><path d=\"M6 6v12\"/><rect x=\"2\" y=\"6\" width=\"20\" height=\"12\" rx=\"2\"/>", // bandage
  "new-medication": "<path d=\"m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z\"/><path d=\"m8.5 8.5 7 7\"/>", // pill
  hrt: "<circle cx=\"7\" cy=\"7\" r=\"5\"/><circle cx=\"17\" cy=\"17\" r=\"5\"/><path d=\"M12 17h10\"/><path d=\"m3.46 10.54 7.08-7.08\"/>", // tablets
  "doctor-visit": "<path d=\"M11 2v2\"/><path d=\"M5 2v2\"/><path d=\"M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1\"/><path d=\"M8 15a6 6 0 0 0 12 0v-3\"/><circle cx=\"20\" cy=\"10\" r=\"2\"/>", // stethoscope
  "poor-diet": "<path d=\"M12 16H4a2 2 0 1 1 0-4h16a2 2 0 1 1 0 4h-4.25\"/><path d=\"M5 12a2 2 0 0 1-2-2 9 7 0 0 1 18 0 2 2 0 0 1-2 2\"/><path d=\"M5 16a2 2 0 0 0-2 2 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 2 2 0 0 0-2-2q0 0 0 0\"/><path d=\"m6.67 12 6.13 4.6a2 2 0 0 0 2.8-.4l3.15-4.2\"/>", // hamburger
  "big-day": "<path d=\"M12.127 21H5a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v5.125\"/><path d=\"M14.62 17.8A2.25 2.25 0 1118 14.836a2.25 2.25 0 113.38 2.966l-2.626 2.856a.998.998 0 01-1.507 0z\"/><path d=\"M16 2v3\"/><path d=\"M3 9h18\"/><path d=\"M8 2v3\"/>", // calendar-heart
  positive: "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M8 12h8\"/><path d=\"M12 8v8\"/>", // circle-plus
  negative: "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M8 12h8\"/>", // circle-minus
  peak: "<path d=\"M4 4v16\"/><path d=\"M9 4v16\"/><path d=\"M14 4v16\"/>", // tally-3
  high: "<path d=\"m14.479 19.374-.971.939a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5a5.2 5.2 0 0 1-.219 1.49\"/><path d=\"M15 15h6\"/><path d=\"M18 12v6\"/>", // heart-plus
});

/**
 * Option ids whose mark depends on which category they appear in.
 *
 * `none`, `negative`, `high`, `low` and `neutral` each appear in more than one
 * category. Most of the time that costs nothing: `none` is an absence wherever
 * it turns up — no bleeding, no discharge, no sex, no exercise — and all four
 * draw the same plain dash on purpose, so the dash is a convention the eye
 * learns once instead of four drawings of nothing.
 *
 * Listed here are the ids where the same word is genuinely a different thing.
 * "Low" and "Neutral" in sex drive are points on a scale rather than an
 * absence, and a test reading of "High" or "Negative" is a line on a stick.
 * Those are keyed `category:id` and win over the plain id.
 *
 * @type {Record<string, string>}
 */
export const ICONS_BY_CATEGORY = {
  'drive:low': "<path d=\"M10.5 4.893a5.5 5.5 0 0 1 1.091.931.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 1.872-1.002 3.356-2.187 4.655\"/><path d=\"m16.967 16.967-3.459 3.346a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5a5.5 5.5 0 0 1 2.747-4.761\"/><path d=\"m2 2 20 20\"/>", // heart-off
  'drive:neutral': "<path d=\"M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5\"/>", // heart
  'testOvulation:high': "<path d=\"M4 4v16\"/><path d=\"M9 4v16\"/>", // tally-2
  'testOvulation:negative': "<path d=\"M4 4v16\"/>", // tally-1
};

/**
 * The mark for an option, or null when it has none.
 *
 * @param {string} id
 * @param {string} [category] the category the option was found in
 * @returns {string|null} inner SVG markup
 */
export function iconFor(id, category) {
  if (category && ICONS_BY_CATEGORY[`${category}:${id}`]) {
    return ICONS_BY_CATEGORY[`${category}:${id}`];
  }
  return ICONS[id] ?? null;
}
