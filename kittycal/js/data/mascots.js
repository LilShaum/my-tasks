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

/**
 * A form, its shading, and its outline — in that order, with the shading
 * clipped to the form.
 *
 * This is the fix for the fault that made half the set look broken. Shading was
 * being drawn as an independent path hand-typed to *approximately* follow the
 * edge of the form it belonged to, and approximately is not a thing an outline
 * can be: a pale wedge that misses by two units reads as a glitch, not as
 * light. On the lightning bolt it missed by enough that the bolt stopped being
 * readable at all.
 *
 * Clipped, the shading can be a crude blob — a band, a smear — and the clip
 * cuts it exactly to the silhouette. It cannot cross the edge because there is
 * no edge for it to cross.
 *
 * The outline is stroked *after* the shading rather than as part of the fill,
 * so nothing is ever drawn over it and it stays unbroken all the way round.
 *
 * Duplicate ids are harmless here: a clipPath is pure geometry, so two copies
 * of the same emblem on one page resolve to identical clips.
 *
 * @param {string} d      the form
 * @param {string} fill
 * @param {string} [shade]  blobs, clipped to the form
 * @param {number} [sw]     outline weight
 */
function shaded(d, fill, shade = '', sw = SW_EDGE) {
  const id = `kc${(clipSeq += 1)}`;
  return `<clipPath id="${id}"><path d="${d}"/></clipPath>`
    + `<path d="${d}" fill="${fill}" stroke="none"/>`
    + (shade ? `<g clip-path="url(#${id})" data-plane="">${shade}</g>` : '')
    + `<path d="${d}" fill="none" stroke-width="${sw}"/>`;
}

let clipSeq = 0;

/**
 * The lit face of a form: everything to the left of a curved boundary running
 * roughly through `x`.
 *
 * The boundary is a curve rather than a straight edge because a straight one
 * reads as a hard bevel — two flat colours meeting at a ruled line, which is
 * what these looked like on the first attempt at clipped shading. Light across
 * a rounded object does not fall in a straight line.
 *
 * Deliberately drawn far outside the viewBox on the covered side: the clip
 * decides where it stops, so the only thing that has to be right is the
 * boundary itself.
 *
 * @param {number} x  roughly the form's horizontal middle
 * @param {string} [fill]
 */
const lit = (x, fill = HI) =>
  `<path d="M-30 -30 L${x + 13} -30 C${x + 1} 32 ${x - 13} 58 ${x - 17} 130 `
  + `L-30 130 Z" fill="${fill}" stroke="none"/>`;

/** The shadowed face, opposite `lit()` and with the same curve. */
const shade = (x, fill = LO) =>
  `<path d="M130 -30 L${x - 5} -30 C${x + 5} 32 ${x + 13} 58 ${x + 17} 130 `
  + `L130 130 Z" fill="${fill}" stroke="none"/>`;

/**
 * A small four-pointed sparkle — the floating detail around an emblem.
 *
 * Unstroked, because at this size an outline would be the entire shape. It is
 * deliberately *not* a `plane()`: a plane is a face of a form and has to stay
 * inside it, a sparkle is its own thing sitting in space beside it, and the
 * geometry probe tells them apart by the marker `plane()` leaves.
 *
 * @param {number} cx @param {number} cy @param {number} r
 * @param {string} [fill]
 */
const spark = (cx, cy, r, fill = A) =>
  `<path d="M${cx} ${cy - r} Q${cx + r * 0.22} ${cy - r * 0.22} ${cx + r} ${cy}`
  + ` Q${cx + r * 0.22} ${cy + r * 0.22} ${cx} ${cy + r}`
  + ` Q${cx - r * 0.22} ${cy + r * 0.22} ${cx - r} ${cy}`
  + ` Q${cx - r * 0.22} ${cy - r * 0.22} ${cx} ${cy - r} Z" fill="${fill}" stroke="none"/>`;

/**
 * Emblem markup, keyed by theme id. Values are the inner content of a
 * `<svg viewBox="0 0 100 100">`.
 * @type {Record<string, string>}
 */
export const EMBLEMS = {
  /* Ribbon bow — unequal loops, creases where the fabric gathers, ribbon tails
     with cut ends, and a knot band. */
  hellokitty: ink(`
    ${shaded('M49 44 C41 31 27 24 21 32 C15 41 24 53 37 51 C43 50 47 47 49 44 Z', P,
             lit(33))}
    ${shaded('M52 44 C61 29 77 23 82 33 C87 43 76 56 61 53 C56 52 54 47 52 44 Z', P,
             lit(64))}
    ${shaded('M45 52 C41 60 39 68 40 76 C43 72 45 70 48 68 C47 62 46 56 47 52 Z', P,
             lit(44))}
    ${shaded('M56 52 C60 60 62 67 60 74 C58 70 56 68 53 66 C54 60 55 56 55 52 Z', P,
             lit(56))}
    <path d="M44 46 C37 45 30 42 25 38 M56 46 C63 45 71 41 76 37"
          stroke-width="${SW_FINE}"/>
    ${shaded('M44 38 C48 35 54 35 58 38 C60 42 60 47 58 51 C53 54 47 54 43 51 '
             + 'C41 47 41 42 44 38 Z', A)}
    <path d="M47 41 C48 44 48 47 47 50 M53 41 C52 44 52 47 53 50"
          stroke-width="${SW_FINE}"/>
    ${spark(80, 24, 5.5)}
    ${spark(19, 56, 4)}`),

  /* A hood with two long ear pockets, tied with a bow. */
  mymelody: ink(`
    ${shaded('M50 84 C33 84 22 74 22 60 C22 50 26 42 32 37 C28 26 32 16 39 15 '
             + 'C46 14 50 23 49 33 C51 33 53 33 55 33 C55 23 60 15 67 17 '
             + 'C74 19 75 29 70 39 C77 45 79 52 79 61 C79 75 67 84 50 84 Z', P,
             lit(36) + shade(66))}
    ${shaded('M36 58 C42 54 58 54 65 58 C67 66 63 74 50 75 C38 74 34 66 36 58 Z', W,
             '', SW_MID)}
    ${shaded('M50 33 C44 27 37 28 37 34 C38 39 45 39 50 34 Z', A, '', SW_MID)}
    ${shaded('M50 33 C56 27 63 28 63 34 C62 39 55 39 50 34 Z', A, '', SW_MID)}
    ${spark(83, 27, 5)}
    ${spark(18, 40, 3.5)}`),

  /* Jester cap — floppy points, three bells, stitched seams, a brim. */
  kuromi: ink(`
    ${shaded('M22 72 C19 54 24 40 33 30 C36 36 39 42 41 47 C43 39 46 31 50 25 '
             + 'C54 33 57 40 59 47 C62 41 65 35 68 30 C78 41 81 55 79 72 '
             + 'C60 76 40 76 22 72 Z', P,
             lit(46) + shade(62))}
    <path d="M41 53 C41 60 41 67 41 72 M59 53 C59 60 59 67 59 72
             M28 52 C28 59 28 66 29 71 M72 52 C72 59 72 66 71 71"
          stroke-width="${SW_FINE}"/>
    ${shaded('M18 69 C40 75 62 75 83 69 C85 74 84 79 81 81 C60 85 39 85 20 81 '
             + 'C17 79 16 74 18 69 Z', A)}
    ${shaded('M33 30 C28 28 27 22 31 20 C36 19 39 24 37 28 Z', A, '', SW_MID)}
    ${shaded('M50 25 C45 22 46 16 51 15 C56 15 58 21 55 24 Z', A, '', SW_MID)}
    ${shaded('M68 30 C64 27 65 22 69 21 C73 21 75 26 72 29 Z', A, '', SW_MID)}`),

  /* Cloud — one body, a curl that leaves its edge, and two puffs drifting off. */
  cinnamoroll: ink(`
    ${shaded('M31 72 C20 72 14 62 20 53 C16 45 24 37 33 40 C35 30 47 26 54 32 '
             + 'C60 25 71 27 73 37 C82 38 85 48 79 55 C82 64 74 72 65 72 Z', P,
             lit(38) + shade(68))}
    ${shaded('M20 27 C17 24 19 19 23 20 C25 16 31 17 32 21 C36 21 37 26 34 28 '
             + 'C29 30 24 30 20 27 Z', P, '', SW_MID)}
    ${shaded('M74 82 C71 80 72 76 75 76 C77 73 81 74 81 77 C84 77 85 81 82 82 '
             + 'C79 84 76 84 74 82 Z', P, '', SW_FINE)}`),

  /* Lily pad — wavy rim, veins, a bloom at the edge, droplets on the leaf. */
  keroppi: ink(`
    ${shaded('M58 25 C73 29 83 41 82 54 C81 70 66 81 50 80 C34 79 21 67 21 52 '
             + 'C21 39 30 28 42 25 L50 47 Z', P,
             lit(38))}
    <path d="M50 47 C43 53 35 57 27 59 M50 47 C50 57 50 68 49 77
             M50 47 C58 52 66 56 73 58 M50 47 C40 49 32 48 25 45"
          stroke-width="${SW_FINE}"/>
    ${shaded('M70 22 C77 20 83 25 82 32 C87 35 86 43 80 45 C77 51 69 51 66 46 '
             + 'C60 45 58 38 62 34 C62 27 66 23 70 22 Z', A)}
    ${shaded('M74 34 C77 35 78 38 76 40 C74 42 71 41 70 39 C69 36 71 34 74 34 Z', W,
             '', SW_FINE)}
    ${shaded('M38 60 C40 57 43 61 42 64 C40 67 36 65 37 62 Z', W, '', SW_FINE)}
    ${shaded('M58 66 C60 64 62 67 61 69 C59 71 56 69 57 67 Z', W, '', SW_FINE)}`),

  /* Fried egg — a white that spreads unevenly, the yolk sitting proud of it. */
  gudetama: ink(`
    ${shaded('M25 73 C15 72 10 62 17 55 C13 47 21 41 28 45 C27 34 39 29 46 36 '
             + 'C50 29 60 28 65 34 C73 31 82 37 80 46 C89 49 90 60 82 65 '
             + 'C84 72 76 76 68 73 Z', W)}
    ${shaded('M46 43 C57 41 66 49 65 59 C64 69 53 74 45 69 C36 63 36 47 46 43 Z', P,
             lit(50), SW_MID)}
    ${spark(80, 31, 4.5)}
    ${spark(20, 38, 3.5)}`),

  /* A little constellation — three stars and two sparkles. */
  twinstars: ink(`
    ${shaded('M44 26 Q48 38 51 44.3 Q61 43 70.6 45.4 Q62 52 55.4 57.7 '
             + 'Q58 68 60.5 76.6 Q52 70 44 66 Q36 70 27.6 76.6 Q30 68 32.6 57.7 '
             + 'Q26 52 17.4 45.4 Q27 43 34.9 44.3 Q40 38 44 26 Z', P,
             shade(44))}
    ${shaded('M72 17 Q74 24 76.6 26 Q81 25 84.4 26 Q80 30 79.6 33.5 '
             + 'Q80 38 79 40.5 Q75 37 72 36 Q69 37 64.4 40.5 Q65 36 64.4 33.5 '
             + 'Q61 30 59.6 26 Q64 25 67.4 26 Q70 24 72 17 Z', A, '', SW_MID)}
    ${shaded('M76 62 Q77 67 81 68.5 Q77 70 76 75 Q75 70 71 68.5 Q75 67 76 62 Z', P,
             '', SW_MID)}
    ${spark(24, 24, 5, P)}
    ${spark(58, 84, 3.5)}`),

  /* Lightning bolt — bent edges, a lit face down its leading edge, a burst. */
  badtzmaru: ink(`
    <path d="M27 27 C30 30 33 33 35 36 M75 26 C72 29 69 32 67 35
             M22 55 C26 55 30 55 33 55 M80 58 C76 57 72 56 69 56"
          stroke-width="${SW_FINE}"/>
    ${shaded('M63 15 C53 29 41 43 28 55 C34 57 41 57 47 56 C45 66 43 76 42 85 '
             + 'C53 71 65 57 75 44 C69 46 62 46 56 45 C59 35 61 25 63 15 Z', A,
             lit(46, HI_A) + shade(56, LO_A))}`),

  /* Paw print — four toes, none the same size, each catching the light. */
  chococat: ink(`
    ${shaded('M50 85 C38 85 28 77 29 67 C30 57 40 51 52 51 C64 51 73 58 73 68 '
             + 'C73 78 62 85 50 85 Z', P,
             lit(48))}
    ${shaded('M24 51 C18 48 17 39 22 35 C27 32 33 36 34 43 C35 49 30 54 24 51 Z', P)}
    ${shaded('M42 38 C36 34 36 24 42 21 C48 19 53 24 52 31 C52 37 47 41 42 38 Z', P,
             lit(44))}
    ${shaded('M61 39 C56 35 57 26 63 24 C69 22 73 28 71 34 C70 40 65 43 61 39 Z', P,
             lit(63))}
    ${shaded('M79 53 C74 51 72 43 76 39 C81 36 87 40 87 46 C87 52 83 55 79 53 Z', P,
             lit(80))}`),

  /* Beret — a slouched crown, a band in front of it, a stalk behind. */
  pompompurin: ink(`
    ${shaded('M48 33 C45 29 47 22 51 22 C56 22 58 29 55 33 Z', A, '', SW_MID)}
    ${shaded('M21 55 C21 41 35 33 51 33 C68 33 81 42 80 55 C79 65 66 71 50 71 '
             + 'C33 71 22 65 21 55 Z', P,
             lit(38) + shade(66))}
    <path d="M34 45 C43 40 58 40 67 45" stroke-width="${SW_FINE}"/>
    ${shaded('M28 64 C42 72 58 72 72 64 C75 70 73 77 66 79 C55 83 40 82 32 78 '
             + 'C26 75 25 69 28 64 Z', A)}
    <path d="M37 74 C45 77 56 77 64 74" stroke-width="${SW_FINE}"/>`),

  /* Microphone — grille, stand, base, and two shards of noise. */
  aggretsuko: ink(`
    <path d="M22 24 C26 28 29 31 32 34 M79 23 C75 27 72 30 69 33
             M17 45 C21 45 25 45 28 45 M84 47 C80 47 76 47 73 47"
          stroke-width="${SW_FINE}"/>
    <path d="M51 57 C51 63 51 68 51 72" stroke-width="${SW_MID}"/>
    ${shaded('M35 72 C44 69 57 69 66 72 C68 77 66 82 60 83 C51 85 42 84 37 81 '
             + 'C34 79 33 75 35 72 Z', A)}
    ${shaded('M41 19 C49 14 58 17 61 25 C64 34 62 45 58 53 C54 59 46 59 43 53 '
             + 'C38 45 36 28 41 19 Z', P,
             lit(47))}
    <path d="M43 27 C49 25 55 25 60 27 M43 35 C49 33 55 33 60 35
             M44 43 C49 41 55 41 59 43" stroke-width="${SW_FINE}"/>`),

  /* Football — a hand-drawn ball, a centre panel, and the panels its seams
     run to, none of them quite regular. */
  pochacco: ink(`
    ${shaded('M50 19 C68 19 81 33 81 50 C81 68 67 81 50 81 C32 81 19 67 19 50 '
             + 'C19 32 33 19 50 19 Z', W)}
    <path d="M50 36 C50 28 50 23 50 20 M63 46 C70 43 75 41 78 39
             M58 61 C61 68 64 73 66 76 M42 61 C39 68 36 73 34 76
             M37 46 C30 44 25 42 22 40" stroke-width="${SW_MID}"/>
    ${shaded('M50 36 C56 38 61 42 63 47 C60 53 56 58 50 60 C44 58 39 53 37 47 '
             + 'C40 41 44 38 50 36 Z', P,
             lit(50), SW_MID)}
    <path d="M45 22 C51 21 57 22 61 25 M76 44 C78 50 78 56 76 61
             M58 78 C52 80 46 80 41 78 M23 60 C21 54 21 48 23 43"
          stroke-width="${SW_FINE}"/>`),

  /* Dorsal fin — a lit leading edge, a ridge, bubbles rising past it. */
  hangyodon: ink(`
    ${shaded('M29 75 C33 47 47 25 66 15 C61 39 65 58 81 73 C64 78 45 78 29 75 Z', P,
             lit(46))}
    <path d="M63 24 C60 43 63 59 70 70" stroke-width="${SW_FINE}"/>
    <path d="M27 33 C31 30 36 33 35 38 C34 43 28 44 25 40 C23 37 24 34 27 33 Z"
          fill="none" stroke="${A}" stroke-width="${SW_MID}"/>
    <path d="M18 53 C21 51 25 53 24 57 C23 60 19 61 17 58 C16 56 16 54 18 53 Z"
          fill="none" stroke="${A}" stroke-width="${SW_MID}"/>
    <path d="M26 64 C28 63 31 64 30 67 C29 69 26 69 25 67 Z"
          fill="none" stroke="${A}" stroke-width="${SW_FINE}"/>
    <path d="M34 22 C36 21 38 22 38 24 C37 26 34 26 33 24 Z"
          fill="none" stroke="${A}" stroke-width="${SW_FINE}"/>`),

  /* Deliberately plain: a ring. */
  plain: ink(`
    <path d="M50 20 C67 20 80 33 80 50 C80 67 67 80 50 80 C33 80 20 67 20 50
             C20 33 33 20 50 20 Z"/>
    ${shaded('M50 38 C57 38 62 43 62 50 C62 57 57 62 50 62 C43 62 38 57 38 50 '
             + 'C38 43 43 38 50 38 Z', P, '', SW_MID)}`),
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
