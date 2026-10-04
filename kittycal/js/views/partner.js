// @ts-check
/**
 * partner.js — both ends of partner sharing.
 *
 *   - Her side: `openShareSheet`, reached from Settings. Pick what to share,
 *     write what helps, see exactly what they will see, send the link, stop
 *     whenever she likes.
 *   - His side: `renderPartner` / `openPartnerSheet`, opened from the link.
 *     Where she is, what is coming, what helps, and the next periods for his
 *     own calendar.
 *
 * The same renderer draws his screen and her preview, so the preview cannot
 * drift from what he actually sees.
 */

import { el, replace, haptic, announce } from '../utils/dom.js';
import { todayKey, fmtDayMonth, fmtRelative, fmtLong } from '../utils/date.js';
import { openSheet, closeSheet } from '../ui/sheet.js';
import { confirmSheet } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { emblem } from '../ui/mascot.js';
import { SHARE_ITEMS, partnerModel, icsFor } from '../domain/partner.js';
import { newSecrets, shareLink, getShare, deleteShare } from '../storage/share.js';
import { syncNow, currentSnapshot } from '../state/partner-sync.js';
import * as store from '../state/store.js';

/* ── His side ───────────────────────────────────────────────────────────── */

/**
 * The partner view's content, from a summary.
 *
 * @param {import('../domain/partner.js').Snapshot} snap
 * @param {{preview?: boolean}} [opts]
 */
function partnerContent(snap, { preview = false } = {}) {
  const m = partnerModel(snap, todayKey());
  const token = m.phase ? {
    period: '--period', follicular: '--follicular', fertile: '--ovulation', luteal: '--luteal',
  }[m.phase.id] : '--line-soft';

  return el('div', { class: 'partner' }, [
    el('div', { class: `partner-hero is-${m.status}` }, [
      el('p', { class: 'partner-hero-head', text: m.headline }),
      m.sub ? el('p', { class: 'hint-sm', text: m.sub }) : null,
    ]),

    m.phase ? el('div', { class: 'partner-card partner-phase', style: { '--phase': `var(${token})` } }, [
      el('h3', {}, [
        el('span', { class: 'phase-dot', style: { background: `var(${token})` }, 'aria-hidden': 'true' }),
        m.phase.title,
      ]),
      el('p', { text: m.phase.text }),
    ]) : null,

    m.patterns.length || m.mood ? el('div', { class: 'partner-card' }, [
      el('h3', { text: 'What usually comes before her period' }),
      el('ul', { class: 'partner-list' }, [
        ...m.patterns.map((p) => el('li', {}, [
          el('span', { text: `${p.label}: usually from about ${p.before} ${p.before === 1 ? 'day' : 'days'} before` }),
          p.now ? el('span', { class: 'partner-now', text: 'About now' }) : null,
        ])),
        m.mood ? el('li', { text: m.mood }) : null,
      ]),
    ]) : null,

    m.helps ? el('div', { class: 'partner-card partner-helps' }, [
      el('h3', { text: 'What helps' }),
      el('p', { class: 'partner-quote', text: m.helps }),
    ]) : null,

    m.upcoming.length ? el('div', { class: 'partner-card' }, [
      el('h3', { text: 'Next periods (expected)' }),
      el('ul', { class: 'partner-list' }, m.upcoming.map((p) =>
        el('li', { text: `${fmtDayMonth(p.start)} to ${fmtDayMonth(p.end)}` }))),
      preview ? null : el('button', {
        type: 'button', class: 'btn btn-secondary partner-ics',
        onclick: () => {
          haptic();
          const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
          const url = URL.createObjectURL(new Blob([icsFor(m, stamp)], { type: 'text/calendar' }));
          const a = el('a', { href: url, download: 'kittycal-periods.ics' });
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        },
      }, ['Add to my calendar']),
    ]) : null,
  ]);
}

/**
 * Fetch the latest summary for the share on this phone, and remember it.
 * @returns {Promise<'ok'|'gone'|'offline'>}
 */
async function refresh() {
  const of = store.getState().settings.partnerOf;
  if (!of) return 'offline';
  try {
    const got = await getShare(of);
    if (!got) {
      store.updateSettings({ partnerOf: { ...of, gone: true } });
      return 'gone';
    }
    store.updateSettings({ partnerOf: { ...of, snapshot: got.snapshot, fetchedAt: Date.now(), gone: false } });
    return 'ok';
  } catch {
    return 'offline';
  }
}

/**
 * His view, drawn into `host`, refreshing as it opens.
 *
 * @param {HTMLElement} host
 * @param {{onSetUp?: () => void}} [opts]  offered when this phone does not track a cycle of its own
 */
export function renderPartner(host, { onSetUp } = {}) {
  const draw = (/** @type {'ok'|'gone'|'offline'|'loading'} */ state) => {
    const { settings } = store.getState();
    const of = settings.partnerOf;
    if (!of) { replace(host, []); return; }
    const snap = of.snapshot;
    const who = snap?.name || 'Your partner';

    replace(host, [
      el('div', { class: 'partner-head' }, [
        emblem(settings.theme, { size: 56, className: 'partner-emblem' }),
        el('h2', { class: 'partner-title', text: snap?.name ? `${snap.name}’s cycle` : 'Your partner’s cycle' }),
      ]),

      of.gone ? el('div', { class: 'partner-card' }, [
        el('p', { text: `${who} has stopped sharing.` }),
        el('button', {
          type: 'button', class: 'btn btn-secondary',
          onclick: () => { haptic(); store.updateSettings({ partnerOf: null }); },
        }, ['Remove from this phone']),
      ])
        : snap ? partnerContent(snap)
          : el('div', { class: 'partner-card' }, [
              el('p', { text: state === 'loading' ? 'Loading…'
                : 'Couldn’t load it. Check your connection and try again.' }),
            ]),

      el('p', { class: 'hint-sm partner-foot', text: of.gone ? ''
        : `${state === 'offline' && snap ? 'Couldn’t refresh, so this is the last copy. ' : ''}`
          + `${of.fetchedAt ? `Checked ${fmtRelative(todayKeyOf(of.fetchedAt)).toLowerCase()}. ` : ''}`
          + `You only see what ${snap?.name || 'she'} chose to share.` }),

      el('div', { class: 'partner-actions' }, [
        of.gone ? null : el('button', {
          type: 'button', class: 'btn-link',
          onclick: async () => { haptic(); draw('loading'); draw(await refresh()); },
        }, ['Refresh']),
        onSetUp ? el('button', {
          type: 'button', class: 'btn-link',
          onclick: () => { haptic(); onSetUp(); },
        }, ['Track my own cycle too']) : null,
      ]),
    ]);
  };

  draw(store.getState().settings.partnerOf?.snapshot ? 'ok' : 'loading');
  void refresh().then(draw);
}

/** @param {number} ms */
function todayKeyOf(ms) {
  const d = new Date(ms);
  return /** @type {import('../utils/date.js').DateKey} */ (
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}

/** His view in a sheet, for a phone that also tracks its own cycle. */
export function openPartnerSheet() {
  const host = el('div', {});
  openSheet({ title: 'Partner view', body: [host] });
  renderPartner(host);
}

/**
 * Take a share link that opened this app, if there is one.
 * @param {{id: string, key: string}} link
 */
export function adoptShareLink(link) {
  const current = store.getState().settings.partnerOf;
  if (current && current.id === link.id) return;
  store.updateSettings({ partnerOf: { id: link.id, key: link.key, snapshot: null, fetchedAt: 0, gone: false } });
  announce('Partner view added');
}

/* ── Her side ───────────────────────────────────────────────────────────── */

/**
 * Settings → Share with your partner.
 */
export function openShareSheet() {
  const host = el('div', { class: 'share-sheet' });
  openSheet({ title: 'Share with your partner', body: [host] });

  /** Unsaved choices while setting up; saved choices once sharing. */
  const draft = (() => {
    const s = store.getState().settings.partnerShare;
    return {
      choices: s ? { ...s.choices } : Object.fromEntries(SHARE_ITEMS.map((i) => [i.id, i.default])),
      helps: s?.helps ?? '',
    };
  })();

  const save = () => {
    const s = store.getState().settings.partnerShare;
    if (s) store.updateSettings({ partnerShare: { ...s, choices: /** @type {any} */ (draft.choices), helps: draft.helps } });
  };

  // Exactly what they would see with the choices on screen, sent or not.
  const preview = () => {
    const snap = currentSnapshot({ choices: /** @type {any} */ (draft.choices), helps: draft.helps });
    return snap ? partnerContent(snap, { preview: true }) : null;
  };

  const sendLink = async () => {
    const s = store.getState().settings.partnerShare;
    if (!s) return;
    const link = shareLink(s);
    haptic();
    try {
      if (navigator.share) {
        await navigator.share({ title: 'My Kittycal', text: 'Here’s when my period’s coming and what helps:', url: link });
        return;
      }
    } catch { /* cancelled, or not allowed: fall through to copying */ }
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copied');
    } catch {
      toast('Copy the link from the box above');
    }
  };

  const draw = () => {
    const s = store.getState().settings.partnerShare;
    const toggles = SHARE_ITEMS.map((item) => {
      const on = Boolean(/** @type {any} */ (draft.choices)[item.id]);
      const button = el('button', {
        type: 'button', class: 'toggle', role: 'switch',
        'aria-checked': String(on), 'aria-label': item.label,
        onclick: () => {
          haptic(8);
          /** @type {any} */ (draft.choices)[item.id] = !on;
          save();
          draw();
        },
      });
      return el('div', { class: 'row' }, [
        el('span', { class: 'row-label' }, [item.label, el('span', { class: 'choice-sub', text: item.sub })]),
        button,
      ]);
    });

    const helps = draft.choices.helps ? el('label', { class: 'share-helps' }, [
      el('span', { class: 'row-label', text: 'What helps you' }),
      el('textarea', {
        class: 'input', rows: 3, maxlength: 600,
        placeholder: 'A heat pad, chocolate, a quiet night in…',
        value: draft.helps,
        oninput: (/** @type {Event} */ e) => { draft.helps = /** @type {HTMLTextAreaElement} */ (e.target).value; },
        onchange: () => save(),
      }),
    ]) : null;

    replace(host, [
      el('p', { class: 'hint', text: s
        ? `Sharing since ${fmtLong(/** @type {any} */ (s.since))}. `
          + (s.sentAt ? `Last updated ${fmtRelative(todayKeyOf(s.sentAt)).toLowerCase()}.` : 'Not sent yet: it will go when you’re online.')
        : 'Send your partner a link so they can see when your period’s coming and what helps. '
          + 'They only see what you pick, and you can stop anytime.' }),

      el('div', { class: 'rows' }, [
        el('div', { class: 'row' }, [
          el('span', { class: 'row-label' }, ['When your period’s coming',
            el('span', { class: 'choice-sub', text: 'Always shared: it’s what this is for' })]),
        ]),
        ...toggles,
      ]),
      helps,

      el('details', { class: 'insight-more share-preview' }, [
        el('summary', { text: 'Preview what they’ll see' }),
        preview(),
      ]),

      el('p', { class: 'hint-sm', text:
        'Never shared: your daily logs, notes, tests, sex, or a late period. Your summary is '
        + 'encrypted on your phone before it’s stored, but anyone with the link can see it, '
        + 'so only send it to them.' }),

      s ? el('div', { class: 'share-link' }, [
        el('input', { class: 'input', readonly: true, value: shareLink(s), 'aria-label': 'Your share link',
          onfocus: (/** @type {Event} */ e) => /** @type {HTMLInputElement} */ (e.target).select() }),
      ]) : null,

      el('div', { class: 'dialog-actions' }, s ? [
        el('button', { type: 'button', class: 'btn btn-block btn-lg', onclick: () => { void sendLink(); } },
          ['Send the link']),
        el('button', {
          type: 'button', class: 'btn btn-ghost btn-block',
          onclick: async () => {
            haptic();
            const yes = await confirmSheet({
              title: 'Stop sharing?',
              body: ['Their view goes blank straight away. You can share again later with a new link.'],
              confirmLabel: 'Stop sharing',
              danger: true,
            });
            if (!yes) { openShareSheet(); return; }
            try {
              await deleteShare(s);
            } catch {
              toast('Couldn’t reach the server. Try again when you’re online.');
              return;
            }
            store.updateSettings({ partnerShare: null });
            toast('Sharing stopped');
          },
        }, ['Stop sharing']),
      ] : [
        el('button', {
          type: 'button', class: 'btn btn-block btn-lg',
          onclick: async (/** @type {Event} */ e) => {
            haptic();
            const btn = /** @type {HTMLButtonElement} */ (e.currentTarget);
            btn.disabled = true;
            const secrets = newSecrets();
            store.updateSettings({ partnerShare: {
              ...secrets, choices: /** @type {any} */ (draft.choices), helps: draft.helps,
              since: todayKey(), sentHash: '', sentAt: 0,
            } });
            const ok = await syncNow({ force: true });
            if (!ok) {
              store.updateSettings({ partnerShare: null });
              btn.disabled = false;
              toast('Couldn’t reach the server. Try again when you’re online.');
              return;
            }
            draw();
            void sendLink();
          },
        }, ['Create the link']),
      ]),
    ]);
  };

  draw();
}
