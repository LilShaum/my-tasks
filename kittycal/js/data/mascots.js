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
 * ── What the four best ones were doing that the other ten were not
 *
 * The bow, the hood, the jester cap and the lily pad were picked out as the
 * only good ones in the set, so the rest of it was rebuilt to whatever those
 * four had. Reading them back, it was four things, and three more rules fell
 * out of trying to give them to everything else:
 *
 *   5. **A second colour, on a form that belongs to the motif** — the knot in
 *      the bow, the hood's ear bows, the cap's brim and bells, the bloom on
 *      the pad. Every one of those sits at an **edge or a junction**, never as
 *      an island inside the primary form: an accent shape fully surrounded by
 *      the fill reads as a hole punched through it, every time.
 *   6. **Shading only on the one big form.** `lit()` and `shade()` need a form
 *      wide enough for the boundary to run off both ends of it. On anything
 *      small the curve closes inside the shape and the plane becomes a lens
 *      floating in the middle — the same hole again. All four leave their
 *      bells, bows and droplets flat, and so does everything else now.
 *   7. **White is for real features, not for glints.** `--card` is a hair off
 *      the page colour, so a white sliver laid on a mid-tone form reads as a
 *      chip out of it. Where the four use white it is a whole area that is
 *      meant to be white — the hood's face opening, the bloom's centre, the
 *      droplets — and that is the only way it is used now.
 *
 * A fourth thing was not the drawings at all. Two themes had `--primary`
 * pushed below `--line`, which inverts every outlined shape into a pale border
 * round a dark fill; and in dark mode twelve of the fourteen were losing their
 * hand-tuned `--accent` to a specificity clash. Both are fixed in themes.css,
 * and between them they were doing more damage to this set than any of the
 * geometry was.
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

  /* Cloud with the sun behind it — rays, a puff drifting off, rain starting.

     The cloud on its own was one blue lump: no second colour anywhere, nothing
     inside the silhouette, and two small puffs that read as smudges. The sun
     is what the accent hue is for, and putting it *behind* means the cloud's
     own outline does the occluding — no seam to get wrong. */
  cinnamoroll: ink(`
    <path d="M72 16 V20 M85 27 H81 M83 18 L80 21 M84 36 L81 34"
          stroke="${A}" stroke-width="${SW_MID}"/>
    ${shaded('M72 17 C78 17 82 22 82 27 C82 33 78 37 72 37 C66 37 62 33 62 27 '
             + 'C62 22 66 17 72 17 Z', A, '', SW_MID)}
    ${shaded('M31 74 C20 74 14 64 20 55 C16 47 24 39 33 42 C35 32 47 28 54 34 '
             + 'C60 27 71 29 73 39 C82 40 85 50 79 57 C82 66 74 74 65 74 Z', P,
             lit(38))}
    ${shaded('M20 29 C17 26 19 21 23 22 C25 18 31 19 32 23 C36 23 37 28 34 30 '
             + 'C29 32 24 32 20 29 Z', P, '', SW_MID)}
    <path d="M38 80 C37 83 39 85 41 84 C43 83 42 80 40 78 Z" fill="${A}"
          stroke-width="${SW_FINE}"/>
    <path d="M56 82 C55 85 57 87 59 86 C61 85 60 82 58 80 Z" fill="${A}"
          stroke-width="${SW_FINE}"/>`),

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

  /* Fried egg on a plate — a white that spreads unevenly, the yolk proud of it.

     The egg alone had no second colour anywhere: a white shape, a yellow yolk,
     and two sparkles. The plate is drawn first so the egg's own outline hides
     where the two meet, and it is the one place the accent can go without
     turning something edible a colour food is not. */
  gudetama: ink(`
    ${shaded('M16 67 C16 77 32 85 50 85 C68 85 84 77 84 67 C84 62 74 59 50 59 '
             + 'C26 59 16 62 16 67 Z', A, '', SW_MID)}
    ${shaded('M25 71 C15 70 10 60 17 53 C13 45 21 39 28 43 C27 32 39 27 46 34 '
             + 'C50 27 60 26 65 32 C73 29 82 35 80 44 C89 47 90 58 82 63 '
             + 'C84 70 76 74 68 71 Z', W)}
    ${shaded('M46 41 C57 39 66 47 65 57 C64 67 53 72 45 67 C36 61 36 45 46 41 Z', P,
             lit(50), SW_MID)}
    ${spark(80, 27, 4.5)}
    ${spark(20, 34, 3.5)}`),

  /* A little constellation — three stars and two sparkles.

     The big star carried a `shade()` and no `lit()`, so the whole left side of
     the drawing sat in shadow with nothing lit to be in shadow *of*, and the
     emblem read muddy at every size. Both faces fixes it.

     A crescent moon was tried here and could not be made to work: one thin
     enough to read as a moon is thinner than the outline it needs, so the ink
     eats the fill and what is left is a gold almond. */
  twinstars: ink(`
    ${shaded('M44 26 Q48 38 51 44.3 Q61 43 70.6 45.4 Q62 52 55.4 57.7 '
             + 'Q58 68 60.5 76.6 Q52 70 44 66 Q36 70 27.6 76.6 Q30 68 32.6 57.7 '
             + 'Q26 52 17.4 45.4 Q27 43 34.9 44.3 Q40 38 44 26 Z', P,
             lit(38) + shade(52))}
    ${shaded('M72 17 Q74 24 76.6 26 Q81 25 84.4 26 Q80 30 79.6 33.5 '
             + 'Q80 38 79 40.5 Q75 37 72 36 Q69 37 64.4 40.5 Q65 36 64.4 33.5 '
             + 'Q61 30 59.6 26 Q64 25 67.4 26 Q70 24 72 17 Z', A, '', SW_MID)}
    ${shaded('M76 60 Q78 67 83 69 Q78 71 76 77 Q74 71 69 69 Q74 67 76 60 Z', A,
             '', SW_MID)}
    ${spark(24, 24, 5, P)}
    ${spark(58, 84, 3.5)}`),

  /* Lightning bolt — bent edges, a lit face down its leading edge, a burst.

     The burst was four ticks at four unrelated angles and lengths, which read
     as scratches on the artwork rather than as light coming off it. Six rays
     of matching length, aimed out from the bolt's own centre, are a burst. */
  badtzmaru: ink(`
    <path d="M31 24 L36 30 M69 22 L64 28 M21 47 L28 48
             M79 52 L72 53 M29 72 L34 68 M74 76 L68 71"
          stroke-width="${SW_FINE}"/>
    ${shaded('M63 15 C53 29 41 43 28 55 C34 57 41 57 47 56 C45 66 43 76 42 85 '
             + 'C53 71 65 57 75 44 C69 46 62 46 56 45 C59 35 61 25 63 15 Z', A,
             lit(46, HI_A) + shade(56, LO_A))}
    ${spark(24, 33, 4.5, P)}
    ${spark(77, 66, 3.5, P)}`),

  /* A mug of cocoa — steam, a painted band, a marshmallow floating in it.

     This was a paw print for four attempts and a paw print is the wrong object
     for this theme. Four small forms above one large one is a face waiting to
     happen: the accent went inside the pad and read as a hole, went on the
     toes and left rings with dots in them, went along the bottom of the pad
     and became an open mouth with two toes for eyes. The version that finally
     passed all the rules did it by giving up and parking a heart next to the
     paw, which is decoration bolted onto a drawing rather than a drawing.

     The theme is called "warm cocoa". A mug was there the whole time: it takes
     a band round its middle the way the jester cap takes a brim, the steam is
     floating detail that belongs to the object rather than sitting beside it,
     and there is nowhere on it for a face to appear by accident. */
  chococat: ink(`
    <path d="M36 26 C30 22 42 19 36 15 M56 25 C51 21 61 18 56 15"
          stroke="${A}" stroke-width="${SW_MID}"/>
    ${shaded('M68 38 C78 36 83 45 81 54 C79 61 72 65 66 63 C72 60 76 56 76 51 '
             + 'C77 45 73 41 68 38 Z', P)}
    ${shaded('M24 34 C25 52 28 68 32 76 C36 81 42 82 47 82 C52 82 58 81 62 76 '
             + 'C66 68 69 52 70 34 C64 44 30 44 24 34 Z', P,
             shade(60))}
    ${shaded('M26 54 C38 57 58 57 68 54 C67 60 66 65 65 69 C55 72 39 72 29 69 '
             + 'C28 65 27 60 26 54 Z', A)}
    ${shaded('M24 34 C31 26 63 26 70 34 C64 44 30 44 24 34 Z', W, '', SW_MID)}`),

  /* Beret — a slouched crown, a band in front of it, a stalk behind.

     The crown is yellow in its own theme, and `--emb-lo` on a yellow turns
     olive: the shaded half read as dirt rather than as shadow. A narrower
     shadow and a proper highlight down the lit side fixes it without touching
     the token, which every other emblem depends on. */
  pompompurin: ink(`
    ${shaded('M48 33 C45 29 47 22 51 22 C56 22 58 29 55 33 Z', A, '', SW_MID)}
    ${shaded('M21 55 C21 41 35 33 51 33 C68 33 81 42 80 55 C79 65 66 71 50 71 '
             + 'C33 71 22 65 21 55 Z', P,
             lit(40) + shade(70))}
    <path d="M34 45 C43 40 58 40 67 45" stroke-width="${SW_FINE}"/>
    ${shaded('M28 64 C42 72 58 72 72 64 C75 70 73 77 66 79 C55 83 40 82 32 78 '
             + 'C26 75 25 69 28 64 Z', A)}
    <path d="M37 74 C45 77 56 77 64 74" stroke-width="${SW_FINE}"/>`),

  /* Microphone — grille, stand, base, and the sound coming off it.

     The noise was four unmatched ticks that read as scratches. Sound leaving a
     microphone is arcs, and drawing them as arcs at two radii says "loud"
     where four straight strokes said "somebody scribbled on this". */
  aggretsuko: ink(`
    <path d="M30 26 C25 32 24 41 27 48 M22 22 C16 30 15 42 19 53
             M70 24 C75 30 77 40 74 47 M79 21 C85 29 86 41 82 50"
          stroke="${A}" stroke-width="${SW_FINE}"/>
    <path d="M51 57 C51 63 51 68 51 72" stroke-width="${SW_MID}"/>
    ${shaded('M35 72 C44 69 57 69 66 72 C68 77 66 82 60 83 C51 85 42 84 37 81 '
             + 'C34 79 33 75 35 72 Z', A)}
    ${shaded('M41 19 C49 14 58 17 61 25 C64 34 62 45 58 53 C54 59 46 59 43 53 '
             + 'C38 45 36 28 41 19 Z', P,
             lit(44) + shade(58))}
    <path d="M43 27 C49 25 55 25 60 27 M43 35 C49 33 55 33 60 35
             M44 43 C49 41 55 41 59 43" stroke-width="${SW_FINE}"/>`),

  /* Beach ball — panels sweeping pole to pole, and one bouncing away.

     A football twice, and a football is the wrong ball to draw at this size.
     Its panels are a pentagon-hexagon tiling: every panel edge has to meet a
     seam, every seam has to end on the rim, and getting one of them a couple
     of units out leaves a white notch at twelve o'clock and a stray triangle
     at seven — which is exactly what it did, both times, because those edges
     were hand-typed rather than derived.

     A beach ball's panels are four curves between the same two poles. They
     cannot be misaligned, because they all start and end at the same place. */
  pochacco: ink(`
    ${shaded('M50 19 C68 19 81 33 81 50 C81 68 67 81 50 81 C32 81 19 67 19 50 '
             + 'C19 32 33 19 50 19 Z', W,
             lit(36))}
    ${shaded('M50 19 C29 30 29 70 50 81 C53 70 53 30 50 19 Z', P, '', SW_MID)}
    ${shaded('M50 19 C53 30 53 70 50 81 C75 70 75 30 50 19 Z', A, '', SW_MID)}
    ${spark(78, 24, 5)}`),

  /* Dorsal fin — a lit leading edge, a ridge, bubbles rising past it.

     The bubbles were hollow outlines, which put the only accent in the drawing
     at a fraction of the weight of everything around it — four thin rings
     beside a solid fin. Filled, with a glint in the two biggest, they read as
     water rather than as leftover construction lines. */
  hangyodon: ink(`
    ${shaded('M29 75 C33 47 47 25 66 15 C61 39 65 58 81 73 C64 78 45 78 29 75 Z', P,
             lit(46) + shade(66))}
    <path d="M63 24 C60 43 63 59 70 70 M52 40 C50 52 51 62 54 71"
          stroke-width="${SW_FINE}"/>
    ${shaded('M27 33 C31 30 36 33 35 38 C34 43 28 44 25 40 C23 37 24 34 27 33 Z', A,
             '', SW_MID)}
    ${shaded('M29 35 C31 33 33 34 33 36 C32 38 29 37 29 35 Z', W, '', SW_FINE)}
    ${shaded('M18 53 C21 51 25 53 24 57 C23 60 19 61 17 58 C16 56 16 54 18 53 Z', A,
             '', SW_MID)}
    ${shaded('M20 55 C21 54 23 54 23 56 C22 57 20 56 20 55 Z', W, '', SW_FINE)}
    ${shaded('M26 64 C28 63 31 64 30 67 C29 69 26 69 25 67 Z', A, '', SW_FINE)}
    ${shaded('M34 22 C36 21 38 22 38 24 C37 26 34 26 33 24 Z', A, '', SW_FINE)}`),

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
