// @ts-check
/**
 * mascots.js — original mascot artwork.
 *
 * Charm emblems built from a theme's signature *motif* — a bow, a cloud, a
 * star, a yolk, a fin. Ours, not anybody's characters.
 *
 * Every emblem is a 100×100 viewBox and paints itself from theme tokens, so one
 * drawing works in all 14 palettes and in both light and dark mode.
 *
 * ── Why these are drawn rather than generated
 *
 * Two passes ago this set was built the way a program builds things: fifty-four
 * `<circle>`, `<ellipse>` and `<rect>` primitives used as finished art, every
 * form mirrored down its centre line, one stroke weight everywhere, and the
 * stars emitted by a `polygon()` function. Each of those is a reasonable
 * engineering instinct and together they are exactly why the result looked
 * generated: real drawings do not have perfect circles in them, both halves of
 * a bow are never identical, and an inked line is not the same width along its
 * whole length.
 *
 * So the rules changed:
 *
 *   1. **No primitives.** Every shape is a `<path>` of hand-placed cubic
 *      béziers. Nothing in here is a circle, because nothing drawn by a person
 *      is a circle.
 *   2. **No mirror symmetry.** The bow's loops are different sizes and its
 *      tails different lengths; the paw's toes vary; the beret slouches. A
 *      shape that is exactly its own reflection reads as machinery.
 *   3. **Three line weights, not one.** The outer silhouette is heaviest, forms
 *      inside it are lighter, and interior marks lighter again — which is what
 *      an inked drawing does, and what makes a flat shape sit in front of
 *      another one.
 *   4. **No faces.** These are objects. A face was added to the cloud and
 *      immediately made the emblem a character rather than a motif, which also
 *      contradicted having just removed one from the heart for reading as eyes
 *      and a nose.
 *
 * The geometry contract from the earlier pass still holds and is still measured
 * by test/mascots.mjs: one optical box, centred, comparable visual weight, and
 * shading planes that stay inside the form they shade.
 */

const S = 'var(--line)';        // outline
const P = 'var(--primary)';     // fill
const A = 'var(--accent)';      // accent fill
const W = 'var(--card)';        // "paper" white, follows dark mode

/*
  Shading planes: the lighter and darker faces that give a form volume. Drawn
  as tapered slivers rather than centred blobs — a pale shape in the middle of
  a form reads as a hole punched through it, a sliver along one edge reads as
  light falling across it.

  From `--emb-*` rather than `--primary-soft` / `--primary-deep`, which swap
  places between light and dark mode and would light the set from opposite
  corners depending on the time of day. See tokens.css.
*/
const HI = 'var(--emb-hi)';
const LO = 'var(--emb-lo)';
const HI_A = 'var(--emb-hi-a)';
const LO_A = 'var(--emb-lo-a)';

/** The outer silhouette. Heaviest, so the emblem holds together at 30px. */
const SW_EDGE = 6;

/** Forms sitting inside or behind the silhouette. */
const SW_MID = 4;

/** Interior marks — veins, seams, creases. */
const SW_FINE = 2.5;

/**
 * Wrap artwork in the shared ink contract.
 *
 * The default is the silhouette weight; anything lighter says so. Weight is
 * still not free-form — three values, chosen for a reason, rather than the 2.5
 * / 3 / 3.5 / 4 drift this set started out with.
 *
 * @param {string} art  inner SVG markup
 */
const ink = (art) =>
  `<g fill="none" stroke="${S}" stroke-width="${SW_EDGE}" `
  + `stroke-linecap="round" stroke-linejoin="round">${art}</g>`;

/** An internal plane: no outline of its own. */
const plane = (/** @type {string} */ d, /** @type {string} */ fill) =>
  `<path d="${d}" fill="${fill}" stroke="none"/>`;

/**
 * Emblem markup, keyed by theme id. Values are the inner content of a
 * `<svg viewBox="0 0 100 100">`.
 * @type {Record<string, string>}
 */
export const EMBLEMS = {
  /* Ribbon bow — loops of unequal size, tails of unequal length, a knot that is
     a gathered band rather than a bead. */
  hellokitty: ink(`
    <path d="M49 44 C41 31 27 24 21 32 C15 41 24 53 37 51 C43 50 47 47 49 44 Z" fill="${P}"/>
    <path d="M52 44 C61 29 77 23 82 33 C87 43 76 56 61 53 C56 52 54 47 52 44 Z" fill="${P}"/>
    ${plane('M46 42 C39 33 29 28 23 31 C31 32 40 36 46 42 Z', HI)}
    ${plane('M54 42 C62 32 73 27 79 31 C70 32 61 36 54 42 Z', HI)}
    <path d="M45 52 C41 60 39 68 40 76 C43 72 45 70 48 68 C47 62 46 56 47 52 Z" fill="${P}"/>
    <path d="M56 52 C60 60 62 67 60 74 C58 70 56 68 53 66 C54 60 55 56 55 52 Z" fill="${P}"/>
    <path d="M44 38 C48 35 54 35 58 38 C60 42 60 47 58 51 C53 54 47 54 43 51
             C41 47 41 42 44 38 Z" fill="${A}"/>
    ${plane('M46 40 C48 38 51 37 54 37 C50 39 47 41 46 44 Z', HI_A)}`),

  /* Heart, leaning slightly, one lobe fuller than the other. */
  mymelody: ink(`
    <path d="M50 78 C33 65 19 52 18 39 C17 28 28 22 37 27 C42 30 46 34 48 38
             C50 32 55 25 63 24 C74 23 83 32 82 43 C81 55 67 66 50 78 Z" fill="${P}"/>
    ${plane('M28 30 C22 33 20 41 23 49 C22 40 24 34 31 29 Z', HI)}
    ${plane('M66 29 C72 28 77 32 77 38 C75 33 71 30 66 29 Z', HI)}
    ${plane('M50 78 C62 67 72 57 78 47 C76 59 65 69 50 78 Z', LO)}`),

  /* Jester cap — points that flop rather than spike, bells of three sizes. */
  kuromi: ink(`
    <path d="M22 72 C19 54 24 40 33 30 C36 36 39 42 41 47 C43 39 46 31 50 25
             C54 33 57 40 59 47 C62 41 65 35 68 30 C78 41 81 55 79 72
             C60 76 40 76 22 72 Z" fill="${P}"/>
    ${plane('M41 47 C43 39 46 31 50 25 C54 33 57 40 59 47 C58 61 58 67 59 73 L41 73 Z', HI)}
    ${plane('M68 30 C78 41 81 55 79 72 L60 74 C61 59 63 45 68 30 Z', LO)}
    <path d="M41 53 C41 60 41 67 41 72 M59 53 C59 60 59 67 59 72"
          stroke-width="${SW_FINE}"/>
    <path d="M18 69 C40 75 62 75 83 69 C85 74 84 79 81 81 C60 85 39 85 20 81
             C17 79 16 74 18 69 Z" fill="${A}"/>
    <path d="M33 30 C28 28 27 22 31 20 C36 19 39 24 37 28 Z" fill="${A}"/>
    <path d="M50 25 C45 22 46 16 51 15 C56 15 58 21 55 24 Z" fill="${A}"/>
    <path d="M68 30 C64 27 65 22 69 21 C73 21 75 26 72 29 Z" fill="${A}"/>`),

  /* Cloud with a curled tail. No face: giving it one turned a motif into a
     character, and did it right after a face was removed from the heart for
     reading as eyes and a nose. */
  cinnamoroll: ink(`
    <path d="M31 72 C20 72 14 62 20 53 C16 45 24 37 33 40 C35 30 47 26 54 32
             C60 25 71 27 73 37 C82 38 85 48 79 55 C82 64 74 72 65 72 Z" fill="${P}"/>
    ${plane('M28 52 C22 55 21 63 26 68 C24 60 24 55 30 50 Z', HI)}
    ${plane('M40 38 C46 33 53 34 57 38 C50 36 45 36 40 38 Z', HI)}
    <path d="M78 62 C89 59 90 47 82 43 C77 41 72 45 74 50" stroke-width="${SW_MID}"/>`),

  /* Lily pad with a wavy rim and a bloom at its edge. */
  keroppi: ink(`
    <path d="M58 25 C73 29 83 41 82 54 C81 70 66 81 50 80 C34 79 21 67 21 52
             C21 39 30 28 42 25 L50 47 Z" fill="${P}"/>
    ${plane('M42 25 C30 28 21 39 21 52 C21 60 24 67 29 72 C22 60 24 40 42 25 Z', HI)}
    <path d="M50 47 C43 53 35 57 27 59 M50 47 C50 57 50 68 49 77
             M50 47 C58 52 66 56 73 58" stroke-width="${SW_FINE}"/>
    <path d="M70 22 C77 20 83 25 82 32 C87 35 86 43 80 45 C77 51 69 51 66 46
             C60 45 58 38 62 34 C62 27 66 23 70 22 Z" fill="${A}"/>
    ${plane('M68 27 C72 25 77 26 79 30 C75 28 71 27 68 27 Z', HI_A)}`),

  /* Fried egg — an irregular white with the yolk sitting off to one side. */
  gudetama: ink(`
    <path d="M25 73 C15 72 10 62 17 55 C13 47 21 41 28 45 C27 34 39 29 46 36
             C50 29 60 28 65 34 C73 31 82 37 80 46 C89 49 90 60 82 65
             C84 72 76 76 68 73 Z" fill="${W}"/>
    <path d="M46 43 C57 41 66 49 65 59 C64 69 53 74 45 69 C36 63 36 47 46 43 Z"
          fill="${P}" stroke-width="${SW_MID}"/>
    ${plane('M46 46 C41 49 39 55 40 61 C38 53 40 47 46 46 Z', HI)}`),

  /* Three stars with curved arms. They used to come out of a `polygon()` call,
     which is the single most generated-looking thing this set contained. */
  twinstars: ink(`
    <path d="M44 26 Q48 38 51 44.3 Q61 43 70.6 45.4 Q62 52 55.4 57.7
             Q58 68 60.5 76.6 Q52 70 44 66 Q36 70 27.6 76.6 Q30 68 32.6 57.7
             Q26 52 17.4 45.4 Q27 43 34.9 44.3 Q40 38 44 26 Z" fill="${P}"/>
    ${plane('M44 26 Q48 38 51 44.3 Q44 47 39 53 Q38 45 34.9 44.3 Q40 38 44 26 Z', LO)}
    <path d="M72 17 Q74 24 76.6 26 Q81 25 84.4 26 Q80 30 79.6 33.5
             Q80 38 79 40.5 Q75 37 72 36 Q69 37 64.4 40.5 Q65 36 64.4 33.5
             Q61 30 59.6 26 Q64 25 67.4 26 Q70 24 72 17 Z" fill="${A}"/>
    ${plane('M72 17 Q74 24 76.6 26 Q73 27 70 30 Q71 25 72 17 Z', HI_A)}`),

  /* Lightning bolt — edges that bend, a tip that tapers. */
  badtzmaru: ink(`
    <path d="M63 15 C53 29 41 43 28 55 C34 57 41 57 47 56 C45 66 43 76 42 85
             C53 71 65 57 75 44 C69 46 62 46 56 45 C59 35 61 25 63 15 Z" fill="${A}"/>
    ${plane('M63 15 C53 29 41 43 28 55 C36 55 42 55 47 56 C50 47 56 34 63 15 Z', HI_A)}
    ${plane('M45 62 C44 71 43 78 42 85 C48 77 54 69 60 61 C54 62 49 62 45 62 Z', LO_A)}`),

  /* Paw print — four toes, none the same size, none quite in line. */
  chococat: ink(`
    <path d="M50 85 C38 85 28 77 29 67 C30 57 40 51 52 51 C64 51 73 58 73 68
             C73 78 62 85 50 85 Z" fill="${P}"/>
    ${plane('M40 57 C33 60 30 66 32 72 C30 63 33 58 40 57 Z', HI)}
    <path d="M24 51 C18 48 17 39 22 35 C27 32 33 36 34 43 C35 49 30 54 24 51 Z" fill="${P}"/>
    <path d="M42 38 C36 34 36 24 42 21 C48 19 53 24 52 31 C52 37 47 41 42 38 Z" fill="${P}"/>
    <path d="M61 39 C56 35 57 26 63 24 C69 22 73 28 71 34 C70 40 65 43 61 39 Z" fill="${P}"/>
    <path d="M79 53 C74 51 72 43 76 39 C81 36 87 40 87 46 C87 52 83 55 79 53 Z" fill="${P}"/>`),

  /* Beret, slouched to one side. */
  pompompurin: ink(`
    <path d="M21 55 C21 41 35 33 51 33 C68 33 81 42 80 55 C79 65 66 71 50 71
             C33 71 22 65 21 55 Z" fill="${P}"/>
    ${plane('M31 41 C25 45 22 51 24 58 C22 48 25 43 31 41 Z', HI)}
    <path d="M30 65 C43 72 58 72 71 65 C74 70 72 76 66 78 C55 82 41 81 33 77
             C28 74 27 69 30 65 Z" fill="${A}"/>
    <path d="M48 33 C45 29 47 24 51 24 C56 24 58 29 55 33 Z" fill="${A}"/>`),

  /* Microphone, tilted, with the cable running off. */
  aggretsuko: ink(`
    <path d="M41 19 C49 14 58 17 61 25 C64 34 62 45 58 53 C54 59 46 59 43 53
             C38 45 36 28 41 19 Z" fill="${P}"/>
    ${plane('M45 22 C41 27 41 36 43 44 C39 34 40 25 45 22 Z', HI)}
    <path d="M43 30 C49 28 55 28 60 30 M43 40 C49 38 55 38 60 40"
          stroke-width="${SW_FINE}"/>
    <path d="M51 59 C51 64 51 68 51 72" stroke-width="${SW_MID}"/>
    <path d="M35 72 C44 69 57 69 66 72 C68 77 66 82 60 83 C51 85 42 84 37 81
             C34 79 33 75 35 72 Z" fill="${A}"/>
    <path d="M65 78 C77 79 80 70 77 62" stroke-width="${SW_FINE}"/>
    <path d="M24 28 C28 32 31 35 34 38 M78 27 C74 31 71 34 68 37"
          stroke-width="${SW_FINE}"/>`),

  /* A ball. It was a football first — five perfectly regular panels on five
     perfectly regular seams, which is a shape a compass draws rather than one
     anybody draws — and then briefly a bone, whose notches were deep enough
     that it read as a letter H. */
  pochacco: ink(`
    <path d="M50 19 C68 19 81 33 81 50 C81 68 67 81 50 81 C32 81 19 67 19 50
             C19 32 33 19 50 19 Z" fill="${W}"/>
    ${plane('M33 26 C26 32 23 41 25 50 C21 40 25 30 33 26 Z', HI)}
    <path d="M31 25 C39 35 39 65 30 75" stroke-width="${SW_MID}"/>
    <path d="M70 26 C61 36 62 64 70 74" stroke-width="${SW_MID}"/>`),

  /* Dorsal fin with a ridge and rising bubbles. */
  hangyodon: ink(`
    <path d="M29 75 C33 47 47 25 66 15 C61 39 65 58 81 73 C64 78 45 78 29 75 Z"
          fill="${P}"/>
    ${plane('M29 75 C33 47 47 25 66 15 C55 32 44 52 41 76 Z', HI)}
    <path d="M63 24 C60 43 63 59 70 70" stroke-width="${SW_FINE}"/>
    <path d="M27 33 C31 30 36 33 35 38 C34 43 28 44 25 40 C23 37 24 34 27 33 Z"
          fill="none" stroke="${A}" stroke-width="${SW_MID}"/>
    <path d="M18 53 C21 51 25 53 24 57 C23 60 19 61 17 58 C16 56 16 54 18 53 Z"
          fill="none" stroke="${A}" stroke-width="${SW_MID}"/>
    <path d="M26 64 C28 63 31 64 30 67 C29 69 26 69 25 67 Z"
          fill="none" stroke="${A}" stroke-width="${SW_FINE}"/>`),

  /* Deliberately plain: a ring. This is the theme for turning the cute off, so
     it is the one emblem that stays a bare shape. */
  plain: ink(`
    <path d="M50 20 C67 20 80 33 80 50 C80 67 67 80 50 80 C33 80 20 67 20 50
             C20 33 33 20 50 20 Z"/>
    ${plane('M50 38 C57 38 62 43 62 50 C62 57 57 62 50 62 C43 62 38 57 38 50 C38 43 43 38 50 38 Z', P)}`),
};

/**
 * Empty-state artwork — a shared drawing rather than one per theme, so it
 * stays consistent while still picking up the active palette.
 *
 * Same stroke contract as the emblems: these appear on the same screens, and
 * a spot illustration drawn at a different weight is the sort of thing nobody
 * can name but everybody notices.
 *
 * @type {Record<string, string>}
 */
export const SPOT_ART = {
  /* An open notebook — "nothing logged yet". */
  empty: ink(`
    <rect x="14" y="22" width="72" height="58" rx="8" fill="${W}"/>
    <path d="M50 22 V80"/>
    <path d="M24 40 H42 M24 51 H42 M24 62 H37" stroke-width="${SW_FINE}" opacity="0.55"/>
    <path d="M58 40 H76 M58 51 H76 M58 62 H71" stroke-width="${SW_FINE}" opacity="0.55"/>
    <circle cx="76" cy="28" r="9" fill="${A}"/>`),

  /* A calendar page — "no cycles recorded". */
  calendar: ink(`
    <rect x="16" y="26" width="68" height="58" rx="9" fill="${W}"/>
    <path d="M16 44 H84"/>
    <path d="M33 26 V16 M67 26 V16"/>
    <circle cx="35" cy="59" r="6" fill="${P}" stroke="none"/>
    <circle cx="50" cy="59" r="6" fill="${P}" stroke="none"/>
    <circle cx="65" cy="59" r="6" fill="${A}" stroke="none" opacity="0.6"/>
    <circle cx="35" cy="74" r="6" fill="${S}" stroke="none" opacity="0.18"/>
    <circle cx="50" cy="74" r="6" fill="${S}" stroke="none" opacity="0.18"/>`),

  /* A little chart — "not enough data yet". */
  chart: ink(`
    <path d="M20 80 V24"/>
    <path d="M20 80 H84"/>
    <rect x="30" y="55" width="14" height="25" rx="5" fill="${P}"/>
    <rect x="50" y="41" width="14" height="39" rx="5" fill="${A}"/>
    <rect x="70" y="61" width="14" height="19" rx="5" fill="${P}"/>`),

  /* A padlock — the lock screen. */
  lock: ink(`
    <rect x="25" y="47" width="50" height="38" rx="11" fill="${P}"/>
    <path d="M36 47 V35 A14 14 0 0 1 64 35 V47"/>
    <circle cx="50" cy="64" r="6" fill="${W}"/>
    <path d="M50 70 V76"/>`),
};
