// @ts-check
/**
 * sheet.js — bottom sheets.
 *
 * One sheet is open at a time. Opening handles the things that are easy to
 * forget and obvious when missing: focus moves into the sheet and is trapped
 * there, Escape closes, the background stops scrolling, and focus returns to
 * whatever opened it.
 */

import { el, need, trapFocus, haptic } from '../utils/dom.js';

/** Ids handed to openers that lack one, so focus can be restored by lookup. */
let openerSeq = 0;

/** @type {{root: HTMLElement, backdrop: HTMLElement, release: () => void, opener: string|null}|null} */
let open = null;

/**
 * Whether a sheet is currently open.
 *
 * Used by the update path in main.js: a new app version must never reload the
 * page out from under an open logging sheet, because nothing in that sheet is
 * saved until Apply.
 */
export function isSheetOpen() {
  return open != null;
}

/**
 * @param {Object} opts
 * @param {string} opts.title
 * @param {(Node|string|null|false)[]} opts.body
 * @param {(Node|string|null|false)[]} [opts.footer]
 * @param {() => void} [opts.onClose]
 * @returns {{close: () => void, body: HTMLElement}}
 */
export function openSheet({ title, body, footer, onClose }) {
  closeSheet();

  /*
    Where focus goes back to.

    Remembering the node is not enough: the view underneath re-renders while a
    sheet is open — applying a log notifies the store, which rebuilds Today —
    so by the time the sheet closes the button that opened it has usually been
    replaced. The old restore guarded on `document.contains(opener)`, found a
    detached node, and correctly did nothing, which left focus on <body>. A
    keyboard user was dropped at the top of the document every time.

    So an id is stamped on the opener and looked up again at close, which
    survives the node being rebuilt as long as the view redraws the same
    control. `openerFallback` catches the case where it genuinely no longer
    exists — the tab bar is always present and is a sane place to land.
  */
  const active = document.activeElement;
  /*
    Only a real control counts. A sheet opened by a tap rather than by keyboard
    leaves `document.activeElement` as <body>, and an earlier version of this
    stamped an id onto <body> and then dutifully restored focus to it — which
    is exactly the nothing it was meant to fix, with an id attached.
  */
  const openerNode = active instanceof HTMLElement
    && active !== document.body
    && active.matches('button, [href], input, select, textarea, [tabindex]')
    ? active
    : null;
  if (openerNode && !openerNode.id) openerNode.id = `sheet-opener-${(openerSeq += 1)}`;
  const opener = openerNode ? openerNode.id : null;

  const backdrop = el('div', {
    class: 'sheet-backdrop',
    onclick: () => closeSheet(),
  });

  const bodyHost = el('div', { class: 'sheet-body' }, body);

  const root = el('div', {
    class: 'sheet',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
  }, [
    el('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    el('div', { class: 'sheet-head' }, [
      el('h2', { text: title }),
      el('button', {
        type: 'button',
        class: 'btn-icon',
        'aria-label': 'Close',
        text: '✕',
        onclick: () => closeSheet(),
      }),
    ]),
    bodyHost,
    footer && el('div', { class: 'sheet-foot' }, footer),
  ]);

  document.body.append(backdrop, root);
  holdBackground(true);

  // Stop the page behind from scrolling while the sheet is up.
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const releaseTrap = trapFocus(root);

  /** @param {KeyboardEvent} e */
  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSheet();
    }
  };
  document.addEventListener('keydown', onKeydown);

  open = {
    root,
    backdrop,
    opener,
    release: () => {
      releaseTrap();
      document.removeEventListener('keydown', onKeydown);
      document.body.style.overflow = previousOverflow;
      onClose?.();
    },
  };

  // Animate in on the next frame — setting the attribute in the same frame the
  // element is inserted skips the transition.
  requestAnimationFrame(() => {
    backdrop.dataset.open = 'true';
    root.dataset.open = 'true';
    /*
      A view can nominate where focus should land with `data-autofocus`.

      Otherwise it is the first focusable thing, which in this layout is the
      close button in the header — fine for a sheet you are reading, wrong for
      one that opens by asking you a question, where it means a screen reader
      announces "close" instead of the question.
    */
    const first = root.querySelector('[data-autofocus]')
      ?? root.querySelector('button, [href], input, select, textarea');
    if (first instanceof HTMLElement) first.focus({ preventScroll: true });
  });

  haptic(8);

  return { close: closeSheet, body: bodyHost };
}

export function closeSheet() {
  if (!open) return;
  const { root, backdrop, release, opener } = open;
  open = null;

  release();
  holdBackground(false);
  root.dataset.open = 'false';
  backdrop.dataset.open = 'false';

  /*
    Removed once the slide-down actually finishes, not on a timer guessing how
    long that takes. This used to be a bare `setTimeout(…, 340)` — 340 being
    the same number hardcoded into .sheet's transition in components.css, two
    copies of one duration with nothing keeping them equal. Change either
    without the other and the sheet is either yanked from the DOM mid-slide or
    left sitting there, invisible, for however long the timer overshoots by.
    `prefers-reduced-motion` was the case that actually showed it: that mode
    collapses every CSS transition to ~0ms (reset.css), so the closed sheet
    was lingering for most of a third of a second after it had already
    finished disappearing. `transitionend` tracks whatever the real duration
    is, including that one; the timeout below it only guards the case the
    event never fires at all, mirroring `mascot.js`'s `animationend` pattern.
  */
  let removed = false;
  const finish = () => {
    if (removed) return;
    removed = true;
    root.removeEventListener('transitionend', onSlideEnd);
    root.remove();
    backdrop.remove();
  };
  /** @param {TransitionEvent} e */
  const onSlideEnd = (e) => {
    if (e.target === root && e.propertyName === 'transform') finish();
  };
  root.addEventListener('transitionend', onSlideEnd);
  setTimeout(finish, 500);

  /*
    Restored after the screen underneath has settled, not before it.

    Closing a sheet usually changes state — the check-in records that it was
    skipped, the diary applies a log — and the store notifies on a later turn,
    so the view redraws *after* `closeSheet` has returned. Restoring focus
    inline did work, and then the re-render replaced the freshly focused button
    and dropped focus to <body>: the fix looked correct in the code and failed
    on the screen. Two frames is past both the notify and the paint.
  */
  requestAnimationFrame(() => requestAnimationFrame(() => {
    /*
      Stand down only if something *else* has claimed focus — a toast action,
      or the next sheet in a chain.

      "Anything that is not <body>" was the wrong test: the sheet is still on
      screen for the length of its exit animation, so at this point focus is
      normally still on the close button that was just pressed, and the check
      bailed every time. Focus inside the dying sheet is precisely the case
      this exists to rescue.
    */
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body
      && !root.contains(active)) return;

    const back = opener ? document.getElementById(opener) : null;
    const target = back
      ?? document.querySelector('.tabbar button[aria-selected="true"]')
      ?? document.querySelector('.tabbar button');
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  }));
}

/**
 * Take the page behind the sheet out of play.
 *
 * `inert` does both halves of what a modal needs in one attribute: nothing
 * underneath can be tabbed to, and nothing underneath is announced. The sheet
 * has always carried `aria-modal="true"` and this file has always claimed
 * focus was "trapped there" — but nothing trapped it, and fourteen controls
 * behind an open sheet stayed reachable by keyboard.
 *
 * Applied to the shells rather than to <body>, because the sheet and its
 * backdrop are appended to <body> and would otherwise inert themselves.
 *
 * @param {boolean} on
 */
function holdBackground(on) {
  for (const sel of ['#app-root', '#onboarding-root', '#live-region']) {
    const node = document.querySelector(sel);
    // The live region stays out of it: an announcement made while a sheet is
    // open is usually about the sheet.
    if (!(node instanceof HTMLElement) || sel === '#live-region') continue;
    if (on) node.setAttribute('inert', '');
    else node.removeAttribute('inert');
  }
}

