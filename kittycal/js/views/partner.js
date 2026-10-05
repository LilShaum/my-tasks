// @ts-check
/**
 * partner.js — her side of sharing.
 *
 *   - `openShareSheet`, from Settings: pick what to share, get a code, see
 *     exactly what their app will show, stop whenever she likes.
 *   - `statusRow`, on her Today while she shares: tell them how she is in one
 *     tap. Nothing to type, nothing to keep up; it clears itself by the next
 *     morning.
 *   - `switchToPartnerMode`, for a phone that should follow someone else's
 *     cycle instead of tracking its own.
 *
 * His side is views/partner-app.js. The preview here draws his Today with the
 * same renderer, so it cannot drift from what he actually sees.
 */

import { el, replace, haptic } from '../utils/dom.js';
import { todayKey, fmtRelative, fmtLong } from '../utils/date.js';
import { openSheet } from '../ui/sheet.js';
import { confirmSheet } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { momentIcon } from '../ui/mascot.js';
import { SHARE_ITEMS, defaultChoices, STATUS_HOURS } from '../domain/partner.js';
import { STATUSES } from '../data/partner-tips.js';
import { newCodeSecrets, shareLink, deleteShare } from '../storage/share.js';
import { syncNow, currentSnapshot } from '../state/partner-sync.js';
import { partnerToday } from './partner-app.js';
import * as store from '../state/store.js';

/* ── One tap ────────────────────────────────────────────────────────────── */

/**
 * Her status, if she set one recently enough that it still shows on his side.
 * @returns {{id: string, at: number}|null}
 */
function liveStatus() {
  const s = store.getState().settings.partnerShare?.status ?? null;
  return s && Date.now() - s.at < STATUS_HOURS * 3600e3 ? s : null;
}

/**
 * "Let Sam know": six stickers, one tap each. Tapping the one already sent
 * takes it back.
 */
export function statusRow() {
  const share = store.getState().settings.partnerShare;
  if (!share) return null;
  const live = liveStatus();
  const sent = live ? STATUSES.find((s) => s.id === live.id) : null;
  const time = live ? new Date(live.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

  // The one she sent may be past the edge of the strip; bring it into view.
  if (live) {
    requestAnimationFrame(() => {
      const strip = /** @type {HTMLElement|null} */ (document.querySelector('.status-stickers'));
      const on = /** @type {HTMLElement|null} */ (strip?.querySelector('.status-sticker.is-on'));
      if (strip && on) strip.scrollLeft = Math.max(0, on.offsetLeft - strip.clientWidth / 2 + on.clientWidth / 2);
    });
  }

  return el('section', { class: 'status-row', 'aria-label': 'Tell your partner how you are' }, [
    el('p', { class: 'status-row-head' }, [
      el('span', { class: 'status-row-title', text: sent ? `Sent at ${time}: ${sent.label}` : 'Let them know how you are' }),
      sent ? el('button', { type: 'button', class: 'btn-link', onclick: () => { haptic(8); void setStatus(null); } },
        ['Clear']) : null,
    ]),
    el('div', { class: 'status-stickers' }, STATUSES.map((s) => el('button', {
      type: 'button',
      class: `status-sticker${live?.id === s.id ? ' is-on' : ''}`,
      'aria-pressed': String(live?.id === s.id),
      onclick: () => { haptic([8, 20, 8]); void setStatus(live?.id === s.id ? null : s.id); },
    }, [
      momentIcon(s.icon, 'status-sticker-mark'),
      el('span', { class: 'status-sticker-label', text: s.label }),
    ]))),
  ]);
}

/** @param {string|null} id */
async function setStatus(id) {
  const share = store.getState().settings.partnerShare;
  if (!share) return;
  store.updateSettings({ partnerShare: { ...share, status: id ? { id, at: Date.now() } : null } });
  const ok = await syncNow({ force: true });
  const label = id ? STATUSES.find((s) => s.id === id)?.label : null;
  if (!ok) toast('Saved. It’ll send when you’re back online.');
  else if (label) toast(`Sent: ${label}`);
}

/* ── The share sheet ────────────────────────────────────────────────────── */

/**
 * Settings → Share with your partner.
 */
export function openShareSheet() {
  const host = el('div', { class: 'share-sheet' });
  openSheet({ title: 'Share with your partner', body: [host] });

  /** Unsaved choices while setting up; saved choices once sharing. */
  const draft = (() => {
    const s = store.getState().settings.partnerShare;
    return { choices: s ? { ...defaultChoices(), ...s.choices } : defaultChoices(), helps: s?.helps ?? '' };
  })();

  const save = () => {
    const s = store.getState().settings.partnerShare;
    if (s) store.updateSettings({ partnerShare: { ...s, choices: draft.choices, helps: draft.helps } });
  };

  const sendLink = async () => {
    const s = store.getState().settings.partnerShare;
    if (!s) return;
    const link = shareLink(s);
    haptic();
    const text = s.code
      ? `I’m sharing my cycle with you on Kittycal. Open this link, or choose “Following my partner’s cycle” and enter ${s.code}:`
      : 'I’m sharing my cycle with you on Kittycal:';
    try {
      if (navigator.share) { await navigator.share({ title: 'My Kittycal', text, url: link }); return; }
    } catch { /* cancelled, or not allowed: fall through to copying */ }
    try {
      await navigator.clipboard.writeText(`${text} ${link}`);
      toast('Link copied');
    } catch {
      toast('Copy the code from the screen');
    }
  };

  const start = async (/** @type {HTMLButtonElement} */ btn) => {
    btn.disabled = true;
    const secrets = await newCodeSecrets();
    store.updateSettings({ partnerShare: {
      ...secrets, status: null, choices: draft.choices, helps: draft.helps,
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
  };

  /** A share made before codes existed: swap it for one with a code. */
  const upgrade = async () => {
    const old = store.getState().settings.partnerShare;
    if (!old) return;
    const yes = await confirmSheet({
      title: 'Get a code?',
      body: ['Codes are easier to type than links. Their app will need the new code or link once, '
        + 'and the old link stops working.'],
      confirmLabel: 'Get a code',
    });
    if (!yes) { openShareSheet(); return; }
    const secrets = await newCodeSecrets();
    store.updateSettings({ partnerShare: { ...old, ...secrets, sentHash: '', sentAt: 0 } });
    const ok = await syncNow({ force: true });
    if (!ok) {
      store.updateSettings({ partnerShare: old });
      toast('Couldn’t reach the server. Try again when you’re online.');
      return;
    }
    try { await deleteShare(old); } catch { /* the old row ages out on its own */ }
    openShareSheet();
  };

  const draw = () => {
    const s = store.getState().settings.partnerShare;
    const toggles = SHARE_ITEMS.map((item) => {
      const on = Boolean(draft.choices[item.id]);
      return el('div', { class: 'row' }, [
        el('span', { class: 'row-label' }, [item.label, el('span', { class: 'choice-sub', text: item.sub })]),
        el('button', {
          type: 'button', class: 'toggle', role: 'switch', 'aria-checked': String(on), 'aria-label': item.label,
          onclick: () => { haptic(8); draft.choices[item.id] = !on; save(); draw(); },
        }),
      ]);
    });

    replace(host, [
      s ? el('div', { class: 'share-code-card' }, [
        s.code ? el('p', { class: 'share-code-label', text: 'Their code' }) : null,
        s.code ? el('button', {
          type: 'button', class: 'share-code num', 'aria-label': `Code ${s.code}. Tap to copy`,
          onclick: async () => {
            haptic();
            try { await navigator.clipboard.writeText(s.code); toast('Code copied'); } catch { /* shown on screen */ }
          },
        }, [s.code]) : null,
        el('p', { class: 'hint-sm', text: s.code
          ? 'In their Kittycal they choose “Following my partner’s cycle” and enter this. Or send the link.'
          : 'Shared with a link.' }),
        el('button', { type: 'button', class: 'btn btn-block', onclick: () => { void sendLink(); } }, ['Send the link']),
        s.code ? null : el('button', { type: 'button', class: 'btn btn-ghost btn-block',
          onclick: () => { haptic(); void upgrade(); } }, ['Get a code instead']),
        el('p', { class: 'hint-sm', text: `Sharing since ${fmtLong(/** @type {any} */ (s.since))}. `
          + (s.sentAt ? `Updated ${fmtRelative(keyOf(s.sentAt)).toLowerCase()}.` : 'It sends when you’re online.') }),
      ]) : el('p', { class: 'hint', text:
        'Your partner gets their own Kittycal view: where you are in your cycle, what’s likely each day '
        + 'from your own patterns, and how they can help. They only see what you pick.' }),

      el('h3', { class: 'section-label', text: 'What they see' }),
      el('div', { class: 'rows' }, [
        el('div', { class: 'row' }, [
          el('span', { class: 'row-label' }, ['When your period’s coming',
            el('span', { class: 'choice-sub', text: 'Always shared: it’s what this is for' })]),
        ]),
        ...toggles,
      ]),

      el('details', { class: 'insight-more share-note', open: draft.helps ? true : null }, [
        el('summary', { text: draft.helps ? 'Your note for them' : 'Add a note for them (optional)' }),
        el('textarea', {
          class: 'input', rows: 2, maxlength: 600,
          placeholder: 'Anything you’d like them to know, like what helps',
          value: draft.helps,
          oninput: (/** @type {Event} */ e) => { draft.helps = /** @type {HTMLTextAreaElement} */ (e.target).value; },
          onchange: () => save(),
        }),
      ]),

      el('button', {
        type: 'button', class: 'btn btn-secondary btn-block',
        onclick: () => { haptic(); openPreview(draft); },
      }, ['See what their app shows']),

      el('p', { class: 'hint-sm', text:
        'Never shared: your daily logs, notes, tests, sex, or a late period. What you share is '
        + 'encrypted on your phone first; only someone with the code can open it.' }),

      el('div', { class: 'dialog-actions' }, s ? [
        el('button', {
          type: 'button', class: 'btn btn-ghost btn-block',
          onclick: async () => {
            haptic();
            const yes = await confirmSheet({
              title: 'Stop sharing?',
              body: ['Their view goes blank straight away. You can share again later with a new code.'],
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
          onclick: (/** @type {Event} */ e) => { haptic(); void start(/** @type {HTMLButtonElement} */ (e.currentTarget)); },
        }, ['Start sharing']),
      ]),
    ]);
  };

  draw();
}

/**
 * Their Today, exactly, from the choices on screen.
 * @param {{choices: import('../domain/partner.js').ShareChoices, helps: string}} draft
 */
function openPreview(draft) {
  const live = store.getState().settings.partnerShare;
  const snap = currentSnapshot({ choices: draft.choices, helps: draft.helps, status: live?.status ?? null });
  openSheet({
    title: 'Their app, today',
    body: [
      el('p', { class: 'hint-sm', text: 'This is their Today screen with what you’re sharing now.' }),
      snap ? el('div', { class: 'pa-preview', 'data-theme': store.getState().settings.theme }, [
        partnerToday(snap, { preview: true }),
      ]) : el('p', { text: 'Log a period first, and there’ll be something to show.' }),
      el('button', { type: 'button', class: 'btn btn-block', onclick: () => { haptic(); openShareSheet(); } },
        ['Back to sharing']),
    ],
  });
}

/* ── Switching what the phone is for ────────────────────────────────────── */

/** Turn this phone into a partner's app. Her own data stays, untouched. */
export async function switchToPartnerMode() {
  const of = store.getState().settings.partnerOf;
  const yes = await confirmSheet({
    title: 'Switch to partner mode?',
    body: [of?.snapshot?.name
      ? `This phone becomes a companion for ${of.snapshot.name}’s cycle. Your own logs stay here, and you can switch back from Settings.`
      : 'This phone follows a partner’s cycle instead of tracking yours. Your own logs stay here, and you can switch back from Settings.'],
    confirmLabel: 'Switch',
  });
  if (!yes) return;
  store.updateSettings({ role: 'partner' });
  await store.flushNow();
  location.reload();
}

/** @param {number} ms */
function keyOf(ms) {
  const d = new Date(ms);
  return /** @type {import('../utils/date.js').DateKey} */ (
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}
