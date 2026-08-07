# Kittycal against the field

A competitive audit. `AUDIT.md` asks whether the app does what it says correctly;
this asks whether what it says is the right list, measured against the apps
people actually use.

**Status.** Eight gaps, five closed. G2 — the Next period headline — was fixed in
[#58](https://github.com/LilShaum/my-tasks/commit/5e9fa79). G1, G3, G4 and G5 are fixed on
this branch. Closed entries are kept as the record. The other three are open and
verified open against this commit; the line references have been re-resolved,
not assumed.

## 0. What counts as a gap

The bar from `AUDIT.md` §0 still applies — a change is an improvement only if it
makes her data safer, the app more honest, the daily loop cheaper, her own
history more legible, the app more usable for her specifically, or more pleasant
to open, and none of the others worse.

A competitor having a feature is not, by itself, an argument. Most of what the
market leaders ship exists to justify a subscription or to feed a recommendation
engine, and copying it would cost the one property Kittycal has that none of
them do. So every gap below carries a verdict, and three of them are **rejected
on purpose** with the reason written down, so they don't get re-argued.

The severity scale is the one already in use: **S1** data loss or a false
statement about her health data, **S2** a feature that works wrongly in a
plausible real state, **S3** friction or an accessibility barrier, **S4** polish
and latent risk.

## 1. The field

| App | Why it's here |
|---|---|
| **Flo** | 380M+ downloads, the largest by a wide margin, and the app the README already benchmarks against. Also the cautionary tale: FTC action in 2021, a $56M class-action settlement in 2025. |
| **Clue** | The credibility leader. 100+ tracking options, a dedicated perimenopause mode, wearable sync, 300+ expert-written guides. |
| **Apple Health Cycle Tracking** | The default on every iPhone, so it's the real competitor for anyone who never installs anything. Retrospective ovulation estimates from wrist temperature, cycle-deviation notifications, 12-month history as a PDF. |
| **Natural Cycles** | The only FDA-cleared contraceptive app — six clearances now, plus Oura, Apple Watch and Garmin integrations. Defines the ceiling Kittycal explicitly declines to reach for. |
| **Euki** | Privacy-first, local-only, no account, open source. The closest thing to a peer, and it ships one thing Kittycal doesn't: a duress PIN. |
| **Drip** | Open source, offline, sympto-thermal fertility rather than calendar arithmetic. |
| **Ovia / Glow / Premom** | The trying-to-conceive and pregnancy specialists — the axis Kittycal has declared in its data model and not built. |

## 2. Where Kittycal is already ahead

Recorded so these don't get traded away while closing a gap.

- **The privacy claim is falsifiable.** Every competitor's privacy position is a
  policy document. Kittycal's is a CSP plus `test/network.mjs`, which walks the
  app and fails on a single off-origin request. Current run: 204 same-origin, 0
  off-origin, and the app still renders with the network cut. Euki and Drip make
  the same promise; neither ships the test.
- **Predictions state their own confidence, and stop.** Confidence is on the
  screen next to every forecast, never hidden (`today.js:773`). Fertile windows
  widen instead of narrowing when the data is thin (`predict.js:414`). Fertility
  output disappears entirely on hormonal contraception (`predict.js:400`), which
  is correct and which Flo does not do. Past 90 days the app says the history
  has gone stale rather than inventing "402 days late" (`predict.js:65`). Since
  G2, the next-period headline is an interval derived from her own observed
  variation (`predict.js:223`) — which, on this list, only Flo's perimenopause
  product also does.
- **It scores its own past predictions.** The "How close Kittycal has been" card
  (`insights.js:343`) re-forecasts each past cycle from only what was known
  before it started and reports the typical miss in days. No major competitor
  shows you its own error.
- **Luteal length is measured, not assumed.** `ovulation.js` derives it from her
  own confirmed thermal shifts and falls back to the population 14 only when it
  can't (`predict.js:286`). A fixed 14 is a permanent two-day error in the one
  number offered for planning.
- **The doctor report is free.** Flo paywalls the equivalent at $49.99/year;
  Apple gives you a 12-month PDF only. Kittycal's is six months of plain tables,
  and it separates moods from physical symptoms so a clinician doesn't read
  "Happy — 3 of 3 cycles" as a presenting complaint (`taxonomy.js:383`).
- **Accessibility is structural.** Every colour derives from two numbers in
  OKLCH at pinned lightness, so all 14 themes hit the same contrast ratios by
  construction, verified across 196 colour pairs.

## 3. Gaps worth closing

Ranked by what they cost her, not by effort.

### G1 — The lateness model was wrong for anyone whose cycles vary · S2 · **CLOSED**

The most serious finding here, because it isn't a missing feature — it's the app
being confidently wrong at a real user.

`birthYear` is asked for during onboarding (`onboarding.js:237`), normalised on
every read, carried in every backup, and used in exactly one place: a line of
text in the doctor report (`report.js:82`). Nothing else consults it.

Meanwhile the prediction engine treated every overdue cycle as lateness with a
day count, and everything past 90 days as stale. For a 47-year-old whose cycles
are lengthening and skipping, that was the wrong sentence every single month — "17 days late", then "43 days
late", then the data has "gone stale" and she's asked for a fresh period date.
Cycles becoming irregular *is the signal*, and the app reads it as failure to
log.

Both leaders fixed exactly this. Clue's perimenopause mode replaced "your period
is X days late" with a cycle-comparison view. Flo's shows a window of time
rather than a date, for the same reason.

**Fixed, and without a mode or an age gate.** The plan here was to key the
change off `birthYear`, and that turned out to be the wrong instinct: the
signal is in the cycles, not the birth certificate. Someone of 26 with PCOS gets
told she is late on day 45 for exactly the same bad reason, and `birthYear` is
optional besides, so an age gate would have missed the people it was aimed at
and helped nobody else. All three changes below are driven by her own data.

**Lateness is measured from the far edge of the start window, not the estimate**
(`predict.js:385`). #58 already drew the window; late now means past the point
where her own observed variation stops explaining it. A new `withinWindow` state
sits between the two — past the estimate, still inside her spread — and Today
calls it *due* rather than late (`today.js:867`). On a 26-to-48-day history the
app used to say "late" for most of every month; now it says so only when it is
true. Below two cycles there is no window and the old behaviour stands.

**A long gap is no longer blamed on her records** (`predict.js:365`). Staleness
now asks *why* the forecast stopped: `staleReason` is `'dormant'` when she has
not logged in a month, and `'absent'` when she is still logging and simply has
not bled. Both suppress the forecast, because neither supports one, but the
absent case keeps her day count in the ring, states the plain fact, and leaves
the ACOG prompt to point at a clinician — instead of "too far back to predict
from, mark your most recent period", which was false and which asked her to
re-enter something she had already entered. `phases.js` follows: the absent case
resolves to the existing `overdue` phase rather than to `unknown`, whose "log a
period and Kittycal can start working out where you are" is the brand-new-user
line and an insult to someone with five cycles behind her.

**The missing chips**: vaginal dryness beside the hot flushes and night sweats
already there, and HRT filed under Life with the other things that change a
cycle from outside it, rather than as a symptom.

Nine tests cover the new states, including the one that keeps the old behaviour
when `logs` is not passed at all.

### G2 — The next-period date was a point estimate wearing a range's clothing · S2 · **CLOSED**

Fixed in [#58](https://github.com/LilShaum/my-tasks/commit/5e9fa79). Kept as the
record of what was wrong.

The Next period card headlined `12 Aug – 16 Aug`, which was the predicted *bleed
span* — start plus average period length — with "Estimated 5-day period"
underneath. At a glance, on the screen people look at most, a range in that
position reads as "it'll start somewhere in here". It didn't. The start date
carried no interval at all, and a metronome-regular cycle and a wildly irregular
one produced headlines of identical width, because the width was the period
length in both cases. Meanwhile `stats.spread` — her longest observed cycle
minus her shortest — was computed on every prediction and spent entirely on
choosing between the words "regular", "variable" and "irregular".

The fix is `startWindow()` (`predict.js:223`), consumed at `today.js:736`: half
the observed spread either side of the estimate, so the headline widens when she
is irregular and narrows when she is not. Three bounds beyond what this document
asked for, all of them right — nothing below two cycles, since a window invented
from one observation is the same false precision pointing the other way; a floor
of a day either side, so a perfectly regular cycle doesn't quietly reclaim
precision by collapsing to a bare date; and a cap at a week, because past that
the honest message is the confidence line saying the history is too variable,
not a fortnight-wide band drawn as a forecast. The bleed length survives a line
down, stated as a fact about the period rather than a claim about the forecast.

### G3 — Nothing could get in except Kittycal's own export · S3 · **CLOSED**

`parseImport` accepted one shape: Kittycal's own (`backup.js:112`). For anyone
with three years of history in Flo or Clue, the cost of switching was retyping
it or losing it — and losing it is what actually happens. The largest adoption
barrier in this document, and nothing to do with features.

**A correction to this document.** It previously said "Clue exports CSV". That
is wrong, and checking it changed the design. Clue's export is a
password-protected zip containing JSON, delivered by email; Apple Health's is a
zipped XML. Neither can be opened by an app with no dependencies and no
network, and writing a parser for a format I could not obtain a sample of would
have produced exactly the kind of importer that half-works and silently drops
data.

**So the importer is format-tolerant rather than app-specific**
(`csv.js parseCSVImport`). It sniffs a delimiter (comma, semicolon or tab),
finds the date column by name, finds flow, symptom and note columns if they are
there, and reports what it understood before writing anything: which column it
read as dates, which as flow, and how many rows it could not read. Everyone in
the field either exports CSV directly or can be got into a spreadsheet in one
step, and this reads whatever comes out of that.

Two decisions worth keeping:

**Dates are never guessed.** `03/04/2026` is 3 April or 4 March, and picking
the wrong one moves a period start by a month and quietly corrupts every cycle
length after it. The importer only accepts a day-first or month-first column
when the file itself settles the question — a component above 12 somewhere in
that column can only be a day. When nothing settles it, the import stops and
says to reformat as `YYYY-MM-DD`. Refusing is the honest failure; guessing is
the one that costs her data.

**It merges, it does not replace** (`store.js mergeIn`). Restoring a backup
means "this file is the truth"; bringing in three years from another app means
"add this to what I have". A day already logged in Kittycal always wins, since
hers carries symptoms, severities and a note where the imported one carries a
date and a flow. It sits on its own settings row for the same reason — putting
both on one row and switching on the file extension would make the destructive
one reachable by accident.

### G4 — Export was JSON only · S3 · **CLOSED**

One `Blob`, `application/json`. Complete, readable, and useless to every tool
anyone owns: a spreadsheet can't open it, a clinician can't read it, a
researcher can't load it. Rule 4 — data that goes in and can't come out is data
that wasn't worth collecting.

Now `toCSV` writes one row per day with the cycle number and cycle day already
computed, so cycle-level analysis needs no second file — which is why this
shipped as one table rather than the two the plan called for. Period days get a
row even when nothing else was logged on them, or the file's period column
would disagree with the app.

Two things the plan didn't anticipate:

**Labels, not ids.** `Tender breasts`, not `tender-breasts`. The CSV is for
reading; the JSON is the lossless one, and this is the right trade for a format
whose entire purpose is being opened by something else.

**Formula injection is defused** (`csv.js csvField`). Excel, Sheets and Numbers
all execute a cell beginning `=`, `+`, `-` or `@`. Notes are free text, so
without this her own export could hand a spreadsheet something to run when she
opens it. A leading apostrophe makes it a string again.

It deliberately does not touch `lastBackup`: the CSV cannot restore her, so
letting it silence the backup prompt would trade a real safeguard for a file
that only looks like one.

### G5 — Birth control tracking was a checkbox · S3 · **CLOSED**

`pillTaken` was a boolean (`model.js:35`) with a daily nudge attached
(`reminders.js:190`) — a tick box with no memory. It could tell her to take one
today while having no idea whether today was an active pill or the fourth day
of a break, nor whether yesterday was ever marked. The one moment a pill
tracker earns its place is the moment she cannot remember about yesterday, and
that was the moment it had nothing to say.

`pill.js` adds the pack: five regimen shapes (21/7, 24/4, continuous, extended,
or off), a start date, and from those a position — which pill of how many,
which break day, how many left, which pack. Settings shows the rows only for
methods that come in a pack, so an implant or an IUD never sees a question it
cannot answer. Today gets a card with the position and the days that have
nothing on them.

**The wording is the feature.** It says days are **not marked**, never that
pills were missed, and it does not say what to do about one:

- An unmarked day is a fact about the *record*, not about her body. She may
  well have taken it and not opened the app. The app already draws exactly this
  distinction — `checkedIn` exists so "she said nothing happened" and "she never
  answered" stay different things — and frightening someone about a pill she
  actually took is a worse failure than saying nothing.
- What to do after a genuinely missed pill depends on which pill, how late, and
  where in the pack. That is the leaflet's job and the pharmacist's. The card
  and the settings note both say so rather than improvising medical advice,
  which is the line the README already draws for the whole app.

And the reminder limitation is stated where it bites rather than only in
general: a contraception reminder that fires when you next open the app is not
a contraception reminder, and the settings note says that in those words.

### G6 — Two modes are declared in the data model and neither exists · S4

`mode: 'cycle'|'conceive'|'pregnancy'` is defined at `model.js:45`, defaulted at
`model.js:96`, normalised on every settings read, and written into every backup
file. It is read by nothing. A grep across `js/` returns the declaration and the
default and no consumer.

Trying-to-conceive is the largest feature axis in the market — Flo, Ovia, Glow
and Premom all organise around it — and Kittycal is closer to it than the empty
field suggests. It already logs ovulation tests (`taxonomy.js:217`), charts BBT
with thermal-shift detection, records egg-white discharge and unprotected sex,
and bands conception chance into tiers rather than fake percentages
(`predict.js:522`). What's missing is arrangement, not data: a mode that puts
the fertile-window countdown and today's tier at the top, surfaces the LH-test
row daily during the window, and applies a sympto-thermal double check — a
temperature shift *confirmed by* mucus, the way Drip does — instead of calendar
arithmetic alone.

Pregnancy mode is a second application: week-by-week gestation, a different
symptom set, different alarms. It should not be built here.

**Verdict: build `conceive`, drop `pregnancy` from the union.** Until then the
field is a promise the code doesn't keep, and it ships in every export.

### G7 — No cycle-by-cycle comparison · S4

Insights plots cycle length as a row of dots (`insights.js:226`), which answers
"are my cycles consistent" and not "what was that bad one in March like".
There's no route from a point on that chart to the cycle behind it. Clue made
Cycle View the centre of its relaunch for this reason, and it's the natural home
for the symptom severity the app already stores and barely analyses.

**Verdict: build, after the above.**

### G8 — No duress PIN · S4, and genuinely optional

Euki ships one: a second PIN that opens a false screen. Kittycal's lock is
already reasoning in this threat model — `lock.js:179` deliberately has no
lockout after N failed attempts, because the threat is a person physically
holding the phone, and that is exactly the argument that leads to a decoy.

**Verdict: consider, don't rush.** A decoy that is discoverable — wrong data
volume, a suspicious second database, an app that behaves differently under
inspection — is worse than none, because it converts "I have nothing" into "she
is hiding something". This is a feature that must be either done properly or
left alone, and it should not be built in the same pass as anything else.

## 4. Deliberately not built

Checked, and the answer is still no. Written down so it stays no.

- **Background push reminders.** Verified rather than assumed: Notification
  Triggers (`showTrigger` / `TimestampTrigger`) never left Chrome origin trial
  and is not in the Notifications standard, and Web Push — including iOS 16.4+ —
  requires a push service, which necessarily learns when her period is due.
  There is no serverless path to a notification that fires while the app is
  closed. The README's account of this is accurate and should stay.
- **Wearable sync** (Oura, Apple Watch, WHOOP, Garmin). Every one is an OAuth
  handshake with a vendor cloud. A *file* import of an Apple Health export would
  be consistent with the privacy model and belongs with G3 if it's ever wanted;
  live sync does not.
- **FDA-cleared contraception.** Natural Cycles holds six clearances for this.
  It is a regulated medical device and it contradicts the app's own disclaimer.
- **Community, AI assistant, symptom checker.** All need a server, and the
  symptom checker is a diagnosis engine besides. The ACOG-threshold prompt
  (`acog.js`) is the honest version and already ships.
- **Home-screen widgets.** Not available to a PWA.

## 5. Order

~~**G2** — the prediction interval.~~ Closed in #58.
~~**G1** — the lateness model.~~ Closed on this branch.

1. **G3 + G4** — import and CSV export together, since they're the same seam.
   G3 is the largest adoption barrier in this document and the only item here
   that is purely a matter of parsing someone else's file.
2. **G5** — the pill pack.
3. **G6** — `conceive` mode, or delete the field. It ships in every backup
   either way, so leaving it declared and unread is the one option that isn't
   defensible.
4. **G7**, then **G8** on its own.

Nothing above requires a network request, an account, or a subscription. That
constraint has not cost Kittycal a single feature on this list — the two things
it genuinely cannot do (background push, live wearable sync) are in §4, and both
are limits of the browser rather than of the design.
