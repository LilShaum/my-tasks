// @ts-check
/**
 * mascots.js — original mascot artwork.
 *
 * These are charm emblems, not character portraits: each one is built from a
 * theme's signature *motif* — a bow, a cloud, a star, a yolk, a fin — drawn
 * from generic geometric primitives. That's a deliberate design constraint,
 * and it's also why the app ships with art at all rather than empty slots.
 * If she wants a specific picture instead, Settings → Themes → "use your own
 * picture" replaces any of these with an image from her camera roll.
 *
 * Every emblem is a 100×100 viewBox and paints itself from theme tokens
 * (--primary, --accent, --line), so one drawing works in all 14 palettes and
 * in both light and dark mode.
 */

const S = 'var(--line)';        // outline
const P = 'var(--primary)';     // fill
const A = 'var(--accent)';      // accent fill
const W = 'var(--card)';        // "paper" white, follows dark mode

/**
 * Emblem markup, keyed by theme id. Values are the inner content of a
 * `<svg viewBox="0 0 100 100">`.
 * @type {Record<string, string>}
 */
export const EMBLEMS = {
  /* Ribbon bow — two loops, a knot, two tails. */
  hellokitty: `
    <path d="M50 48 C36 30 12 30 10 48 C12 66 36 66 50 48Z" fill="${P}" stroke="${S}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M50 48 C64 30 88 30 90 48 C88 66 64 66 50 48Z" fill="${P}" stroke="${S}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M42 58 C36 72 34 82 38 90" fill="none" stroke="${S}" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M58 58 C64 72 66 82 62 90" fill="none" stroke="${S}" stroke-width="3.5" stroke-linecap="round"/>
    <circle cx="50" cy="49" r="10" fill="${A}" stroke="${S}" stroke-width="3.5"/>`,

  /* Heart with a small bow — sweet, guileless. */
  mymelody: `
    <path d="M50 88 C22 66 12 52 12 40 A19 19 0 0 1 50 33 A19 19 0 0 1 88 40 C88 52 78 66 50 88Z"
      fill="${P}" stroke="${S}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M50 26 C42 16 28 16 27 26 C28 34 42 34 50 26Z" fill="${A}" stroke="${S}" stroke-width="3"/>
    <path d="M50 26 C58 16 72 16 73 26 C72 34 58 34 50 26Z" fill="${A}" stroke="${S}" stroke-width="3"/>
    <circle cx="50" cy="26" r="5" fill="${W}" stroke="${S}" stroke-width="3"/>`,

  /* Three-point jester cap with bell tips. */
  kuromi: `
    <path d="M20 74 Q20 36 33 20 L40 38 L50 16 L60 38 L67 20 Q80 36 80 74 Z"
      fill="${P}" stroke="${S}" stroke-width="3.5" stroke-linejoin="round"/>
    <circle cx="33" cy="18" r="6" fill="${A}" stroke="${S}" stroke-width="3"/>
    <circle cx="50" cy="14" r="6" fill="${A}" stroke="${S}" stroke-width="3"/>
    <circle cx="67" cy="18" r="6" fill="${A}" stroke="${S}" stroke-width="3"/>
    <path d="M20 74 H80" stroke="${S}" stroke-width="3.5" stroke-linecap="round"/>`,

  /* Cloud puff with a curled tail. */
  cinnamoroll: `
    <path d="M26 70 A15 15 0 0 1 27 40 A19 19 0 0 1 63 35 A15 15 0 0 1 72 70 Z"
      fill="${P}" stroke="${S}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M72 62 C84 60 88 48 80 44 C74 41 70 46 73 50"
      fill="none" stroke="${S}" stroke-width="3.5" stroke-linecap="round"/>
    <circle cx="38" cy="55" r="4" fill="${A}"/>
    <circle cx="56" cy="55" r="4" fill="${A}"/>`,

  /* Lily pad with a droplet and a ripple. */
  keroppi: `
    <path d="M50 50 L52 16 A34 34 0 1 1 44 17 Z" fill="${P}" stroke="${S}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M50 50 L52 16" stroke="${S}" stroke-width="3"/>
    <path d="M70 26 C78 36 82 42 82 47 A12 12 0 0 1 58 47 C58 42 62 36 70 26Z"
      fill="${A}" stroke="${S}" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="50" cy="50" r="5" fill="${W}" stroke="${S}" stroke-width="3"/>`,

  /* Yolk dome on a wobbly white. */
  gudetama: `
    <path d="M16 70 C4 62 12 44 26 48 C26 32 46 28 52 40 C62 30 82 36 82 50 C94 52 94 70 82 70 Z"
      fill="${W}" stroke="${S}" stroke-width="3.5" stroke-linejoin="round"/>
    <circle cx="50" cy="56" r="17" fill="${P}" stroke="${S}" stroke-width="3.5"/>
    <path d="M43 54 q3 3 6 0" fill="none" stroke="${S}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M53 54 q3 3 6 0" fill="none" stroke="${S}" stroke-width="2.5" stroke-linecap="round"/>`,

  /* Five-point star with a crescent. */
  twinstars: `
    <path d="M44 12 L54 36 L80 38 L60 55 L66 80 L44 66 L22 80 L28 55 L8 38 L34 36 Z"
      fill="${P}" stroke="${S}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M74 58 A15 15 0 1 0 90 79 A12 12 0 1 1 74 58 Z"
      fill="${A}" stroke="${S}" stroke-width="3" stroke-linejoin="round"/>`,

  /* Lightning bolt. */
  badtzmaru: `
    <path d="M60 10 L26 56 H46 L38 90 L74 42 H52 Z"
      fill="${A}" stroke="${S}" stroke-width="3.5" stroke-linejoin="round"/>`,

  /* Paw print. */
  chococat: `
    <ellipse cx="50" cy="66" rx="22" ry="18" fill="${P}" stroke="${S}" stroke-width="3.5"/>
    <ellipse cx="24" cy="42" rx="9" ry="11" fill="${P}" stroke="${S}" stroke-width="3.5"/>
    <ellipse cx="41" cy="28" rx="9" ry="11" fill="${P}" stroke="${S}" stroke-width="3.5"/>
    <ellipse cx="59" cy="28" rx="9" ry="11" fill="${P}" stroke="${S}" stroke-width="3.5"/>
    <ellipse cx="76" cy="42" rx="9" ry="11" fill="${P}" stroke="${S}" stroke-width="3.5"/>`,

  /* Beret. */
  pompompurin: `
    <path d="M18 62 A32 27 0 0 1 82 62 Z" fill="${P}" stroke="${S}" stroke-width="3.5" stroke-linejoin="round"/>
    <rect x="14" y="60" width="72" height="12" rx="6" fill="${A}" stroke="${S}" stroke-width="3.5"/>
    <circle cx="50" cy="28" r="7" fill="${A}" stroke="${S}" stroke-width="3.5"/>`,

  /* Microphone with rage shards. */
  aggretsuko: `
    <rect x="36" y="14" width="28" height="42" rx="14" fill="${P}" stroke="${S}" stroke-width="3.5"/>
    <path d="M36 34 H64" stroke="${S}" stroke-width="2.5"/>
    <path d="M36 42 H64" stroke="${S}" stroke-width="2.5"/>
    <path d="M50 56 V78" stroke="${S}" stroke-width="4" stroke-linecap="round"/>
    <rect x="36" y="78" width="28" height="9" rx="4.5" fill="${A}" stroke="${S}" stroke-width="3.5"/>
    <path d="M18 22 L26 32 L16 36" fill="none" stroke="${A}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M82 22 L74 32 L84 36" fill="none" stroke="${A}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,

  /* Ball. */
  pochacco: `
    <circle cx="50" cy="52" r="34" fill="${W}" stroke="${S}" stroke-width="3.5"/>
    <path d="M50 32 L66 44 L60 63 H40 L34 44 Z" fill="${P}" stroke="${S}" stroke-width="3"/>
    <path d="M50 32 V18" stroke="${S}" stroke-width="3" stroke-linecap="round"/>
    <path d="M66 44 L80 38" stroke="${S}" stroke-width="3" stroke-linecap="round"/>
    <path d="M60 63 L70 78" stroke="${S}" stroke-width="3" stroke-linecap="round"/>
    <path d="M40 63 L30 78" stroke="${S}" stroke-width="3" stroke-linecap="round"/>
    <path d="M34 44 L20 38" stroke="${S}" stroke-width="3" stroke-linecap="round"/>`,

  /* Fin with bubbles. */
  hangyodon: `
    <path d="M28 78 C28 44 44 20 62 14 C58 34 62 56 78 70 C62 74 44 74 28 78 Z"
      fill="${P}" stroke="${S}" stroke-width="3.5" stroke-linejoin="round"/>
    <circle cx="22" cy="34" r="7" fill="none" stroke="${A}" stroke-width="3.5"/>
    <circle cx="14" cy="52" r="5" fill="none" stroke="${A}" stroke-width="3"/>
    <circle cx="24" cy="18" r="4" fill="none" stroke="${A}" stroke-width="2.5"/>`,

  /* Deliberately plain: a ring. */
  plain: `
    <circle cx="50" cy="50" r="32" fill="none" stroke="${S}" stroke-width="4"/>
    <circle cx="50" cy="50" r="13" fill="${P}"/>`,
};

/**
 * Empty-state artwork — a shared drawing rather than one per theme, so it
 * stays consistent while still picking up the active palette.
 * @type {Record<string, string>}
 */
export const SPOT_ART = {
  /* An open notebook — "nothing logged yet". */
  empty: `
    <rect x="12" y="20" width="76" height="62" rx="8" fill="${W}" stroke="${S}" stroke-width="3.5"/>
    <path d="M50 20 V82" stroke="${S}" stroke-width="3.5"/>
    <path d="M22 38 H42 M22 50 H42 M22 62 H36" stroke="${S}" stroke-width="3" stroke-linecap="round" opacity="0.5"/>
    <path d="M58 38 H78 M58 50 H78 M58 62 H72" stroke="${S}" stroke-width="3" stroke-linecap="round" opacity="0.5"/>
    <circle cx="76" cy="26" r="9" fill="${A}" stroke="${S}" stroke-width="3"/>`,

  /* A calendar page — "no cycles recorded". */
  calendar: `
    <rect x="14" y="24" width="72" height="62" rx="9" fill="${W}" stroke="${S}" stroke-width="3.5"/>
    <path d="M14 42 H86" stroke="${S}" stroke-width="3.5"/>
    <path d="M32 24 V14 M68 24 V14" stroke="${S}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="34" cy="58" r="6" fill="${P}"/>
    <circle cx="50" cy="58" r="6" fill="${P}"/>
    <circle cx="66" cy="58" r="6" fill="${A}" opacity="0.6"/>
    <circle cx="34" cy="74" r="6" fill="${S}" opacity="0.18"/>
    <circle cx="50" cy="74" r="6" fill="${S}" opacity="0.18"/>`,

  /* A little chart — "not enough data yet". */
  chart: `
    <path d="M18 82 V22" stroke="${S}" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M18 82 H86" stroke="${S}" stroke-width="3.5" stroke-linecap="round"/>
    <rect x="28" y="56" width="13" height="26" rx="5" fill="${P}" stroke="${S}" stroke-width="3"/>
    <rect x="48" y="42" width="13" height="40" rx="5" fill="${A}" stroke="${S}" stroke-width="3"/>
    <rect x="68" y="62" width="13" height="20" rx="5" fill="${P}" stroke="${S}" stroke-width="3"/>`,

  /* A padlock — the lock screen. */
  lock: `
    <rect x="24" y="46" width="52" height="40" rx="11" fill="${P}" stroke="${S}" stroke-width="3.5"/>
    <path d="M36 46 V34 A14 14 0 0 1 64 34 V46" fill="none" stroke="${S}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="50" cy="64" r="6" fill="${W}" stroke="${S}" stroke-width="3"/>
    <path d="M50 70 V76" stroke="${S}" stroke-width="3.5" stroke-linecap="round"/>`,
};
