// @ts-check
/**
 * image-picker.js — choose a picture for a theme's mascot.
 *
 * This is the path that matters for the folder-drop-in alternative: it works on
 * the phone, where the pictures she actually wants already live. Pick from the
 * camera roll, position it in a circle, save.
 *
 * The image is downscaled to 512×512 and re-encoded before storage. A modern
 * phone photo is 3–8MB, and keeping dozens of those in IndexedDB for a mascot
 * that renders at 64px would be absurd — the stored result is typically 30–80KB.
 *
 * Everything happens on-device. The file is read with FileReader, drawn to a
 * canvas and written to IndexedDB; it is never uploaded, because there is
 * nowhere to upload it to.
 */

import { el, haptic, announce } from '../utils/dom.js';
import { openSheet, closeSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { getTheme } from '../data/themes.js';
import { emblem, invalidateMascotCache } from './mascot.js';
import * as repo from '../storage/repo.js';

const OUTPUT_SIZE = 512;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/**
 * @param {string} themeId
 * @param {() => void} onSaved
 */
export function openMascotPicker(themeId, onSaved) {
  const theme = getTheme(themeId);

  /** @type {HTMLImageElement|null} */
  let source = null;
  let zoom = 1;
  let offsetX = 0;
  let offsetY = 0;

  const canvas = /** @type {HTMLCanvasElement} */ (el('canvas', {
    class: 'crop-canvas',
    width: String(OUTPUT_SIZE),
    height: String(OUTPUT_SIZE),
    'aria-label': `Preview of the ${theme.name} mascot`,
    role: 'img',
  }));

  const stage = el('div', { class: 'crop-stage' }, [
    canvas,
    el('div', { class: 'crop-mask', 'aria-hidden': 'true' }),
  ]);

  const placeholder = el('div', { class: 'crop-placeholder' }, [
    emblem(themeId, { size: 96 }),
    el('p', { class: 'hint-sm', text: 'No picture chosen yet — the built-in art is being used.' }),
  ]);

  const zoomRow = el('div', { class: 'field', hidden: true }, [
    el('label', { class: 'label', for: 'crop-zoom', text: 'Zoom' }),
    el('input', {
      type: 'range', id: 'crop-zoom', min: '100', max: '300', value: '100',
      style: { width: '100%', accentColor: 'var(--primary)' },
      oninput: (/** @type {Event} */ e) => {
        zoom = Number(/** @type {HTMLInputElement} */ (e.target).value) / 100;
        draw();
      },
    }),
  ]);

  const nudge = el('div', { class: 'crop-nudge', hidden: true }, [
    nudgeBtn('←', () => { offsetX -= 24; draw(); }, 'Move left'),
    nudgeBtn('↑', () => { offsetY -= 24; draw(); }, 'Move up'),
    nudgeBtn('↓', () => { offsetY += 24; draw(); }, 'Move down'),
    nudgeBtn('→', () => { offsetX += 24; draw(); }, 'Move right'),
    nudgeBtn('⟲', () => { zoom = 1; offsetX = 0; offsetY = 0;
      const slider = document.getElementById('crop-zoom');
      if (slider instanceof HTMLInputElement) slider.value = '100';
      draw(); }, 'Reset'),
  ]);

  const fileInput = /** @type {HTMLInputElement} */ (el('input', {
    type: 'file',
    accept: 'image/*',
    style: { display: 'none' },
    onchange: async (/** @type {Event} */ e) => {
      const input = /** @type {HTMLInputElement} */ (e.target);
      const file = input.files?.[0];
      input.value = '';
      if (file) await load(file);
    },
  }));

  const saveBtn = /** @type {HTMLButtonElement} */ (el('button', {
    type: 'button',
    class: 'btn btn-block btn-lg',
    text: 'Use this picture',
    disabled: true,
    onclick: save,
  }));

  /** @param {File} file */
  async function load(file) {
    if (!file.type.startsWith('image/')) {
      toast('That file is not an image');
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      toast('That image is very large — try a smaller one');
      return;
    }

    const url = URL.createObjectURL(file);
    try {
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('decode failed'));
        img.src = url;
      });
    } catch {
      toast('That image could not be opened');
      return;
    } finally {
      // The <img> keeps its own decoded copy, so the blob URL can go now.
      URL.revokeObjectURL(url);
    }

    zoom = 1;
    offsetX = 0;
    offsetY = 0;
    placeholder.hidden = true;
    stage.hidden = false;
    zoomRow.hidden = false;
    nudge.hidden = false;
    saveBtn.disabled = false;
    draw();
    announce('Picture loaded. Adjust the zoom and position, then save.');
  }

  function draw() {
    if (!source) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    // Cover-fit: scale so the shorter edge fills the square, then apply zoom.
    const base = Math.max(OUTPUT_SIZE / source.width, OUTPUT_SIZE / source.height);
    const scale = base * zoom;
    const width = source.width * scale;
    const height = source.height * scale;
    const x = (OUTPUT_SIZE - width) / 2 + offsetX;
    const y = (OUTPUT_SIZE - height) / 2 + offsetY;

    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, x, y, width, height);
  }

  async function save() {
    if (!source) return;

    /** @type {Blob|null} */
    const blob = await new Promise((resolve) => {
      // PNG rather than JPEG: transparent cut-outs are exactly what people use
      // for a mascot, and JPEG would fill the transparency with black.
      canvas.toBlob((b) => resolve(b), 'image/png');
    });

    if (!blob) {
      toast('Could not save that picture');
      return;
    }

    await repo.saveMascot(themeId, blob);
    invalidateMascotCache();
    haptic([10, 30, 10]);
    closeSheet();
    toast(`${theme.name} now uses your picture`);
    onSaved();
  }

  async function remove() {
    await repo.deleteMascot(themeId);
    invalidateMascotCache();
    closeSheet();
    toast(`${theme.name} is back to the built-in art`);
    onSaved();
  }

  stage.hidden = true;

  openSheet({
    title: `${theme.name} picture`,
    body: [
      el('p', { class: 'hint', text:
        'Pick any image from this device. It is cropped to a circle, shrunk to ' +
        '512 pixels and saved into this browser. It never leaves the device — ' +
        'there is nowhere for it to go.' }),
      fileInput,
      placeholder,
      stage,
      zoomRow,
      nudge,
      el('div', { style: { display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' } }, [
        el('button', {
          type: 'button', class: 'btn btn-secondary', style: { flex: '1' },
          text: 'Choose a picture',
          onclick: () => fileInput.click(),
        }),
        el('button', {
          type: 'button', class: 'btn btn-ghost',
          text: 'Use built-in art',
          onclick: remove,
        }),
      ]),
    ],
    footer: [saveBtn],
  });
}

/**
 * @param {string} glyph
 * @param {() => void} onClick
 * @param {string} label
 */
function nudgeBtn(glyph, onClick, label) {
  return el('button', {
    type: 'button',
    class: 'btn-icon',
    'aria-label': label,
    text: glyph,
    style: { border: 'var(--bw-data) solid var(--line-soft)', background: 'var(--card)' },
    onclick: () => { onClick(); haptic(6); },
  });
}
