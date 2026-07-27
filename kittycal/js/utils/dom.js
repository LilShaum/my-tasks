// @ts-check
/**
 * dom.js — a small element builder.
 *
 * Views build real nodes rather than assigning innerHTML. That's deliberate:
 * this app renders user-entered notes and custom symptom names, and building
 * nodes means text is set via textContent and can never be parsed as markup.
 * There is no escaping function to forget to call.
 */

/**
 * Create an element.
 *
 * `attrs` keys are mostly set as attributes, with these special cases:
 *   class / className  → className
 *   style              → object of CSS properties (supports custom props)
 *   dataset            → object of data-* values
 *   text               → textContent
 *   html               → innerHTML (only ever called with our own literals)
 *   on                 → { eventName: handler }
 *   any 'on*' function → addEventListener for the implied event
 *   null / undefined    → attribute omitted
 *   true               → bare attribute
 *   false              → attribute omitted
 *
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {(Node|string|null|undefined|false)[]} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  append(node, children);
  return node;
}

/**
 * Same as `el` but in the SVG namespace, which `createElement` can't do.
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {(Node|string|null|undefined|false)[]} [children]
 * @returns {SVGElement}
 */
export function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  applyAttrs(node, attrs);
  append(node, children);
  return node;
}

/**
 * @param {Element} node
 * @param {Record<string, any>} attrs
 */
function applyAttrs(node, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;

    if (key === 'class' || key === 'className') {
      node.setAttribute('class', String(value));
    } else if (key === 'value' && node instanceof HTMLTextAreaElement) {
      // A textarea has no value *attribute* — its value is its text content,
      // so setAttribute('value', …) silently does nothing.
      node.value = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'html') {
      node.innerHTML = String(value);
    } else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (v == null) continue;
        // setProperty handles custom properties (--foo); style[prop] doesn't.
        /** @type {HTMLElement} */ (node).style.setProperty(prop, String(v));
      }
    } else if (key === 'dataset' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (v == null) continue;
        /** @type {HTMLElement} */ (node).dataset[prop] = String(v);
      }
    } else if (key === 'on' && typeof value === 'object') {
      for (const [evt, fn] of Object.entries(value)) {
        node.addEventListener(evt, /** @type {EventListener} */ (fn));
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
}

/**
 * @param {Element} parent
 * @param {(Node|string|null|undefined|false)[]} children
 */
export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === '') continue;
    parent.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** Replace all children of `parent` with `children`.
 * @param {Element} parent
 * @param {(Node|string|null|undefined|false)[]} children */
export function replace(parent, children) {
  parent.replaceChildren();
  append(parent, children);
}

/** @param {string} sel @param {ParentNode} [root] @returns {HTMLElement|null} */
export const $ = (sel, root = document) => /** @type {HTMLElement|null} */ (root.querySelector(sel));

/** @param {string} sel @param {ParentNode} [root] @returns {HTMLElement[]} */
export const $$ = (sel, root = document) =>
  /** @type {HTMLElement[]} */ ([...root.querySelectorAll(sel)]);

/**
 * Require an element to exist. Throws loudly at boot rather than failing
 * silently three interactions later.
 * @param {string} sel
 * @returns {HTMLElement}
 */
export function need(sel) {
  const node = $(sel);
  if (!node) throw new Error(`dom: expected element "${sel}" to exist`);
  return node;
}

/**
 * Announce a message to screen readers. Real feedback always goes through
 * here — confetti and animation are decoration and never the only signal.
 * @param {string} message
 */
export function announce(message) {
  const region = $('#live-region');
  if (!region) return;
  // Clearing first forces re-announcement of an identical string.
  region.textContent = '';
  requestAnimationFrame(() => { region.textContent = message; });
}

/**
 * A short haptic tap, where the platform supports it. Silently absent on iOS
 * Safari, which is fine — it's a bonus, not a signal.
 * @param {number|number[]} [pattern]
 */
export function haptic(pattern = 12) {
  try {
    if ('vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    /* not available; nothing to do */
  }
}

/** True when the user has asked for less motion. */
export const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Trap Tab focus inside a container while it's open (sheets, dialogs).
 * Returns a cleanup function.
 * @param {HTMLElement} container
 * @returns {() => void}
 */
export function trapFocus(container) {
  const SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (e.key !== 'Tab') return;
    const items = $$(SELECTOR, container).filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  container.addEventListener('keydown', onKeydown);
  return () => container.removeEventListener('keydown', onKeydown);
}

/**
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @param {number} wait
 * @returns {(...args: Parameters<F>) => void}
 */
export function debounce(fn, wait) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
