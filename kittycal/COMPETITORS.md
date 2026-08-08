# Kittycal against the field

A competitive audit. `AUDIT.md` asks whether the app does what it says correctly;
this asks whether what it says is the right list, measured against the apps
people actually use.

**Status.** Eight gaps, seven closed. G2 — the Next period headline — was fixed
in [#58](https://github.com/LilShaum/my-tasks/commit/5e9fa79). G1 and G3 to G7
are fixed on this branch. Closed entries are kept as the record of what was
wrong. **G8 is the one deliberately not built**, and §G8 says exactly why and
what building it would take. References here name a file and a symbol rather than a line
number: over this session the same citations rotted three times — once from
#58's changes and twice from this branch's own — and a confidently wrong line
number is worse than no citation at all.

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
  screen next to every forecast, never hidden (`today.js confidenceLine`). Fertile windows
  widen instead of narrowing when the data is thin (`predict.js, the widened window`). Fertility
  output disappears entirely on hormonal contraception (`predict.js showFertility`), which
  is correct and which Flo does not do. Past 90 days the app says the history
  has gone stale rather than inventing "402 days late" (`predict.js STALE_AFTER_DAYS`). Since
  G2, the next-period headline is an interval derived from her own observed
  variation (`predict.js startWindow`) — which, on this list, only Flo's perimenopause
  product also does.
- **It scores its own past predictions.** The "How close Kittycal has been" card
  (`insights.js accuracyCard`) re-forecasts each past cycle from only what was known
  before it started and reports the typical miss in days. No major competitor
  shows you its own error.
- **Luteal length is measured, not assumed.** `ovulation.js` derives it from her
  own confirmed thermal shifts and falls back to the population 14 only when it
  can't (`predict.js, the measuredLuteal call`). A fixed 14 is a permanent two-day error in the one
  number offered for planning.
- **The doctor report is free.** Flo paywalls the equivalent at $49.99/year;
  Apple gives you a 12-month PDF only. Kittycal's is six months of plain tables,
  and it separates moods from physical symptoms so a clinician doesn't read
  "Happy — 3 of 3 cycles" as a presenting complaint (`taxonomy.js CATEGORY_BY_ID`).
- **Accessibility is structural.** Every colour derives from two numbers in
  OKLCH at pinned lightness, so all 14 themes hit the same contrast ratios by
  construction, verified across 196 colour pairs.

## 3. Gaps worth closing

Ranked by what they cost her, not by effort.

### G1 — The lateness model was wrong for anyone whose cycles vary · S2 · **CLOSED**

The most serious finding here, because it isn't a missing feature — it's the app
being confidently wrong at a real user.

`birthYear` is asked for during onboarding (`onboarding.js, the year-of-birth field`), normalised on
every read, carried in every backup, and used in exactly one place: a line of
text in the doctor report (`report.js, the year-of-birth line`). Nothing else consults it.

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
(`predict.js, the lateness block`). #58 already drew the window; late now means past the point
where her own observed variation stops explaining it. A new `withinWindow` state
sits between the two — past the estimate, still inside her spread — and Today
calls it *due* rather than late (`today.js dueCard`). On a 26-to-48-day history the
app used to say "late" for most of every month; now it says so only when it is
true. Below two cycles there is no window and the old behaviour stands.

**A long gap is no longer blamed on her records** (`predict.js staleReason`). Staleness
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

The fix is `startWindow()` (`predict.js startWindow`), consumed at `today.js nextPeriodCard`: half
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

`parseImport` accepted one shape: Kittycal's own (`backup.js parseImport`). For anyone
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

`pillTaken` was a boolean (`model.js DayLog.pillTaken`) with a daily nudge attached
(`reminders.js, the pill nudge`) — a tick box with no memory. It could tell her to take one
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

### G6 — Two modes were declared in the data model and neither existed · S4 · **CLOSED**

`mode: 'cycle'|'conceive'|'pregnancy'` was defined at `model.js Settings.mode`, defaulted,
normalised on every settings read, written into every backup file, and read by
nothing. A grep across `js/` returned the declaration, the default, and no
consumer.

**`pregnancy` is gone rather than half-built.** It is a second application —
week-by-week gestation, a different symptom set, different alarms — and
promising it in a data model that ships in every export was the one option that
could not be defended. `normalizeSettings` now also rejects any unrecognised
mode, because exports written while it was still in the union exist and would
otherwise put the app into a mode nothing implements.

**`conceive` reorders Today rather than replacing it.** The cards are the same
cards; what changes is which one answers her question first. Tracking a cycle,
that is the next period. Trying to conceive, it is the fertile window and
whether ovulation has happened — and burying that under a period countdown
means scrolling past the answer every day. No separate screen, no second app,
no extra daily question. The row is hidden on hormonal contraception, where the
fertility output it promotes is correctly hidden anyway.

**The double check is the new part** (`ovulation.js cycleSignals`). Everything
else the app says about ovulation is arithmetic — next period minus luteal
length. This is the opposite: nothing predicted, all of it recorded. It reads
the cycle she is *in*, which `confirmedOvulations` deliberately does not, since
that exists to measure luteal length and needs a next period to measure to.

It reports both signals rather than the winner. A peak test observes the surge;
a thermal shift infers the progesterone rise, and a fever or a bad night can
fake one. Sympto-thermal methods use two because either alone is weaker, so
where both land within two days the card says so, and where they disagree it
says *that* and shows both. Egg-white mucus is displayed and never used to date
anything — it marks the stretch approaching ovulation, not the event.

That last branch was a bug found by running it: with both signals present and
three days apart, the card said "a temperature taken each morning would
corroborate it" directly above the temperature rise it had just listed.

### G7 — No cycle-by-cycle comparison · S4 · **CLOSED**

Insights plotted cycle length as a row of dots (`insights.js cycleLengthCard`), which
answers "are my cycles consistent" and gives no route to "what was that bad one
in March actually like". A dot on a chart is not a thing you can open, and Clue
made Cycle View the centre of its relaunch for exactly this reason.

`cycleListCard` is a comparison rather than a list: each row carries how that
cycle differed from her own average, because "31 days" means nothing alone and
"three days longer than usual" is the sentence she is looking for. Nothing is
printed in that column for a cycle within a day of average — a sign on every
row would make a normal month look like a finding. The running cycle is
included and marked, since "where am I against the last few" is the same
question asked about now.

Tapping one opens what she logged in it: counts rather than a day-by-day dump,
since the diary already shows any single day and thirty of those in a sheet is
not something anyone reads. Moods stay separate from physical symptoms for the
same reason the doctor report separates them.

### G8 — No duress PIN · S4 · **NOT BUILT, on purpose**

Euki ships one: a second PIN that opens a false screen. Kittycal's lock is
already reasoning in the same threat model — `lock.js, the no-lockout note` deliberately has no
lockout after N failed attempts, because the threat is a person physically
holding the phone, and that is the argument that leads to a decoy.

Everything else in this document is now built. This one is not, and the reason
is specific rather than a shortage of time.

**What the implementation would be.** `DB_NAME` in `db.js` is a single constant
and every read goes through `db.open()`, so a second profile is a contained
change: two databases, two PINs, one opening each. The lock config, though,
lives in the meta store *inside* that database — so the main database must be
opened to check any PIN at all, including the decoy's. The decoy therefore
cannot hide that the real profile exists. It defends against someone watching
the screen; it does nothing against anyone who opens the browser's storage
inspector.

**Why that is a reason to stop rather than to ship it carefully worded.** A
narrow guarantee is fine — the passcode's is narrow too, and `lock.js` says so.
The problem is the failure mode. A lock that is weaker than believed loses
privacy. A decoy that is weaker than believed is *handed over*: it is used at
the moment someone is standing over her, and its whole value is her confidence
that the screen she is showing is all there is. If that confidence is wrong,
the feature has put her in a worse position than owning no decoy at all, which
is the one outcome none of the other seven gaps can produce.

That is a judgement about someone's safety rather than about code quality, and
it should be made deliberately and on its own, not as the seventh item in a
batch. The design above is ready; what it needs is a decision about what the
app is willing to promise, and a pass of its own to build against it.

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
~~**G1** — the lateness model.~~
~~**G3 + G4** — import and CSV export.~~
~~**G5** — the pill pack.~~
~~**G6** — `conceive` mode, and `pregnancy` deleted.~~
~~**G7** — cycle by cycle.~~

**G8** — the duress PIN — is the only item left, and §G8 argues it should be a
decision before it is a commit.

Nothing built here required a network request, an account, or a subscription.
That constraint did not cost a single feature on this list: the two things
Kittycal genuinely cannot do — background push and live wearable sync — are in
§4, and both are limits of the browser rather than of the design.
