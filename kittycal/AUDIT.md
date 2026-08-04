# Kittycal — full-stack audit

## 0. What counts as an improvement

Written first, because without it "improvement" collapses into "change I felt
like making", and this app has already had one change reverted for exactly that
reason.

**A change is an improvement only if it makes at least one of these true, and
none of them worse:**

| Rank | Property | Test |
|---|---|---|
| 1 | **Her data survives** | Could this change lose, corrupt, or silently drop something she recorded? Anything that reduces that risk is the highest-value change available. |
| 2 | **The app doesn't lie** | Every number, label and tense matches what the data supports. A prediction that hides its uncertainty, a chart that overstates a difference, a "pattern" from two coincidences — all defects of the same kind. |
| 3 | **The daily loop stays cheap** | Fifteen seconds, three taps. Any change that adds a tap, a question, or a decision to the everyday path must buy more than it costs. |
| 4 | **She can find and understand what she recorded** | Data that goes in and can't come out is data that wasn't worth collecting. |
| 5 | **It works for her specifically** | One-handed, on a phone, sometimes in pain, sometimes with reduced motion or a screen reader, sometimes offline, sometimes handing the screen to a doctor. |
| 6 | **It's nice enough to keep opening** | Real, but ranked last on purpose — charm that costs clarity is a downgrade. |

**Explicitly not improvements**, however tempting:

- Restyling to my own taste with no defect behind it.
- Features that add daily friction for a benefit she'd get monthly.
- Anything that makes the app claim more certainty than the arithmetic supports.
- Refactors with no behavioural payoff, in a codebase this size.
- Test churn that doesn't pin a real invariant.
- More words. The copy has already been cut 64% once.

**Severity scale used below**

- **S1** — data loss, corruption, or a false statement to a user about her health data.
- **S2** — a feature that doesn't work, or works wrongly, in a plausible real state.
- **S3** — friction, confusion, or an accessibility barrier in a path she'll hit.
- **S4** — polish, code health, latent risk.

---

## 1. Audit plan

Fourteen levels. Each names the *method*, because "look at the code" is not a
plan.

### L1 — Storage and the write path
- Schema/migration: what happens to a v1 record read by a later build.
- Quota exhaustion: behaviour when IndexedDB refuses a write.
- Concurrency: two tabs, or a write during a write.
- Blob store: mascot images, orphan cleanup, object-URL leaks.
- Erase: does "erase all my data" actually leave nothing.
- *Method*: read `db.js`/`repo.js`/`store.js`; browser probes that force failures.

### L2 — Backup and restore
- Round-trip fidelity for every field (severity was nearly missed once).
- Import of: a truncated file, a foreign JSON, a newer schema, an empty file.
- Merge semantics: does import replace or merge, and does the UI say which.
- *Method*: unit tests over `backup.js` + a browser round trip.

### L3 — Domain arithmetic
- `cycles`: sparse period days, one-day gaps, overlapping marks, ordering.
- `predict`: cold start, recalibration, clamping, delay, hormonal suppression.
- `phases`: boundaries, unknown states.
- `stats`: complete-vs-running cycle handling, division by zero, tie-breaking.
- `acog`: thresholds match the cited source.
- Date arithmetic: DST, month ends, leap day, year boundary.
- *Method*: read each module; add unit tests for every boundary found untested.

### L4 — Prediction honesty
- Does every prediction surface its own confidence.
- Is uncertainty widened where the data is thin.
- Is anything asserted from fewer cycles than the stated thresholds.
- *Method*: cross-read `predict.js` against what the views print.

### L5 — State and rendering
- Write path failure/rollback (hardened once — re-verify).
- Subscription leaks, double renders, stale closures.
- Re-render cost under a realistic and an extreme history.
- *Method*: read `store.js`/`main.js`; measure with 3 years of data.

### L6 — The daily loop
- Every state of Today: no cycles, cold start, mid-cycle, late, very late,
  amenorrhoea, hormonal contraception, future dates.
- Check-in: skip, resume, backfill, double-tap, failure-to-save.
- *Method*: browser matrix over seeded states.

### L7 — Every other screen
- Calendar (month/year, edit mode, keyboard grid), Diary, Insights, Report,
  Settings, Help, Notes, Lock.
- *Method*: browser walk with an audit harness per screen.

### L8 — Accessibility
- Heading order, landmarks, focus management in sheets, focus return on close,
  keyboard reachability of every action, `aria-live` correctness, target sizes,
  reduced motion, contrast (already scripted).
- *Method*: scripted DOM audit per screen + manual keyboard walk.

### L9 — Visual design
- Hierarchy, background/content competition, card monotony, type scale,
  phase-colour usage, dark mode parity.
- *Method*: screenshot review across themes and both modes.

### L10 — Copy
- Necessary, concise, consistent voice, no duplication between screens,
  no medical overreach.
- *Method*: extract every user-facing string; read as a set.

### L11 — PWA, offline, updates
- Precache completeness (a module missing from the list breaks offline).
- Update path: does a new deploy actually take over.
- Offline behaviour of every screen.
- *Method*: diff the precache list against real imports; probe an update.

### L12 — Privacy and lock
- The zero-network claim (already scripted) including the SW and fonts.
- PIN: derivation, storage, brute-force resistance, what unlocks it.
- What leaks to the OS: page title, notification text, screenshots.
- *Method*: read `lock.js`; network test; read reminder payloads.

### L13 — Failure modes
- Every `catch`: does it recover, report, or swallow.
- What the user sees when something fails.
- *Method*: grep every catch/rejection path and trace to a user-visible outcome.

### L14 — Code health and the tests themselves
- Dead exports, unused CSS, duplication, type coverage.
- Do the tests pin real invariants or just re-state the implementation.
- *Method*: scripted dead-code and unused-selector sweeps.

---

## 2. Findings

### Defects found

All seven are fixed; the table is kept as the record of what was wrong and why.

| # | Sev | Level | Finding |
|---|-----|-------|---------|
| 1 | **S2** | L4/L7 | A period day marked in the **future** is accepted by the calendar and makes Today contradict itself: "Day −29", "58 days to your period", and "Not enough data yet" all on one screen. Two taps from the calendar. `predict()` derives `cycleDay = daysBetween(lastStart, today) + 1`, and the staleness guard only catches values that are too *large*. |
| 2 | **S3** | L8 | The bottom sheet is **not a modal**. 14 controls behind an open sheet stay tabbable and in the accessibility tree. `sheet.js`'s own docstring says focus "is trapped there" — there is no trap. |
| 3 | **S3** | L8 | **Focus is not returned** when a sheet closes; it lands on `<body>`. The restore guard (`document.contains(opener)`) is right, but the opener node is detached by the view re-render that happens while the sheet is open, so the restore silently does nothing. |
| 4 | **S4** | L10/L14 | The check-in **hardcodes flow labels** ("No bleeding", "Light", …) that already exist in `taxonomy.js`. Renaming a level there leaves the app's most-used screen silently disagreeing with the rest of the app. |
| 5 | **S4** | L2 | `parseImport` shape-checks dates with `/^\d{4}-\d{2}-\d{2}$/`, so `2026-13-45` is accepted and rolls over to a phantom date. |
| 6 | **S4** | L14 | Dead code: `categoryOf` never called; 7 functions exported but used only inside their own module; **17 CSS classes with no referent** — leftovers of the confidence banner, the ring legend and a quick-log block removed in earlier passes. |
| 7 | **S4** | L13 | Two `.catch(() => {})` in Settings: a reminder toggle can silently show the wrong state, and the whole passcode section can silently fail to render. |

### Checked and sound — recorded so it is not re-audited

- **Date arithmetic**: 1,464 consecutive days, every step measures exactly one day, in `Europe/London`, `America/New_York`, `Australia/Sydney` and `Pacific/Chatham` (+12:45). Leap day, month ends, year boundaries and all four DST transitions correct. Backwards ranges return empty rather than hanging.
- **Backup importer**: 20 malformed inputs — truncated, foreign, wrong types, prototype-pollution attempt, 20k entries, 200-deep nesting. Zero crashes, no pollution, junk sanitised rather than swallowed.
- **Performance**: 10 years / 3,640 logs / 650 period days → boot 730 ms, Today 36 ms, Insights 168 ms. No virtualisation needed.
- **Structure/a11y**: heading order, single h1, landmarks, live region, image alt text all clean on Today, Calendar, Insights, Settings. Escape closes sheets.
- **PWA**: precache list complete, no stale entries, every stylesheet linked; update path does `skipWaiting` + `clients.claim` + old-cache purge + a reload guarded against mid-edit.
- **Lock**: PBKDF2-SHA-256, 210,000 iterations, 16-byte random salt, PIN never stored.
- **CSP**: no `unsafe-eval` — it blocked my own test harness, which is the correct outcome.
- **Copy**: 2,058 words total; no instructing, minimising, apologising or diagnostic language.
