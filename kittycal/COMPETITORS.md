# Kittycal against the field

A competitive audit. `AUDIT.md` asks whether the app does what it says correctly;
this asks whether what it says is the right list, measured against the apps
people actually use.

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
  screen next to every forecast, never hidden (`today.js:733`). Fertile windows
  widen instead of narrowing when the data is thin (`predict.js:290`). Fertility
  output disappears entirely on hormonal contraception (`predict.js:276`), which
  is correct and which Flo does not do. Past 90 days the app says the history
  has gone stale rather than inventing "402 days late" (`predict.js:65`).
- **It scores its own past predictions.** The "How close Kittycal has been" card
  (`insights.js:343`) re-forecasts each past cycle from only what was known
  before it started and reports the typical miss in days. No major competitor
  shows you its own error.
- **Luteal length is measured, not assumed.** `ovulation.js` derives it from her
  own confirmed thermal shifts and falls back to the population 14 only when it
  can't (`predict.js:209`). A fixed 14 is a permanent two-day error in the one
  number offered for planning.
- **The doctor report is free.** Flo paywalls the equivalent at $49.99/year;
  Apple gives you a 12-month PDF only. Kittycal's is six months of plain tables,
  and it separates moods from physical symptoms so a clinician doesn't read
  "Happy — 3 of 3 cycles" as a presenting complaint (`taxonomy.js:379`).
- **Accessibility is structural.** Every colour derives from two numbers in
  OKLCH at pinned lightness, so all 14 themes hit the same contrast ratios by
  construction, verified across 196 colour pairs.

## 3. Gaps worth closing

Ranked by what they cost her, not by effort.

### G1 — The lateness model is wrong for anyone in perimenopause · S2

The most serious finding here, because it isn't a missing feature — it's the app
being confidently wrong at a real user.

`birthYear` is asked for during onboarding (`onboarding.js:237`), normalised on
every read, carried in every backup, and used in exactly one place: a line of
text in the doctor report (`report.js:82`). Nothing else consults it.

Meanwhile the prediction engine treats every overdue cycle as lateness with a
day count (`predict.js:270`) and everything past 90 days as stale
(`predict.js:65`). For a 47-year-old whose cycles are lengthening and skipping,
that is the wrong sentence every single month — "17 days late", then "43 days
late", then the data has "gone stale" and she's asked for a fresh period date.
Cycles becoming irregular *is the signal*, and the app reads it as failure to
log.

Both leaders fixed exactly this. Clue's perimenopause mode replaced "your period
is X days late" with a cycle-comparison view. Flo's shows a window of time
rather than a date, for the same reason.

**Verdict: build, and it does not need a new mode.** When cycle spread is high
and `birthYear` implies mid-40s or older, change the framing from lateness to
variation. The taxonomy already has hot flushes and night sweats
(`taxonomy.js:106-107`); it's missing vaginal dryness and HRT. The 90-day
staleness cutoff should not fire on someone whose logged history is dense and
whose cycles are simply long — those are distinguishable states, and the code
currently conflates them.

### G2 — The next-period date is a point estimate wearing a range's clothing · S2

The Next period card shows `12 Aug – 16 Aug` as its headline number
(`today.js:715`). That range is the predicted *bleed span* — start plus average
period length — and the hint underneath says "Estimated 5-day period". At a
glance, on the screen people look at most, it reads as "it'll start somewhere in
here". It doesn't. The start date carries no interval at all.

The app already computes the number needed. `stats.spread` — the range between
her shortest and longest cycle — is calculated on every prediction and used only
to pick a regularity word and gate the confidence tier (`predict.js:329`).
Someone with a 9-day spread is being shown a single start date with no hint that
next month could land four days either side.

This is the app's own honesty rule — "every number, label and tense matches what
the data supports" — unmet in the most prominent place it appears.

**Verdict: build. Highest value per line of code in this document.** Show the
start-date interval from the spread already in hand: *"Expected Tue 12 Aug —
most likely 10–14 Aug."* No new data, no new storage, no new daily friction.

### G3 — Nothing can get in except Kittycal's own export · S3

`parseImport` accepts one shape: Kittycal's own (`backup.js:112`). For anyone
with three years of history in Flo or Clue, the cost of switching is retyping it
or losing it — and losing it is what actually happens.

This is the largest adoption barrier in the document and it has nothing to do
with features. Clue exports CSV. Parsing a CSV is local file reading; it costs
nothing in the privacy model, needs no network, and doesn't touch the CSP.

**Verdict: build.** An importer for Clue's CSV export, and a tolerant
date+flow CSV path for everything else. It should report what it understood and
what it skipped rather than silently dropping rows — the existing importer's
sanitise-don't-swallow discipline already sets that standard.

### G4 — Export is JSON only · S3

One `Blob`, `application/json` (`backup.js:171`). It's complete and readable,
and nobody can do anything with it. A spreadsheet can't open it, a doctor can't
read it, a researcher can't load it. The print report covers the
hand-to-a-clinician case, so CSV is the real hole: her own data, in the format
that every tool on earth accepts.

**Verdict: build.** Two files — one row per logged day, one row per cycle.
Small, and squarely rule 4: data that goes in and can't come out is data that
wasn't worth collecting.

### G5 — Birth control tracking is a checkbox · S3

`pillTaken` is a boolean (`model.js:35`) with a daily nudge attached
(`reminders.js:190`). There's no pack: no 21/7, no 24/4, no continuous regimen,
no placebo week, and no "you didn't log yesterday" — which is the single moment
a pill tracker justifies existing. Clue markets contraception tracking as a
headline feature; Kittycal already knows the method from `BIRTH_CONTROL`
(`model.js:78`) and does nothing with it.

**Verdict: build the pack, and be honest about the reminder.** A regimen with a
visible day-in-pack position is real value. But this is also where the
no-server design hurts most, and the settings copy should say so here
specifically rather than only in general: a contraception reminder that fires
when you next open the app is not a contraception reminder.

### G6 — Two modes are declared in the data model and neither exists · S4

`mode: 'cycle'|'conceive'|'pregnancy'` is defined at `model.js:45`, defaulted at
`model.js:96`, normalised on every settings read, and written into every backup
file. It is read by nothing. A grep across `js/` returns the declaration and the
default and no consumer.

Trying-to-conceive is the largest feature axis in the market — Flo, Ovia, Glow
and Premom all organise around it — and Kittycal is closer to it than the empty
field suggests. It already logs ovulation tests (`taxonomy.js:213`), charts BBT
with thermal-shift detection, records egg-white discharge and unprotected sex,
and bands conception chance into tiers rather than fake percentages
(`predict.js:395`). What's missing is arrangement, not data: a mode that puts
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

1. **G2** — the prediction interval. Cheapest, most visible, fixes an honesty
   gap in the app's most-read card.
2. **G1** — perimenopause framing. Highest severity; the app is currently wrong
   at a real cohort using data it already collects.
3. **G3 + G4** — import and CSV export together, since they're the same seam.
4. **G5** — the pill pack.
5. **G6** — `conceive` mode, or delete the field.
6. **G7**, then **G8** on its own.

Nothing above requires a network request, an account, or a subscription. That
constraint has not cost Kittycal a single feature on this list — the two things
it genuinely cannot do (background push, live wearable sync) are in §4, and both
are limits of the browser rather than of the design.
