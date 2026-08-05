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
  return Array.from({ length: sides }, (_, i) => {
    const angle = (Math.PI * 2 * i) / sides - Math.PI / 2;
    const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
    return `<path d="M${round(cx + from * dx)} ${round(cy + from * dy)} `
      + `L${round(cx + to * dx)} ${round(cy + to * dy)}"/>`;
  }).join('');
}

/**
 * Emblem markup, keyed by theme id. Values are the inner content of a
 * `<svg viewBox="0 0 100 100">`.
 * @type {Record<string, string>}
 */
export const EMBLEMS = {
  /* Ribbon bow — two symmetric loops, a knot, two tails. */
  hellokitty: ink(`
    <path d="M50 42 Q31 20 21 29 Q12 38 22 49 Q35 56 50 42 Z" fill="${P}"/>
    <path d="M50 42 Q69 20 79 29 Q88 38 78 49 Q65 56 50 42 Z" fill="${P}"/>
    <path d="M43 50 Q38 64 42 75"/>
    <path d="M57 50 Q62 64 58 75"/>
    <circle cx="50" cy="42" r="9" fill="${A}"/>`),

  /* Heart. Was a heart plus a bow plus a bead; three motifs stacked in one
     emblem is what "busy" means, and none of them survived 30px. */
  mymelody: ink(`
    <path d="M50 84 C26 66 18 54 18 42 A16 16 0 0 1 50 36 A16 16 0 0 1 82 42
             C82 54 74 66 50 84 Z" fill="${P}"/>
    <circle cx="50" cy="41" r="7" fill="${A}"/>`),

  /* Three-point jester cap with bell tips. */
  kuromi: ink(`
    <path d="M23 81 Q23 46 35 30 L41 48 L50 26 L59 48 L65 30 Q77 46 77 81 Z" fill="${P}"/>
    <circle cx="35" cy="28" r="6.5" fill="${A}"/>
    <circle cx="50" cy="24" r="6.5" fill="${A}"/>
    <circle cx="65" cy="28" r="6.5" fill="${A}"/>`),

  /* Cloud puff with a curled tail. */
  cinnamoroll: ink(`
    <path d="M29 70 A15 15 0 0 1 31 42 A18 18 0 0 1 63 38 A15 15 0 0 1 71 70 Z" fill="${P}"/>
    <path d="M71 62 Q84 58 80 47 Q76 40 70 46"/>
    <circle cx="41" cy="56" r="3.5" fill="${S}" stroke="none"/>
    <circle cx="57" cy="56" r="3.5" fill="${S}" stroke="none"/>`),

  /* Lily pad with a droplet.

     The notch used to be a thin wedge running all the way to the centre, which
     does not read as a lily pad — it reads as a pie chart with a slice taken
     out. It now opens wide at the rim and stops short of the middle. */
  keroppi: ink(`
    <path d="M62 21.3 A32 32 0 1 1 38 21.3 L50 45 Z" fill="${P}"/>
    <path d="M74 23 Q84 37 84 44 A11 11 0 0 1 62 44 Q62 37 74 23 Z" fill="${A}"/>`),

  /* Yolk dome on a wobbly white. */
  gudetama: ink(`
    <path d="M22 71 Q12 64 18 53 Q24 48 30 51 Q29 36 45 35 Q50 37 52 43
             Q61 34 75 40 Q80 44 78 52 Q88 55 86 65 Q84 71 77 71 Z" fill="${W}"/>
    <circle cx="51" cy="56" r="15" fill="${P}"/>
    <path d="M44.5 54 q3.5 3.5 7 0" stroke-width="${SW_FINE}"/>
    <path d="M55 54 q3.5 3.5 7 0" stroke-width="${SW_FINE}"/>`),

  /* Two stars, one large and one small — Little Twin Stars.

     Computed rather than typed. The old star was a hand-written point list,
     which is why it was neither regular nor centred. */
  twinstars: ink(`
    <path d="${polygon(41, 63, 25, 5, 10.2)}" fill="${P}"/>
    <path d="${polygon(74, 28, 10.5, 5, 4.3)}" fill="${A}"/>`),

  /* Lightning bolt. Was a thin outline in the accent colour at a third of the
     area of every other emblem, parked in the top-left corner. */
  badtzmaru: ink(`
    <path d="M60 16 L28 55 H46 L42 84 L74 45 H56 Z" fill="${A}"/>`),

  /* Paw print. */
  chococat: ink(`
    <ellipse cx="50" cy="67" rx="21" ry="17" fill="${P}"/>
    <ellipse cx="25" cy="45" rx="8.5" ry="10.5" fill="${P}"/>
    <ellipse cx="41" cy="31" rx="8.5" ry="10.5" fill="${P}"/>
    <ellipse cx="59" cy="31" rx="8.5" ry="10.5" fill="${P}"/>
    <ellipse cx="75" cy="45" rx="8.5" ry="10.5" fill="${P}"/>`),

  /* Beret. The band has to be *narrower* than the crown or the two read as a
     lid on a pot rather than a hat — which is exactly what a full-width band
     under a dome looked like. */
  pompompurin: ink(`
    <ellipse cx="50" cy="54" rx="30" ry="18" fill="${P}"/>
    <rect x="32" y="66" width="36" height="12" rx="6" fill="${A}"/>
    <circle cx="50" cy="32" r="6" fill="${A}"/>`),

  /* Microphone with two rage shards. Fewer, larger parts than the first cut:
     a 24-wide head with two grille lines and a long thin stem was six things
     to resolve inside 30 pixels, and resolved as none of them. */
  aggretsuko: ink(`
    <rect x="35" y="17" width="30" height="42" rx="15" fill="${P}"/>
    <path d="M35 38 H65" stroke-width="${SW_FINE}"/>
    <path d="M50 59 V71"/>
    <rect x="33" y="71" width="34" height="11" rx="5.5" fill="${A}"/>
    <path d="M19 26 L28 34"/>
    <path d="M81 26 L72 34"/>`),

  /* Football. One centred pentagon and five radial seams, both generated, so
     it is symmetric instead of approximately symmetric. */
  pochacco: ink(`
    <circle cx="50" cy="50" r="32" fill="${W}"/>
    ${spokes(50, 50, 14, 32, 5)}
    <path d="${polygon(50, 50, 14, 5)}" fill="${P}"/>`),

  /* Fin with rising bubbles. A broad triangle with a swept leading edge and a
     concave trailing one — narrow it and it stops being a fin and starts
     being a leaf. */
  hangyodon: ink(`
    <path d="M28 76 C33 48 48 27 67 18 C61 42 66 60 82 74 C64 78 45 78 28 76 Z" fill="${P}"/>
    <circle cx="28" cy="38" r="6.5" stroke="${A}"/>
    <circle cx="22" cy="56" r="4.5" stroke="${A}"/>`),

  /* Deliberately plain: a ring. */
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
