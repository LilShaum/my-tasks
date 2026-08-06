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
 *
 * ── The construction contract
 *
 * The first version of this set was fourteen drawings that each looked fine on
 * its own and did not look like a set. Laid out side by side the faults were
 * obvious: stroke weights of 2.5, 3, 3.5 and 4 mixed freely; the bow filled its
 * box edge to edge while the lightning bolt used a third of the area and sat
 * up in the top-left corner; and at the 30px the header actually renders, half
 * of them collapsed into an unreadable smudge.
 *
 * So the geometry is now constrained rather than eyeballed:
 *
 *   1. **One stroke weight**, applied by `ink()` on a wrapping group rather
 *      than repeated per path — a weight you cannot set per shape is a weight
 *      that cannot drift. Interior detail (a face, a grille) steps down to
 *      SW_FINE, because a closed shape drawn at the outline weight fills in.
 *   2. **One optical box.** Artwork lives inside x,y ∈ [16, 84], centred on
 *      (50, 50). Stroke grows outward from the path by half its width, so that
 *      leaves a hair of margin at the viewBox edge.
 *   3. **A detail budget.** Nothing smaller than about 8 units across, and no
 *      more than five or six elements — at 30px, an emblem has roughly nine
 *      device pixels per 30 units to say what it is.
 *   4. **Regular shapes are computed, not typed.** The stars and the football
 *      panel come out of `polygon()`, so they are exactly regular and exactly
 *      centred, which is not true of any five-pointed star anyone has ever
 *      typed by hand.
 */

const S = 'var(--line)';        // outline
const P = 'var(--primary)';     // fill
const A = 'var(--accent)';      // accent fill
const W = 'var(--card)';        // "paper" white, follows dark mode

/*
  Shading planes.

  A single flat fill inside an outline is what makes an icon read as clip art:
  the form has a silhouette and no volume. Every emblem here now carries at
  least one lighter or darker plane, which is the cheapest way to turn a shape
  into an object — the light falls from the top-left throughout the set.

  These come from `--emb-*` rather than `--primary-soft` / `--primary-deep`,
  which swap places between light and dark mode and would light the drawings
  from opposite corners depending on the time of day. See tokens.css.
*/
const HI = 'var(--emb-hi)';     // lighter plane, same hue as the fill
const LO = 'var(--emb-lo)';     // darker plane
const HI_A = 'var(--emb-hi-a)'; // the same pair for accent-coloured forms
const LO_A = 'var(--emb-lo-a)';

/** An internal plane: no outline of its own, the fold line is drawn separately. */
const plane = (/** @type {string} */ d, /** @type {string} */ fill) =>
  `<path d="${d}" fill="${fill}" stroke="none"/>`;

/** The one stroke weight, in viewBox units. */
const SW = 5;

/** Interior detail — faces, grilles, seams. One step down so it stays open. */
const SW_FINE = 3;

/**
 * Wrap artwork in the shared stroke contract.
 *
 * Every emblem goes through this, and no path inside sets its own
 * `stroke-width`. Individual shapes say what they are *filled* with and
 * nothing else, which is what keeps fourteen drawings looking like one set.
 *
 * @param {string} art  inner SVG markup
 */
const ink = (art) =>
  `<g fill="none" stroke="${S}" stroke-width="${SW}" `
  + `stroke-linecap="round" stroke-linejoin="round">${art}</g>`;

/**
 * Points of a regular polygon or star, as an SVG path.
 *
 * With `inner` given, every other vertex is pulled in to that radius, which is
 * how you get a star that is actually regular. Angles start at twelve o'clock.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} outer
 * @param {number} sides
 * @param {number} [inner]  omit for a plain polygon
 */
function polygon(cx, cy, outer, sides, inner) {
  const count = inner == null ? sides : sides * 2;
  /** @type {string[]} */
  const points = [];

  for (let i = 0; i < count; i += 1) {
    const radius = inner == null || i % 2 === 0 ? outer : inner;
    const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
    points.push(
      `${round(cx + radius * Math.cos(angle))} ${round(cy + radius * Math.sin(angle))}`,
    );
  }

  return `M${points.join(' L')} Z`;
}

/** Two decimals is plenty at this scale and keeps the markup readable. */
const round = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/**
 * Radial spokes from a centred polygon's vertices out to a radius — the seams
 * on the football.
 * @param {number} cx @param {number} cy
 * @param {number} from @param {number} to @param {number} sides
 */
function spokes(cx, cy, from, to, sides) {
  const d = Array.from({ length: sides }, (_, i) => {
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
    return `M${round(cx + from * dx)} ${round(cy + from * dy)} `
      + `L${round(cx + to * dx)} ${round(cy + to * dy)}`;
  }).join(' ');

  // One element with five subpaths rather than five elements: identical
  // rendering, and the detail budget counts shapes.
  return `<path d="${d}"/>`;
}

/**
 * A ring of small regular polygons around a centre — the outer panels of the
 * football. One path element with several subpaths, so a ring of five counts
 * as one shape against the detail budget.
 *
 * @param {number} cx @param {number} cy
 * @param {number} at      distance from the centre to each polygon's centre
 * @param {number} r       radius of each polygon
 * @param {number} count
 * @param {number} [turn]  degrees to rotate the ring
 */
function ring(cx, cy, at, r, count, turn = 0) {
  const d = Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * 2 * i) / count - Math.PI / 2 + (turn * Math.PI) / 180;
    return polygon(cx + at * Math.cos(angle), cy + at * Math.sin(angle), r, 5);
  }).join(' ');

  return `<path d="${d}" fill="${'${HI}'}" stroke="none"/>`;
}

/**
 * Emblem markup, keyed by theme id. Values are the inner content of a
 * `<svg viewBox="0 0 100 100">`.
 * @type {Record<string, string>}
 */
export const EMBLEMS = {
  /* Ribbon bow — gathered loops, pleats at the knot, ribbon tails with cut
     ends. The tails were two bare strokes; a ribbon has width. */
  hellokitty: ink(`
    <path d="M50 44 Q31 22 21 31 Q12 40 22 51 Q35 58 50 44 Z" fill="${P}"/>
    <path d="M50 44 Q69 22 79 31 Q88 40 78 51 Q65 58 50 44 Z" fill="${P}"/>
    ${plane('M50 44 Q33 25 23 32 Q31 35 39 39 Q46 42 50 44 Z', HI)}
    ${plane('M50 44 Q67 25 77 32 Q69 35 61 39 Q54 42 50 44 Z', HI)}
    <path d="M44 48 Q34 48 26 44 M56 48 Q66 48 74 44" stroke-width="${SW_FINE}"/>
    <path d="M44 49 C40 59 38 69 39 79 C42 74 44 71 46 69 C46 61 47 55 48 49 Z" fill="${P}"/>
    <path d="M56 49 C60 59 62 69 61 79 C58 74 56 71 54 69 C54 61 53 55 52 49 Z" fill="${P}"/>
    <circle cx="50" cy="44" r="9" fill="${A}"/>
    <circle cx="47" cy="41" r="3" fill="${HI_A}" stroke="none"/>`),

  /* Heart tied with a small bow.

     The bow came out once already, when this emblem was a heart *and* a bow
     *and* a bead and read as three motifs fighting. A heart with a ribbon tied
     at the dip is one object rather than three, which is the difference. */
  mymelody: ink(`
    <path d="M50 84 C26 66 18 54 18 42 A16 16 0 0 1 50 36 A16 16 0 0 1 82 42
             C82 54 74 66 50 84 Z" fill="${P}"/>
    ${plane('M23 47 A14 14 0 0 1 46 39 A15 15 0 0 0 28 58 Z', HI)}
    <path d="M50 34 Q40 25 34 31 Q32 37 41 38 Q47 37 50 34 Z" fill="${A}"/>
    <path d="M50 34 Q60 25 66 31 Q68 37 59 38 Q53 37 50 34 Z" fill="${A}"/>
    <circle cx="50" cy="34" r="4" fill="${A}"/>
    <circle cx="63" cy="63" r="3.5" fill="${HI}" stroke="none"/>`),

  /* Three-point jester cap: shaded panels, a stitched seam, and a brim. */
  kuromi: ink(`
    ${plane('M23 74 Q23 42 35 26 L41 44 L41 74 Z', P)}
    ${plane('M41 44 L50 22 L59 44 L59 74 L41 74 Z', HI)}
    ${plane('M59 44 L65 26 Q77 42 77 74 L59 74 Z', LO)}
    <path d="M23 74 Q23 42 35 26 L41 44 L50 22 L59 44 L65 26 Q77 42 77 74 Z"/>
    <path d="M41 52 V70 M59 52 V70" stroke-width="${SW_FINE}"/>
    <rect x="21" y="71" width="58" height="11" rx="5.5" fill="${A}"/>
    <circle cx="35" cy="24" r="6.5" fill="${A}"/>
    <circle cx="50" cy="20" r="6.5" fill="${A}"/>
    <circle cx="65" cy="24" r="6.5" fill="${A}"/>`),

  /* Cloud puff — four lobes, a curled tail, and a face. */
  cinnamoroll: ink(`
    <path d="M27 70 A14 14 0 0 1 29 44 A14 14 0 0 1 47 34 A16 16 0 0 1 66 42
             A14 14 0 0 1 73 70 Z" fill="${P}"/>
    <ellipse cx="40" cy="50" rx="9" ry="6" fill="${HI}" stroke="none"/>
    <path d="M73 62 Q85 58 81 47 Q77 40 71 46"/>
    <circle cx="42" cy="57" r="3.5" fill="${S}" stroke="none"/>
    <circle cx="58" cy="57" r="3.5" fill="${S}" stroke="none"/>
    <path d="M46 64 Q50 67 54 64" stroke-width="${SW_FINE}"/>`),

  /* Lily pad with a water-lily bloom.

     The notch used to be a thin wedge running all the way to the centre, which
     reads as a pie chart rather than a leaf. It now opens wide at the rim, and
     veins radiate from it — the detail that makes it foliage. */
  keroppi: ink(`
    <path d="M60 24 A31 31 0 1 1 40 24 L50 46 Z" fill="${P}"/>
    ${plane('M40 24 A31 31 0 0 0 22 66 A31 31 0 0 1 40 24 Z', HI)}
    <path d="M50 46 L28 58 M50 46 L50 77 M50 46 L72 58" stroke-width="${SW_FINE}"/>
    <path d="${polygon(70, 32, 12, 5, 5.5)}" fill="${A}"/>
    <circle cx="70" cy="32" r="4" fill="${HI_A}" stroke="none"/>`),

  /* Yolk dome on a wobbly white. */
  gudetama: ink(`
    <path d="M22 71 Q12 64 18 53 Q24 48 30 51 Q29 36 45 35 Q50 37 52 43
             Q61 34 75 40 Q80 44 78 52 Q88 55 86 65 Q84 71 77 71 Z" fill="${W}"/>
    <circle cx="51" cy="56" r="15" fill="${P}"/>
    <circle cx="45.5" cy="50.5" r="5" fill="${HI}" stroke="none"/>
    <path d="M44.5 57 q3.5 3.5 7 0 M55 57 q3.5 3.5 7 0" stroke-width="${SW_FINE}"/>
    <circle cx="41" cy="63" r="3" fill="${A}" stroke="none"/>
    <circle cx="62" cy="63" r="3" fill="${A}" stroke="none"/>`),

  /* Three stars and a sparkle. Computed rather than typed — the old star was a
     hand-written point list, which is why it was neither regular nor centred. */
  twinstars: ink(`
    <path d="${polygon(40, 60, 24, 5, 9.8)}" fill="${P}"/>
    ${plane(polygon(40, 60, 12.5, 5, 5.1), LO)}
    <path d="${polygon(72, 30, 13, 5, 5.3)}" fill="${A}"/>
    ${plane(polygon(72, 30, 6.5, 5, 2.7), HI_A)}
    <path d="M76 58 Q78 64 84 66 Q78 68 76 74 Q74 68 68 66 Q74 64 76 58 Z" fill="${P}"/>`),

  /* Lightning bolt with a burst behind it. */
  badtzmaru: ink(`
    <path d="M60 16 L28 55 H46 L42 84 L74 45 H56 Z" fill="${A}"/>
    ${plane('M60 16 L28 55 L46 55 L56 45 Z', HI_A)}
    ${plane('M46 55 L42 84 L56 67 L52 55 Z', LO_A)}`),

  /* Paw print — pad and four toes, each catching the light. */
  chococat: ink(`
    <ellipse cx="50" cy="67" rx="21" ry="17" fill="${P}"/>
    <ellipse cx="44" cy="62" rx="8" ry="5.5" fill="${HI}" stroke="none"/>
    <ellipse cx="25" cy="45" rx="8.5" ry="10.5" fill="${P}"/>
    <ellipse cx="23" cy="42" rx="3.5" ry="4.5" fill="${HI}" stroke="none"/>
    <ellipse cx="41" cy="31" rx="8.5" ry="10.5" fill="${P}"/>
    <ellipse cx="39" cy="28" rx="3.5" ry="4.5" fill="${HI}" stroke="none"/>
    <ellipse cx="59" cy="31" rx="8.5" ry="10.5" fill="${P}"/>
    <ellipse cx="57" cy="28" rx="3.5" ry="4.5" fill="${HI}" stroke="none"/>
    <ellipse cx="75" cy="45" rx="8.5" ry="10.5" fill="${P}"/>
    <ellipse cx="73" cy="42" rx="3.5" ry="4.5" fill="${HI}" stroke="none"/>`),

  /* Beret. The band has to be *narrower* than the crown or the two read as a
     lid on a pot rather than a hat. */
  pompompurin: ink(`
    <ellipse cx="50" cy="54" rx="30" ry="18" fill="${P}"/>
    <ellipse cx="40" cy="48" rx="13" ry="7" fill="${HI}" stroke="none"/>
    <rect x="32" y="66" width="36" height="12" rx="6" fill="${A}"/>
    <path d="M36 72 H64" stroke-width="${SW_FINE}"/>
    <circle cx="50" cy="32" r="6" fill="${A}"/>
    <circle cx="48" cy="30" r="2" fill="${HI_A}" stroke="none"/>`),

  /* Microphone, grille, stand and a cable — plus two rage shards. */
  aggretsuko: ink(`
    <rect x="35" y="17" width="30" height="42" rx="15" fill="${P}"/>
    <rect x="40" y="24" width="7" height="28" rx="3.5" fill="${HI}" stroke="none"/>
    <path d="M36 31 H64 M35 39 H65 M36 47 H64" stroke-width="${SW_FINE}"/>
    <path d="M50 59 V71"/>
    <rect x="33" y="71" width="34" height="11" rx="5.5" fill="${A}"/>
    <path d="M67 77 Q78 77 78 66" stroke-width="${SW_FINE}"/>
    <path d="M19 26 L28 34 M81 26 L72 34"/>`),

  /* Football — a centred pentagon, five radial seams and the five panels they
     run to, all generated so it is symmetric rather than nearly symmetric. */
  pochacco: ink(`
    <circle cx="50" cy="50" r="32" fill="${W}"/>
    <ellipse cx="37" cy="37" rx="9" ry="6.5" fill="${HI}" stroke="none"/>
    ${spokes(50, 50, 14, 32, 5)}
    <path d="${polygon(50, 50, 14, 5)}" fill="${P}"/>
    ${ring(50, 50, 23, 7, 5, 36)}`),

  /* Fin, ridge and rising bubbles. */
  hangyodon: ink(`
    <path d="M28 74 C33 46 48 25 67 16 C61 40 66 58 82 72 C64 76 45 76 28 74 Z" fill="${P}"/>
    ${plane('M28 74 C33 46 48 25 67 16 C56 32 45 51 41 74 Z', HI)}
    <path d="M62 26 Q60 46 64 62" stroke-width="${SW_FINE}"/>
    <circle cx="26" cy="36" r="6.5" stroke="${A}"/>
    <circle cx="19" cy="54" r="4.5" stroke="${A}"/>
    <circle cx="27" cy="62" r="3" stroke="${A}"/>`),

  /* Deliberately plain: a ring. This is the theme for turning the cute off, so
     it is the one emblem that does not get anything added to it. */
  plain: ink(`
    <circle cx="50" cy="50" r="30"/>
    <circle cx="50" cy="50" r="12" fill="${P}" stroke="none"/>`),
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
