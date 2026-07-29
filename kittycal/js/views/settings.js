// @ts-check
/**
 * settings.js — everything adjustable, plus the data controls.
 *
 * The export and erase buttons are the point of this screen as much as the
 * theme picker is. "Your data stays on your device" is only a real promise if
 * she can get it out and wipe it whenever she wants.
 */

import { el, replace, haptic, announce } from '../utils/dom.js';
import { checkStorage, fmtBytes } from '../storage/persist.js';
import { todayKey, daysBetween } from '../utils/date.js';
import { plural } from '../utils/fmt.js';
import { loadLock, disableLock, promptForNewPin } from '../ui/lock.js';
import {
  loadReminders, saveReminders, permissionState, requestPermission,
} from '../ui/reminders.js';
import { BIRTH_CONTROL, HORMONAL_BIRTH_CONTROL } from '../domain/model.js';
import { themePicker, setPickerSelection } from '../ui/theme-picker.js';
import { getTheme, THEMES } from '../data/themes.js';
import { applyTheme } from '../ui/theme.js';
import { toast } from '../ui/toast.js';
import { releaseMascotUrls, mascot } from '../ui/mascot.js';
import { openMascotPicker } from '../ui/image-picker.js';
import { openHelp } from './help.js';
import { exportEverything } from '../storage/export-action.js';
import * as store from '../state/store.js';
import * as repo from '../storage/repo.js';
import * as backup from '../storage/backup.js';

/** @param {HTMLElement} host */
export function renderSettings(host) {
  const { settings } = store.getState();

  const picker = themePicker({
    selected: settings.theme,
    onPick: (id) => {
      store.updateSettings({ theme: id });
      applyTheme(id, store.getState().settings.colorMode);
      setPickerSelection(picker, id);
      haptic(8);
      announce(`Theme changed to ${getTheme(id).name}`);
    },
  });

  replace(host, [
    el('div', { class: 'section' }, [
      el('div', { class: 'section-title' }, [el('h2', { text: 'Look' })]),
      picker,
      el('p', { class: 'hint-sm', text: getTheme(settings.theme).blurb }),
      mascotRow(settings.theme),
      appearanceRows(settings),
    ]),

    el('div', { class: 'section' }, [
      el('div', { class: 'section-title' }, [el('h2', { text: 'Your cycle' })]),
      cycleRows(settings),
    ]),

    el('div', { class: 'section' }, [
      el('div', { class: 'section-title' }, [el('h2', { text: 'Units' })]),
      unitRows(settings),
    ]),

    el('div', { class: 'section' }, [
      el('div', { class: 'section-title' }, [el('h2', { text: 'Reminders' })]),
      reminderRows(),
    ]),

    el('div', { class: 'section' }, [
      el('div', { class: 'section-title' }, [el('h2', { text: 'Privacy' })]),
      lockRows(),
    ]),

    el('div', { class: 'section' }, [
      el('div', { class: 'section-title' }, [el('h2', { text: 'Your data' })]),
      storageHealthCard(),
      dataRows(),
      privacyNote(),
    ]),

    el('div', { class: 'section' }, [
      el('div', { class: 'section-title' }, [el('h2', { text: 'About' })]),
      el('div', { class: 'rows', style: { marginBottom: 'var(--sp-3)' } }, [
        el('button', { type: 'button', class: 'row',
          onclick: () => { haptic(); openHelp(); } }, [
          el('span', { class: 'row-label' }, [
            'How Kittycal works',
            el('span', { class: 'choice-sub', text:
              'What every screen does, and how the predictions are worked out' }),
          ]),
          el('span', { class: 'row-value', 'aria-hidden': 'true', text: '›' }),
        ]),
        /*
          The install guide is a plain page rather than an in-app sheet: the
          whole point of it is to be sent to someone who does not have the app
          yet, so it needs a URL of its own.
        */
        el('a', { class: 'row', href: 'install.html', target: '_blank',
                  rel: 'noopener', onclick: () => haptic() }, [
          el('span', { class: 'row-label' }, [
            'Share Kittycal',
            el('span', { class: 'choice-sub', text:
              'A page with a QR code and how to add it to a Home Screen' }),
          ]),
          el('span', { class: 'row-value', 'aria-hidden': 'true', text: '›' }),
        ]),
      ]),
      aboutCard(),
    ]),
  ]);
}

/**
 * Swap the active theme's mascot for one of her own pictures.
 * @param {string} themeId
 */
function mascotRow(themeId) {
  const theme = getTheme(themeId);

  const row = el('button', {
    type: 'button',
    class: 'row',
    style: { border: 'var(--bw-data) solid var(--line-soft)',
             borderRadius: 'var(--r-lg)', background: 'var(--card)',
             marginTop: 'var(--sp-3)' },
    onclick: () => openMascotPicker(themeId, () => {
      const host = document.getElementById('view-settings');
      if (host) renderSettings(host);
    }),
  }, [
    mascot(themeId, { size: 40 }),
    el('span', { class: 'row-label' }, [
      `${theme.name} picture`,
      el('span', { class: 'choice-sub', text:
        'Use one of your own images instead of the built-in art' }),
    ]),
    el('span', { class: 'row-value', 'aria-hidden': 'true', text: '›' }),
  ]);

  // Reflect whether a custom image is already in place, once we know.
  repo.loadMascot(themeId).then((blob) => {
    if (!blob) return;
    const label = row.querySelector('.choice-sub');
    if (label) label.textContent = 'Using your picture — tap to change or remove';
  }).catch(() => { /* the default label is fine */ });

  return row;
}

/* ── Appearance ─────────────────────────────────────────────────────────── */

/** @param {import('../domain/model.js').Settings} settings */
function appearanceRows(settings) {
  return el('div', { class: 'rows' }, [
    selectRow({
      label: 'Colour mode',
      value: settings.colorMode,
      options: [
        { value: 'auto', label: 'Match my phone' },
        { value: 'light', label: 'Always light' },
        { value: 'dark', label: 'Always dark' },
      ],
      onChange: (value) => {
        const mode = /** @type {'light'|'dark'|'auto'} */ (value);
        store.updateSettings({ colorMode: mode });
        applyTheme(store.getState().settings.theme, mode);
      },
    }),
    selectRow({
      label: 'Week starts on',
      value: String(settings.firstDayOfWeek),
      options: [
        { value: '1', label: 'Monday' },
        { value: '0', label: 'Sunday' },
      ],
      onChange: (value) => {
        store.updateSettings({ firstDayOfWeek: value === '0' ? 0 : 1 });
      },
    }),
  ]);
}

/* ── Cycle ──────────────────────────────────────────────────────────────── */

/** @param {import('../domain/model.js').Settings} settings */
function cycleRows(settings) {
  const onHormonal = HORMONAL_BIRTH_CONTROL.has(settings.birthControl);

  return el('div', {}, [
    el('div', { class: 'rows' }, [
      numberRow({
        label: 'Typical cycle length',
        value: settings.avgCycleLength,
        min: 15, max: 60, unit: 'days',
        onChange: (v) => store.updateSettings({ avgCycleLength: v }),
      }),
      numberRow({
        label: 'Typical period length',
        value: settings.avgPeriodLength,
        min: 1, max: 14, unit: 'days',
        onChange: (v) => store.updateSettings({ avgPeriodLength: v }),
      }),
      numberRow({
        label: 'Luteal phase length',
        value: settings.lutealLength,
        min: 8, max: 20, unit: 'days',
        onChange: (v) => store.updateSettings({ lutealLength: v }),
      }),
      selectRow({
        label: 'Birth control',
        value: settings.birthControl,
        options: BIRTH_CONTROL.map((b) => ({ value: b.id, label: b.label })),
        onChange: (value) => {
          store.updateSettings({ birthControl: value });
          // Re-render so the explanatory note below appears or disappears.
          const host = document.getElementById('view-settings');
          if (host) renderSettings(host);
        },
      }),
      el('div', { class: 'row' }, [
        el('span', { class: 'row-label', text: 'Show fertility estimates' }),
        toggleRow({
          checked: settings.showFertility && !onHormonal,
          disabled: onHormonal,
          label: 'Show fertility estimates',
          onChange: (checked) => store.updateSettings({ showFertility: checked }),
        }),
      ]),
    ]),

    el('p', { class: 'hint-sm', style: { marginTop: 'var(--sp-2)' }, text:
      'The luteal phase is the stretch between ovulation and your period. It is ' +
      'the most consistent part of the cycle, which is why Kittycal counts ' +
      'backwards from your next period to estimate ovulation. Fourteen days is ' +
      'typical; leave it alone unless you have been told otherwise.' }),

    onHormonal && el('div', { class: 'alert alert-info', style: { marginTop: 'var(--sp-3)' } }, [
      el('span', { class: 'alert-icon', text: 'i', 'aria-hidden': 'true' }),
      el('div', { text:
        'Hormonal birth control stops ovulation, so ovulation days and fertile ' +
        'windows are hidden. Kittycal would only be guessing, and a guess ' +
        'dressed up as a prediction is worse than nothing. Period tracking and ' +
        'symptom logging carry on as normal.' }),
    ]),
  ]);
}

/* ── Units ──────────────────────────────────────────────────────────────── */

/** @param {import('../domain/model.js').Settings} settings */
function unitRows(settings) {
  return el('div', {}, [
    el('div', { class: 'rows' }, [
      selectRow({
        label: 'Temperature',
        value: settings.unitTemp,
        options: [{ value: 'C', label: 'Celsius' }, { value: 'F', label: 'Fahrenheit' }],
        onChange: (v) => store.updateSettings({ unitTemp: v === 'F' ? 'F' : 'C' }),
      }),
      selectRow({
        label: 'Weight',
        value: settings.unitWeight,
        options: [{ value: 'kg', label: 'Kilograms' }, { value: 'lb', label: 'Pounds' }],
        onChange: (v) => store.updateSettings({ unitWeight: v === 'lb' ? 'lb' : 'kg' }),
      }),
      selectRow({
        label: 'Water',
        value: settings.unitWater,
        options: [{ value: 'ml', label: 'Millilitres' }, { value: 'oz', label: 'Fluid ounces' }],
        onChange: (v) => store.updateSettings({ unitWater: v === 'oz' ? 'oz' : 'ml' }),
      }),
    ]),
    el('p', { class: 'hint-sm', style: { marginTop: 'var(--sp-2)' }, text:
      'Changing a unit only changes how values are displayed. Nothing you have ' +
      'already logged is converted or rounded.' }),
  ]);
}

/* ── Reminders ──────────────────────────────────────────────────────────── */

/**
 * The copy here is deliberately blunt about the limitation. Flo's reminders
 * arrive because Flo runs a server that pushes to your phone; Kittycal has no
 * server, so it can only fire a reminder while the app is being used. Saying
 * so is better than a notification that silently never comes.
 */
function reminderRows() {
  const host = el('div', {});

  const repaint = () => {
    const state = permissionState();

    /** @param {keyof import('../ui/reminders.js').ReminderSettings} key */
    const row = (key, label, sub) => {
      const toggle = el('button', {
        type: 'button', class: 'toggle', role: 'switch',
        'aria-checked': 'false', 'aria-label': label,
        onclick: async () => {
          const next = toggle.getAttribute('aria-checked') !== 'true';
          if (next && !(await requestPermission())) {
            toast('Your browser blocked notifications for this site');
            repaint();
            return;
          }
          toggle.setAttribute('aria-checked', String(next));
          await saveReminders({ [key]: next });
          haptic(8);
          repaint();
        },
      });

      // Reflect the stored value once it loads.
      loadReminders().then((r) => {
        toggle.setAttribute('aria-checked', String(Boolean(r[key])));
      }).catch(() => {});

      return el('div', { class: 'row' }, [
        el('span', { class: 'row-label' }, [
          label,
          sub && el('span', { class: 'choice-sub', text: sub }),
        ]),
        toggle,
      ]);
    };

    replace(host, [
      state === 'unsupported'
        ? el('div', { class: 'alert alert-info' }, [
            el('span', { class: 'alert-icon', text: 'i', 'aria-hidden': 'true' }),
            el('div', { text: 'This browser does not support notifications.' }),
          ])
        : el('div', { class: 'rows' }, [
            row('periodSoon', 'Period coming up', 'A couple of days before it is expected'),
            row('periodLate', 'Period is late', 'If it has not started when expected'),
            row('fertile', 'Fertile window opens', 'Only when fertility estimates are shown'),
            row('pill', 'Birth control', 'A daily nudge'),
            row('logDaily', 'Log a day', 'If you have not logged anything yet'),
          ]),

      el('div', { class: 'alert alert-warn', style: { marginTop: 'var(--sp-3)' } }, [
        el('span', { class: 'alert-icon', text: '!', 'aria-hidden': 'true' }),
        el('div', {}, [
          el('strong', { text: 'These only arrive while you are using Kittycal. ' }),
          'Apps that notify you out of the blue do it by running a server that ' +
          'pushes to your phone, and that server would know your cycle. ' +
          'Kittycal has neither, so a reminder fires when you next open the ' +
          'app on the day it is due — not before.',
        ]),
      ]),

      state === 'denied' && el('div', { class: 'alert alert-danger', style: { marginTop: 'var(--sp-3)' } }, [
        el('span', { class: 'alert-icon', text: '!', 'aria-hidden': 'true' }),
        el('div', { text:
          'Notifications are blocked for this site. You can re-enable them in ' +
          'your browser’s settings for this page.' }),
      ]),
    ]);
  };

  repaint();
  return host;
}

/* ── Passcode ───────────────────────────────────────────────────────────── */

function lockRows() {
  const host = el('div', {});

  const repaint = () => {
    loadLock().then((lock) => {
      replace(host, [
        el('div', { class: 'rows' }, [
          el('button', {
            type: 'button', class: 'row',
            onclick: async () => {
              if (lock.enabled) {
                const ok = window.confirm(
                  'Turn off the passcode? Kittycal will open straight away from now on.',
                );
                if (!ok) return;
                await disableLock();
                toast('Passcode turned off');
              } else if (await promptForNewPin()) {
                toast('Passcode set');
              } else {
                return;
              }
              repaint();
            },
          }, [
            el('span', { class: 'row-label' }, [
              lock.enabled ? 'Turn off passcode' : 'Set a passcode',
              el('span', { class: 'choice-sub', text: lock.enabled
                ? 'Kittycal asks for 4 digits when it opens'
                : 'Ask for 4 digits when Kittycal opens' }),
            ]),
            el('span', { class: 'row-value', 'aria-hidden': 'true', text: '›' }),
          ]),

          lock.enabled && el('button', {
            type: 'button', class: 'row',
            onclick: async () => {
              if (await promptForNewPin()) { toast('Passcode changed'); repaint(); }
            },
          }, [
            el('span', { class: 'row-label', text: 'Change passcode' }),
            el('span', { class: 'row-value', 'aria-hidden': 'true', text: '›' }),
          ]),
        ]),

        el('p', { class: 'hint-sm', style: { marginTop: 'var(--sp-2)' }, text:
          'The passcode is never stored — only a slow hash of it, so the stored ' +
          'value is useless on its own. It keeps the app shut to whoever picks ' +
          'up your phone. It is not encryption: someone determined, with your ' +
          'unlocked device, could still reach the data underneath.' }),
      ]);
    }).catch(() => {});
  };

  repaint();
  return host;
}

/* ── Data ───────────────────────────────────────────────────────────────── */

/**
 * Whether her data is actually safe from being cleared, stated plainly.
 *
 * This is the one place the app admits that local-only storage has a failure
 * mode. Saying "everything is stored on your device" without saying "and here
 * is what could remove it" would be the comfortable half of the truth.
 */
function storageHealthCard() {
  const host = el('div', { class: 'card', style: { marginBottom: 'var(--sp-3)' } }, [
    el('h3', { text: 'Storage' }),
    el('p', { class: 'hint-sm', text: 'Checking…' }),
  ]);

  checkStorage().then((health) => {
    const tone = health.level === 'at-risk' ? 'alert-warn'
      : health.level === 'safe' ? 'alert-ok' : 'alert-info';

    const lastBackup = store.getState().settings.lastBackup;
    const daysSince = lastBackup ? daysBetween(lastBackup, todayKey()) : null;

    replace(host, [
      el('h3', { text: 'Storage' }),

      el('div', { class: `alert ${tone}`, style: { marginTop: 'var(--sp-2)' } }, [
        el('span', {
          class: 'alert-icon',
          text: health.level === 'safe' ? '✓' : health.level === 'ok' ? 'i' : '!',
          'aria-hidden': 'true',
        }),
        el('div', { text: health.summary }),
      ]),

      health.usedBytes != null && el('p', {
        class: 'hint-sm',
        style: { marginTop: 'var(--sp-2)' },
        text: `Kittycal is using ${fmtBytes(health.usedBytes)} on this device.`,
      }),

      // A backup is the only copy that survives losing the phone entirely, so
      // it gets nagged about — gently, and only once it's genuinely stale.
      el('p', { class: 'hint-sm', style: { marginTop: 'var(--sp-2)' }, text:
        daysSince == null
          ? 'You have never exported a backup. An export is the only copy that ' +
            'survives losing or replacing this phone.'
          : daysSince === 0
            ? 'You exported a backup today.'
            : `Last backup ${plural(daysSince, 'day')} ago.` }),
    ]);
  }).catch(() => {
    replace(host, [
      el('h3', { text: 'Storage' }),
      el('p', { class: 'hint-sm', text:
        'Could not check how this browser is storing your data.' }),
    ]);
  });

  return host;
}

function dataRows() {
  const fileInput = /** @type {HTMLInputElement} */ (el('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: { display: 'none' },
    onchange: async (/** @type {Event} */ e) => {
      const input = /** @type {HTMLInputElement} */ (e.target);
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      await doImport(file);
    },
  }));

  return el('div', { class: 'rows' }, [
    fileInput,
    buttonRow({
      label: 'Export everything',
      value: 'JSON file',
      onClick: exportEverything,
    }),
    buttonRow({
      label: 'Import from a backup',
      value: 'Replaces current data',
      onClick: () => fileInput.click(),
    }),
    buttonRow({
      label: 'Erase all my data',
      value: 'Cannot be undone',
      danger: true,
      onClick: doErase,
    }),
  ]);
}

/** @param {File} file */
async function doImport(file) {
  let text;
  try {
    text = await backup.readFile(file);
  } catch {
    toast('Could not read that file');
    return;
  }

  const result = backup.parseImport(text);
  if (!result.ok) {
    toast(result.error ?? 'That import failed');
    return;
  }

  const confirmed = window.confirm(
    `This will replace everything currently in Kittycal with the backup:\n\n` +
    `• ${result.logCount} logged days\n` +
    `• ${result.periodCount} period days\n\n` +
    `Your current data will be gone. Continue?`,
  );
  if (!confirmed) return;

  await store.replaceAll({
    settings: result.settings,
    logs: result.logs,
    periodDays: result.periodDays,
  });

  const settings = store.getState().settings;
  applyTheme(settings.theme, settings.colorMode);
  toast(`Imported ${result.logCount} logged days`);
}

async function doErase() {
  const confirmed = window.confirm(
    'Erase everything?\n\n' +
    'Every logged day, every period, your settings and any pictures you added ' +
    'will be permanently deleted from this device. There is no server copy and ' +
    'no way to undo this.\n\n' +
    'Export first if you want to keep a copy.',
  );
  if (!confirmed) return;

  const second = window.confirm('Last check — really erase all of it?');
  if (!second) return;

  releaseMascotUrls();
  await repo.eraseEverything();
  store.resetToDefaults();
  toast('Everything erased');
  // Full reload so the app comes back up in its first-run state cleanly.
  setTimeout(() => window.location.reload(), 600);
}

function privacyNote() {
  return el('div', { class: 'alert alert-ok', style: { marginTop: 'var(--sp-3)' } }, [
    el('span', { class: 'alert-icon', text: '♥', 'aria-hidden': 'true' }),
    el('div', {}, [
      el('strong', { text: 'Nothing here is sent anywhere. ' }),
      'Kittycal has no account, no analytics and no server. It makes no ' +
      'internet requests at all — the fonts and every image are part of the app ' +
      'itself. Everything you log lives in this browser on this device, and the ' +
      'only copies that exist are the ones you export yourself.',
    ]),
  ]);
}

function aboutCard() {
  return el('div', { class: 'card' }, [
    el('h3', { text: 'Kittycal' }),
    el('p', { class: 'hint-sm', text:
      `${THEMES.length} themes. No subscription, no paywall, no adverts, ever.` }),
    el('p', { class: 'hint-sm', style: { marginTop: 'var(--sp-2)' }, text:
      'Predicted periods, fertile windows and ovulation days are estimates ' +
      'calculated from your own logs. They are not a contraceptive method and ' +
      'not medical advice. Please talk to a doctor about anything that concerns ' +
      'you.' }),
  ]);
}

/* ── Row builders ───────────────────────────────────────────────────────── */

/**
 * @param {Object} opts
 * @param {string} opts.label
 * @param {string} opts.value
 * @param {{value: string, label: string}[]} opts.options
 * @param {(value: string) => void} opts.onChange
 */
function selectRow({ label, value, options, onChange }) {
  const id = `set-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return el('div', { class: 'row' }, [
    el('label', { class: 'row-label', for: id, text: label }),
    el('select', {
      class: 'select',
      id,
      style: { width: 'auto', minWidth: '150px' },
      onchange: (/** @type {Event} */ e) => {
        onChange(/** @type {HTMLSelectElement} */ (e.target).value);
        haptic(8);
      },
    }, options.map((option) =>
      el('option', {
        value: option.value,
        text: option.label,
        selected: option.value === value || null,
      }),
    )),
  ]);
}

/**
 * @param {Object} opts
 * @param {string} opts.label
 * @param {number} opts.value
 * @param {number} opts.min
 * @param {number} opts.max
 * @param {string} opts.unit
 * @param {(value: number) => void} opts.onChange
 */
function numberRow({ label, value, min, max, unit, onChange }) {
  const id = `set-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return el('div', { class: 'row' }, [
    el('label', { class: 'row-label', for: id, text: label }),
    el('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' } }, [
      el('input', {
        class: 'input num',
        id,
        type: 'number',
        inputmode: 'numeric',
        value: String(value),
        min: String(min),
        max: String(max),
        style: { width: '78px', textAlign: 'center' },
        onchange: (/** @type {Event} */ e) => {
          const input = /** @type {HTMLInputElement} */ (e.target);
          const parsed = Number(input.value);
          const next = Number.isFinite(parsed)
            ? Math.min(max, Math.max(min, Math.round(parsed)))
            : value;
          input.value = String(next);
          onChange(next);
        },
      }),
      el('span', { class: 'row-value', text: unit }),
    ]),
  ]);
}

/**
 * @param {Object} opts
 * @param {boolean} opts.checked
 * @param {boolean} [opts.disabled]
 * @param {string} opts.label
 * @param {(checked: boolean) => void} opts.onChange
 */
function toggleRow({ checked, disabled = false, label, onChange }) {
  const button = el('button', {
    type: 'button',
    class: 'toggle',
    role: 'switch',
    'aria-checked': String(checked),
    'aria-label': label,
    disabled: disabled || null,
    onclick: () => {
      const next = button.getAttribute('aria-checked') !== 'true';
      button.setAttribute('aria-checked', String(next));
      onChange(next);
      haptic(8);
    },
  });
  return button;
}

/**
 * @param {Object} opts
 * @param {string} opts.label
 * @param {string} opts.value
 * @param {boolean} [opts.danger]
 * @param {() => void} opts.onClick
 */
function buttonRow({ label, value, danger = false, onClick }) {
  return el('button', {
    type: 'button',
    class: 'row',
    onclick: onClick,
  }, [
    el('span', {
      class: 'row-label',
      text: label,
      style: danger ? { color: 'var(--danger)' } : {},
    }),
    el('span', { class: 'row-value', text: value }),
    el('span', { 'aria-hidden': 'true', class: 'row-value', text: '›' }),
  ]);
}
