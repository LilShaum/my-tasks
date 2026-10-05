# Kittycal: what it is for, and the gate every feature passes

`AUDIT.md` asks whether the app is **correct**. `COMPETITORS.md` asks whether
it is **missing** something. Neither asks whether what is on screen **earns its
place**, and that gap let redundant and decorative features ship: a sticker book
nobody wanted, a "typical month" bar that repeated the ring, five cards on one
Today screen saying the same thing about the days before a period. This file
closes that gap. Read it before designing or building anything.

## 1. It is a tool

Kittycal is a period tracker first. Cute is how it feels, not what it does.
A feature is worth having only if it makes one of the jobs below easier.

### Her jobs, in order of how much people rely on them

Evidence: a 2024 mixed-methods study of 692 women
([Ahn et al., JMIR, doi:10.2196/53146](https://doi.org/10.2196/53146)): 85% use
a tracker to predict the next period, 54% to keep a record, 54% to plan their
schedule; the most used features are the prediction, the record, a next-period
alert and the fertile window. People stop using trackers because predictions
are wrong for irregular cycles and because logging takes time.

| # | Job | Her question | Its home |
|---|---|---|---|
| H1 | Know when her period is coming, and how sure the app is | "When is it, and can I trust that?" | Today (ring + Next period card) |
| H2 | Plan around her cycle | "What about the weekend of the 18th?" | Calendar |
| H3 | Log fast | "Done in 15 seconds" | Check-in |
| H4 | Know what is coming for her body | "Is the bloating about to start?" | Today ("Coming up for you") |
| H5 | Understand what is normal for her | "Is this normal for me? Is it changing?" | Insights |
| H6 | Show a doctor | "What do I bring to the appointment?" | Report |
| H7 | Fertility, if she wants it | "Am I in my fertile window?" | Today (fertile card), Calendar |

### His jobs (partner mode)

| # | Job | His question | Its home |
|---|---|---|---|
| P1 | Not be caught off guard | "When is her period?" | Today ring, Calendar, heads-ups |
| P2 | Plan dates and trips | "Is the 18th a good weekend?" | Calendar (and its day detail) |
| P3 | Understand what she may be feeling, and why | "Why is this week harder?" | Today ("Likely today"), Rhythm |
| P4 | Know what she needs right now | "What can I do today?" | Her status, one tip under it |

## 2. One question, one home

Every question above has exactly one screen that answers it in full. Other
screens may *point* to it in a line, never answer it again in a second card.
Two answers drift apart, double the scrolling, and make the app feel padded.

- Today: where she is, when the period is, what is coming in the next days, log.
- Calendar: dates, past and future; edit periods; any day's detail.
- Insights (his: Rhythm): what is normal for her across cycles, and what changes.
- Settings: configuration only.

## 3. The gate

Answer these in writing, in the PR description, **before writing code**. If an
answer is weak, the feature is not built. This applies to new features and to
redesigns of old ones.

1. **Job.** Which job above does it serve? Write the user's question in her
   (or his) words. "It would be cool" is not a job.
2. **Home.** Where else in the app is that question already answered? If
   anywhere: improve that place, or merge into it. Never add a second answer.
3. **Evidence.** What do two or more leading apps do here, and what do their
   users say? What is our better version? (`COMPETITORS.md` has the field.)
4. **Insight test** (anything showing data). Does it tell her something she
   could not see by glancing at the calendar? Would it change a decision she
   makes? A number shown because it can be computed fails.
5. **Argue against it.** What does it push down the screen? What daily
   friction does it add? Can it lie (thin data, unlogged days, a late period)?
   If the case against is stronger, stop.
6. **States.** What does it show for a brand-new user, for someone with old
   periods entered from memory and few logs, for irregular cycles, a late
   period, hormonal birth control, and a partner she shares little with?
7. **Glance test.** Can someone say what it shows in three seconds, without
   help text? Every colour, mark and dot is named on screen.
8. **Removal test** (after building, on real screenshots). Would she miss it
   if it were gone tomorrow? If not, remove it.

## 4. Reviewing screenshots

Visual bugs are half of it. For every screen, with populated data and a
brand-new user, list each element and write next to it: the job it serves,
whether another element on this or another screen already answers it, and
the removal test. Anything that fails is a finding, not a matter of taste.

## 5. Working rules that came from mistakes

- When pushed for speed, cut scope, never the gate.
- Research before redesigning: how do the best apps do it, and what do their
  users complain about.
- Show the person the plan for anything bigger than a fix; build after.
- "Tests pass" means correct, not useful. Both are required.

## 6. Usefulness audit, October 2026

Run against the live app with three fixture users: a long-time logger (seven
cycles of check-ins), a realistic one (four periods entered from memory, two
cycles of check-ins, which is how most people start), and a brand-new one.
Each finding names the gate question it fails.

### Fixed

| # | Where | Finding | Gate |
|---|---|---|---|
| U1 | Insights, every chart | Cycles with no logs (periods entered at setup) counted as cycles in which nothing happened, so real patterns stayed hidden for months. | 5 (it lied) |
| U2 | Insights, period chart | Days with no flow logged were drawn as "medium", inventing bleeding she never recorded. | 5 |
| U3 | Partner Rhythm | The "her month" bar repeated the ring and the calendar. | 2, 8 |
| U4 | Partner Rhythm | Four number tiles; "5 days of period" repeated the Period row, "28 days per cycle" repeated the dependability line. Reduced to one statement about how dependable her dates are. | 4 |
| U5 | Partner Rhythm and Calendar | "Coming periods" and "Add to my calendar" lived on both. Dates belong to Calendar. | 2 |
| U6 | Today | The fertile-window card stayed after the window passed, saying "low chance of getting pregnant" every day: no planning value, and it reads as contraception advice the app disclaims. Hidden once passed, outside conceive mode. | 4, 5 |
| U7 | Today | The logged card echoed "you logged bloating around this day last cycle too" while "Coming up for you" already listed bloating. | 2 |
| U8 | Today | The Next period card spent a line on the bleed span, a date range under a date range. | 7 |
| U9 | Insights | "Your recent numbers" repeated sleep (which has its own cycle chart) and water as counters ("about X a day, N days under 1 L"). Weight and steps stay; they have no other readback. | 2, 4 |
| U10 | Calendar | Dots under days had no legend entry. | 7 |
| U11 | Both calendars | "Period expected" on hers, "Period likely" on his. One word for one thing. | 7 |
| U12 | Insights, "At a glance" | "Day 1 is usually your heaviest" was voted by periods where only day 1 was logged, so day 1 won by default. Only fully logged periods vote. | 5 |
| U13 | After the check-in | A pre-period pattern was said twice on Today: in "Coming up for you" and again after the check-in as "most often on day 27, 28 and 29" (or "around this day last cycle too"). Said once, in the form she thinks in. | 2 |

### Open, needs a decision

| # | Where | Finding |
|---|---|---|
| D1 | Settings, Reminders | All five reminders only appear when she opens the app, where Today already says the same thing. In this form they are redundant. A next-period alert is one of the most used tracker features, so the fix is real notifications (the same no-content design his heads-ups use), but that sends the server the times, which changes the "nothing leaves your phone" promise. Hers to decide: real notifications, or remove the section. |

### Checked and kept

- **Insights "At a glance"**: repeats the card titles below, on purpose. It is
  the summary for someone who will not scroll, and each line jumps to its card.
- **Her ring has no colour key; his does.** Her phase line names the current
  phase and she lives with the colours daily. He is learning what the phases
  are, which is one of his jobs (P3).
- **His week strip and Calendar.** The strip answers "this week, at a glance"
  on Today; the calendar answers any other date.
- **Phase guide on Rhythm.** Teaching what each phase does is his job P3, and
  nothing else in his app does it in one place.
