// ─── State ───────────────────────────────────────────────────────────────────
let todos        = [];
let nextId       = 1;
let filter       = 'all';
let tagFilter    = null;
let sortBy       = 'added';
let deletedTodo  = null;
let undoTimer    = null;
let editingId    = null;
let dragSrcId    = null;
let newPri       = 'none';
let newDate      = '';
let newSelTags   = [];
let newRec       = 'none';
let allTags      = ['Work', 'Personal', 'Shopping', 'Health', 'Finance'];
let selMode      = false;
let selIds       = new Set();
let searchQ      = '';
let showNtag     = false;
let lastPct      = 0;
let darkMode     = false;
let calYear      = new Date().getFullYear();
let calMonth     = new Date().getMonth();
let renamingTag  = null;
let fileHandle   = null;
let backupSaved  = false;
let stats        = { completedTotal: 0, streak: 0, lastCompletedDate: null };

const REC     = ['none', 'daily', 'weekdays', 'weekly', 'monthly'];
const REC_LBL = { none: 'Repeat', daily: 'Daily ·', weekdays: 'Weekdays ·', weekly: 'Weekly ·', monthly: 'Monthly ·' };

const TC = [
  { bg: '#EDE9FE', t: '#3C3489', b: '#7F77DD' },
  { bg: '#EAF3DE', t: '#27500A', b: '#639922' },
  { bg: '#FAEEDA', t: '#633806', b: '#BA7517' },
  { bg: '#FCEBEB', t: '#791F1F', b: '#E24B4A' },
  { bg: '#E0F2FE', t: '#0C447C', b: '#378ADD' },
  { bg: '#FCE7F3', t: '#72243E', b: '#DB2777' },
  { bg: '#E1F5EE', t: '#085041', b: '#1D9E75' },
];

const TC_DARK = [
  { bg: '#1E1B40', t: '#A5A0F5', b: '#7F77DD' },
  { bg: '#142310', t: '#86C55A', b: '#639922' },
  { bg: '#271C05', t: '#D4943E', b: '#BA7517' },
  { bg: '#2D0A0A', t: '#F08080', b: '#E24B4A' },
  { bg: '#0A1E35', t: '#6EB3F5', b: '#378ADD' },
  { bg: '#2D0A1C', t: '#F09BC0', b: '#DB2777' },
  { bg: '#072018', t: '#4DC9A0', b: '#1D9E75' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function tc(tag) {
  let h = 0;
  for (let c of tag) h = (h * 31 + c.charCodeAt(0)) & 0xFFFF;
  return (darkMode ? TC_DARK : TC)[h % TC.length];
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pVal(p) { return { high: 3, medium: 2, low: 1, none: 0 }[p] || 0; }

function todayStr() { return new Date().toISOString().split('T')[0]; }

function nextDue(dd, r) {
  if (!dd || r === 'none') return dd;
  const [y, m, d] = dd.split('-').map(Number);
  let dt = new Date(y, m - 1, d);
  if (r === 'daily')         dt.setDate(dt.getDate() + 1);
  else if (r === 'weekly')   dt.setDate(dt.getDate() + 7);
  else if (r === 'monthly')  dt.setMonth(dt.getMonth() + 1);
  else if (r === 'weekdays') {
    do { dt.setDate(dt.getDate() + 1); }
    while (dt.getDay() === 0 || dt.getDay() === 6);
  }
  return dt.toISOString().split('T')[0];
}

// Returns the timestamp (ms) of the next midnight that is a valid day for the given recurrence.
function nextOccurrenceMidnight(recurring) {
  const now  = new Date();
  // Start candidate: tomorrow at 00:00:00
  let next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  if (recurring === 'daily') {
    return next.getTime();
  }
  if (recurring === 'weekdays') {
    while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  if (recurring === 'weekends') {
    while (next.getDay() !== 0 && next.getDay() !== 6) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  if (recurring === 'weekly') {
    next.setDate(next.getDate() + 6); // tomorrow + 6 = 7 days from today
    return next.getTime();
  }
  if (recurring === 'monthly') {
    return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate(), 0, 0, 0, 0).getTime();
  }
  return next.getTime(); // fallback: tomorrow
}

function fmtDate(ds) {
  if (!ds) return null;
  const [y, m, d] = ds.split('-').map(Number);
  const td   = new Date();
  const dt   = new Date(y, m - 1, d);
  const now  = new Date(td.getFullYear(), td.getMonth(), td.getDate());
  const diff = Math.floor((dt - now) / 86400000);
  const mo   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (diff === 0) return { lbl: 'Today',                   cls: 'd-t' };
  if (diff === 1) return { lbl: 'Tomorrow',                cls: 'd-n' };
  if (diff < 0)  return { lbl: `${Math.abs(diff)}d overdue`, cls: 'd-o' };
  return { lbl: `${mo[m - 1]} ${d}`, cls: 'd-n' };
}

// ─── Persistence ─────────────────────────────────────────────────────────────
function save() {
  try {
    localStorage.setItem('todo_v1', JSON.stringify({ todos, nextId, allTags, stats }));
  } catch (e) {}
  autoSaveToFile();
}

function load() {
  try {
    const raw = localStorage.getItem('todo_v1');
    if (raw) {
      const d = JSON.parse(raw);
      todos   = d.todos   || [];
      nextId  = d.nextId  || todos.length + 1;
      allTags = d.allTags || allTags;
      stats   = d.stats   || stats;
    }
  } catch (e) {}

  darkMode = localStorage.getItem('dark_mode') === 'true';
  applyDarkMode();

  loadFileHandleFromDB().then(handle => {
    if (handle) { fileHandle = handle; renderBackupStatus(); }
  });

  checkRecurringResets(); // reset any tasks whose next occurrence already passed
  scheduleMidnightCheck(); // auto-reset at each midnight going forward
  renderAll();
}

// ─── Dark mode ────────────────────────────────────────────────────────────────
function toggleDark() {
  darkMode = !darkMode;
  localStorage.setItem('dark_mode', darkMode);
  applyDarkMode();
  renderAll();
}

function applyDarkMode() {
  document.body.classList.toggle('dark', darkMode);
}

function renderDarkBtn() {
  const btn = document.getElementById('dark-btn');
  if (!btn) return;
  btn.querySelector('i').className = darkMode ? 'ti ti-sun' : 'ti ti-moon';
  btn.title = darkMode ? 'Switch to light mode' : 'Switch to dark mode';
}

// ─── IndexedDB (file handle storage) ─────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('my-tasks-db', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
    req.onsuccess  = e => resolve(e.target.result);
    req.onerror    = () => reject(req.error);
  });
}

async function saveFileHandleToDB(handle) {
  try {
    const db = await openDB();
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'backup');
  } catch (e) {}
}

async function loadFileHandleFromDB() {
  try {
    const db = await openDB();
    return new Promise(resolve => {
      const tx  = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get('backup');
      req.onsuccess = e => resolve(e.target.result || null);
      req.onerror   = () => resolve(null);
    });
  } catch { return null; }
}

async function clearFileHandleFromDB() {
  try {
    const db = await openDB();
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').delete('backup');
  } catch (e) {}
}

// ─── Auto-backup ──────────────────────────────────────────────────────────────
async function autoSaveToFile() {
  if (!fileHandle) return;
  try {
    let perm = await fileHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') perm = await fileHandle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return;
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify({ todos, nextId, allTags, stats }, null, 2));
    await writable.close();
    backupSaved = true;
    renderBackupStatus();
  } catch (e) {
    console.warn('Auto-save failed:', e);
  }
}

async function linkBackupFile() {
  if (!window.showSaveFilePicker) { alert('Auto-backup requires Chrome or Edge.'); return; }
  try {
    fileHandle = await window.showSaveFilePicker({
      suggestedName: 'my-tasks-backup.json',
      types: [{ description: 'JSON backup', accept: { 'application/json': ['.json'] } }],
    });
    await saveFileHandleToDB(fileHandle);
    await autoSaveToFile();
    renderBackupStatus();
  } catch (e) {
    if (e.name !== 'AbortError') console.error(e);
  }
}

async function unlinkBackupFile() {
  fileHandle  = null;
  backupSaved = false;
  await clearFileHandleFromDB();
  renderBackupStatus();
}

async function restoreFromFile() {
  if (!window.showOpenFilePicker) { alert('Auto-backup requires Chrome or Edge.'); return; }
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'JSON backup', accept: { 'application/json': ['.json'] } }],
    });
    const file = await handle.getFile();
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.todos)) throw new Error('Invalid backup file');
    todos   = data.todos;
    nextId  = data.nextId  || todos.length + 1;
    allTags = data.allTags || allTags;
    stats   = data.stats   || stats;
    fileHandle  = handle;
    backupSaved = true;
    await saveFileHandleToDB(handle);
    save(); renderAll(); renderBackupStatus();
  } catch (e) {
    if (e.name !== 'AbortError') alert('Could not restore: ' + e.message);
  }
}

function renderBackupStatus() {
  const bar     = document.getElementById('backup-bar');
  const lbl     = document.getElementById('backup-lbl');
  const linkBtn = document.getElementById('backup-link-btn');
  const unlBtn  = document.getElementById('backup-unlink-btn');
  const resBtn  = document.getElementById('backup-restore-btn');
  if (!bar) return;

  if (fileHandle) {
    lbl.textContent      = backupSaved ? 'Auto-backup: active' : 'Auto-backup: linking…';
    linkBtn.style.display = 'none';
    unlBtn.style.display  = 'inline-flex';
    resBtn.style.display  = 'none';
    bar.classList.toggle('backup-on', backupSaved);
  } else {
    lbl.textContent       = 'Auto-backup: off';
    linkBtn.style.display = 'inline-flex';
    unlBtn.style.display  = 'none';
    resBtn.style.display  = 'inline-flex';
    bar.classList.remove('backup-on');
  }
}

// ─── Filtering / sorting ──────────────────────────────────────────────────────
function getVis() {
  let list = [...todos];
  if (filter === 'active') list = list.filter(t => !t.done);
  if (filter === 'done')   list = list.filter(t => t.done);
  if (tagFilter) list = list.filter(t => t.tags && t.tags.includes(tagFilter));
  if (searchQ) {
    const q = searchQ.toLowerCase();
    list = list.filter(t =>
      t.text.toLowerCase().includes(q) ||
      (t.note && t.note.toLowerCase().includes(q)) ||
      (t.tags && t.tags.some(g => g.toLowerCase().includes(q)))
    );
  }
  list.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    if (sortBy === 'alpha')    return a.text.localeCompare(b.text);
    if (sortBy === 'priority') return pVal(b.priority) - pVal(a.priority);
    if (sortBy === 'due') {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }
    if (sortBy === 'status') return (a.done ? 1 : 0) - (b.done ? 1 : 0);
    return b.id - a.id;
  });
  return list;
}

// ─── Actions ──────────────────────────────────────────────────────────────────
function addTodo() {
  const inp  = document.getElementById('new-inp');
  const text = inp.value.trim();
  if (!text) return;
  todos.unshift({
    id: nextId++, text, done: false,
    priority: newPri, dueDate: newDate,
    tags: [...newSelTags], note: '',
    subtasks: [], expanded: false, recurring: newRec,
    pinned: false, estimate: '',
  });
  inp.value = '';
  newPri = 'none'; newDate = ''; newSelTags = []; newRec = 'none';
  save(); renderAll();
}

function trackCompletion() {
  const today = todayStr();
  stats.completedTotal = (stats.completedTotal || 0) + 1;
  const last = stats.lastCompletedDate;
  if (last !== today) {
    const prev = new Date(); prev.setDate(prev.getDate() - 1);
    const yStr = prev.toISOString().split('T')[0];
    stats.streak = last === yStr ? (stats.streak || 0) + 1 : 1;
  }
  stats.lastCompletedDate = today;
}

function toggleTodo(id) {
  const t   = todos.find(t => t.id === id);
  if (!t) return;
  const btn = document.getElementById('chk-' + id);

  t.done = !t.done;
  if (t.done) {
    trackCompletion();
    if (btn) { btn.classList.add('bounce'); setTimeout(() => btn.classList.remove('bounce'), 400); }
    setTimeout(fireConfetti, 300);
    if (t.recurring && t.recurring !== 'none') {
      t.completedAt = Date.now();
      t.resetAt     = nextOccurrenceMidnight(t.recurring);
    }
  } else if (t.recurring && t.recurring !== 'none') {
    // Manually unchecked — clear the scheduled reset
    t.completedAt = null;
    t.resetAt     = null;
  }
  save(); renderAll();
}

function deleteTodo(id) {
  const i = todos.findIndex(t => t.id === id);
  if (i < 0) return;
  deletedTodo = { todo: todos[i], idx: i };
  todos.splice(i, 1);
  save(); renderAll(); showToast();
}

function undoDelete() {
  if (!deletedTodo) return;
  todos.splice(deletedTodo.idx, 0, deletedTodo.todo);
  deletedTodo = null;
  clearTimeout(undoTimer);
  hideToast(); save(); renderAll();
}

function clearDone() {
  todos = todos.filter(t => !t.done);
  save(); renderAll();
}

function setFilter(f, btn) {
  filter = f;
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('act'));
  btn.classList.add('act');
  renderAll();
}

function setSortBy(v) { sortBy = v; renderAll(); }

function toggleExpand(id) {
  const t = todos.find(t => t.id === id);
  if (t) t.expanded = !t.expanded;
  save(); renderAll();
}

function startEdit(id) {
  editingId = id; renderAll();
  setTimeout(() => {
    const inp = document.getElementById('edt-' + id);
    if (inp) { inp.focus(); inp.select(); }
  }, 0);
}

function saveEdit(id) {
  const inp = document.getElementById('edt-' + id);
  if (!inp) return;
  const t = todos.find(t => t.id === id);
  if (t) { const v = inp.value.trim(); if (v) t.text = v; }
  editingId = null; save(); renderAll();
}

function cancelEdit() { editingId = null; renderAll(); }

function saveNote(id, v) {
  const t = todos.find(t => t.id === id);
  if (t) t.note = v;
  save();
}

function setPriority(id, p) {
  const t = todos.find(t => t.id === id);
  if (t) t.priority = p;
  save(); renderAll();
}

function setRecurring(id, r) {
  const t = todos.find(t => t.id === id);
  if (t) t.recurring = r;
  save(); renderAll();
}

function setDueDate(id, v) {
  const t = todos.find(t => t.id === id);
  if (t) t.dueDate = v;
  save(); renderAll();
}

function togglePin(id) {
  const t = todos.find(t => t.id === id);
  if (t) t.pinned = !t.pinned;
  save(); renderAll();
}

function setEstimate(id, v) {
  const t = todos.find(t => t.id === id);
  if (t) t.estimate = v.trim();
  save();
}

// ─── Subtasks ─────────────────────────────────────────────────────────────────
function addSubtask(tid) {
  const inp  = document.getElementById('si-' + tid);
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;
  const t = todos.find(t => t.id === tid);
  if (!t) return;
  t.subtasks.push({ id: nextId++, text, done: false });
  inp.value = ''; save(); renderAll();
  setTimeout(() => { const ni = document.getElementById('si-' + tid); if (ni) ni.focus(); }, 0);
}

function toggleSub(tid, sid) {
  const t = todos.find(t => t.id === tid);
  if (!t) return;
  const s = t.subtasks.find(s => s.id === sid);
  if (s) s.done = !s.done;
  save(); renderAll();
}

function deleteSub(tid, sid) {
  const t = todos.find(t => t.id === tid);
  if (!t) return;
  t.subtasks = t.subtasks.filter(s => s.id !== sid);
  save(); renderAll();
}

// ─── Tag management ───────────────────────────────────────────────────────────
function deleteTag(tag) {
  if (!confirm(`Delete the tag "${tag}"? It will be removed from all tasks.`)) return;
  allTags = allTags.filter(t => t !== tag);
  todos.forEach(t => { t.tags = (t.tags || []).filter(g => g !== tag); });
  if (tagFilter === tag) tagFilter = null;
  newSelTags = newSelTags.filter(t => t !== tag);
  save(); renderAll();
}

function startRenameTag(tag) {
  renamingTag = tag;
  renderTagStrip();
  setTimeout(() => {
    const inp = document.getElementById('tag-rename-inp');
    if (inp) { inp.focus(); inp.select(); }
  }, 0);
}

function commitRenameTag() {
  const inp = document.getElementById('tag-rename-inp');
  const oldTag = renamingTag;
  renamingTag = null;
  if (!inp || !oldTag) { renderTagStrip(); return; }
  const newTag = inp.value.trim().replace(/['"<>\\]/g, '');
  if (newTag && newTag !== oldTag && !allTags.includes(newTag)) {
    allTags[allTags.indexOf(oldTag)] = newTag;
    todos.forEach(t => { t.tags = (t.tags || []).map(g => g === oldTag ? newTag : g); });
    if (tagFilter === oldTag) tagFilter = newTag;
    newSelTags = newSelTags.map(t => t === oldTag ? newTag : t);
    save();
  }
  renderAll();
}

// ─── Add-task options ─────────────────────────────────────────────────────────
function cycleNewPri() {
  const c = ['none', 'low', 'medium', 'high'];
  newPri  = c[(c.indexOf(newPri) + 1) % c.length];
  renderAddOpts();
}

function cycleNewRec() {
  newRec = REC[(REC.indexOf(newRec) + 1) % REC.length];
  renderAddOpts();
}

function toggleNewTag(i) {
  const tag  = allTags[i];
  newSelTags = newSelTags.includes(tag)
    ? newSelTags.filter(t => t !== tag)
    : [...newSelTags, tag];
  renderAddOpts();
}

function setNewDate(v) { newDate = v; }

function showNtagField() {
  showNtag = true; renderAddOpts();
  setTimeout(() => { const inp = document.getElementById('ntag-inp'); if (inp) { inp.style.display = 'inline-flex'; inp.focus(); } }, 0);
}

function addNewTag() {
  const inp = document.getElementById('ntag-inp');
  if (!inp) return;
  const v = inp.value.trim().replace(/['"<>\\]/g, '');
  if (v) {
    if (!allTags.includes(v)) allTags.push(v);
    if (!newSelTags.includes(v)) newSelTags.push(v);
  }
  showNtag = false; save(); renderAddOpts(); renderTagStrip();
}

// ─── Search ───────────────────────────────────────────────────────────────────
function onSearch(v) {
  searchQ = v;
  const clr = document.getElementById('si-clear');
  if (clr) clr.style.display = v ? 'flex' : 'none';
  renderList();
}

function clearSearch() {
  document.getElementById('search-inp').value = '';
  onSearch('');
}

// ─── Tag filter ───────────────────────────────────────────────────────────────
function setTagFilter(tag) {
  tagFilter = tagFilter === tag ? null : tag;
  renderAll();
}

// ─── Select / bulk ────────────────────────────────────────────────────────────
function toggleSelectMode() {
  selMode = !selMode;
  if (!selMode) selIds.clear();
  const btn = document.getElementById('sel-btn');
  if (btn) btn.classList.toggle('act', selMode);
  renderAll();
}

function toggleSel(id) {
  if (selIds.has(id)) selIds.delete(id); else selIds.add(id);
  renderBulkBar(); renderList();
}

function renderBulkBar() {
  const bar = document.getElementById('bulk-bar');
  const lbl = document.getElementById('bulk-lbl');
  if (selMode && selIds.size > 0) {
    bar.style.display = 'flex';
    lbl.textContent   = `${selIds.size} selected`;
  } else {
    bar.style.display = 'none';
  }
}

function bulkComplete() {
  selIds.forEach(id => { const t = todos.find(t => t.id === id); if (t) t.done = true; });
  selIds.clear(); save(); renderAll();
}

function bulkDelete() {
  todos = todos.filter(t => !selIds.has(t.id));
  selIds.clear(); save(); renderAll();
}

// ─── Drag & drop ──────────────────────────────────────────────────────────────
function onDragStart(e, id) {
  dragSrcId = id;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => { const el = document.getElementById('ti-' + id); if (el) el.style.opacity = '.4'; }, 0);
}

function onDragOver(e, id) {
  e.preventDefault();
  document.querySelectorAll('.task-item').forEach(el => { el.classList.remove('drag-over'); el.style.opacity = ''; });
  if (id !== dragSrcId) { const el = document.getElementById('ti-' + id); if (el) el.classList.add('drag-over'); }
}

function onDragEnd() {
  document.querySelectorAll('.task-item').forEach(el => { el.classList.remove('drag-over'); el.style.opacity = ''; });
  dragSrcId = null;
}

function onDrop(e, tid) {
  e.preventDefault();
  if (dragSrcId === null || dragSrcId === tid) return;
  const si  = todos.findIndex(t => t.id === dragSrcId);
  const ti2 = todos.findIndex(t => t.id === tid);
  if (si < 0 || ti2 < 0) return;
  const [item] = todos.splice(si, 1);
  todos.splice(ti2, 0, item);
  save(); renderAll();
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast() {
  document.getElementById('toast-wrap').style.display = 'block';
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  const tw = document.getElementById('toast-wrap');
  if (tw) tw.style.display = 'none';
  deletedTodo = null;
}

// ─── Views ────────────────────────────────────────────────────────────────────
function showView(name) {
  document.getElementById('main-view').style.display  = name === 'main'     ? 'block' : 'none';
  document.getElementById('help-view').style.display  = name === 'help'     ? 'block' : 'none';
  document.getElementById('stats-view').style.display = name === 'stats'    ? 'block' : 'none';
  document.getElementById('cal-view').style.display   = name === 'calendar' ? 'block' : 'none';
  if (name === 'stats')    renderStats();
  if (name === 'calendar') renderCalendar();
}

function showHelp() { showView('help'); }
function hideHelp() { showView('main'); }

// ─── Stats ────────────────────────────────────────────────────────────────────
function renderStats() {
  const total   = todos.length;
  const done    = todos.filter(t => t.done).length;
  const active  = total - done;
  const pct     = total > 0 ? Math.round(done / total * 100) : 0;
  const overdue = todos.filter(t => !t.done && t.dueDate && t.dueDate < todayStr()).length;
  const pinned  = todos.filter(t => t.pinned).length;

  const priCount = { high: 0, medium: 0, low: 0, none: 0 };
  todos.filter(t => !t.done).forEach(t => priCount[t.priority || 'none']++);

  const tagCount = {};
  todos.forEach(t => (t.tags || []).forEach(g => { tagCount[g] = (tagCount[g] || 0) + 1; }));
  const tagEntries = Object.entries(tagCount).sort((a, b) => b[1] - a[1]);

  const priBar = (label, key, color) => {
    const c = priCount[key];
    const w = active > 0 ? Math.round(c / active * 100) : 0;
    return `<div class="stat-row">
      <span class="stat-row-lbl">${label}</span>
      <div class="stat-bar-wrap"><div class="stat-bar-fill" style="width:${w}%;background:${color}"></div></div>
      <span class="stat-row-val">${c}</span>
    </div>`;
  };

  let html = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-num">${total}</div>
        <div class="stat-lbl">Total</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${active}</div>
        <div class="stat-lbl">Active</div>
      </div>
      <div class="stat-card ${overdue > 0 ? 'stat-card-warn' : ''}">
        <div class="stat-num">${overdue}</div>
        <div class="stat-lbl">Overdue</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${pct}%</div>
        <div class="stat-lbl">Complete</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${stats.completedTotal || 0}</div>
        <div class="stat-lbl">All-time done</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${stats.streak || 0}</div>
        <div class="stat-lbl">Day streak</div>
      </div>
    </div>
    <div class="stat-sec-lbl">Active by priority</div>
    ${priBar('High',   'high',   '#E24B4A')}
    ${priBar('Medium', 'medium', '#BA7517')}
    ${priBar('Low',    'low',    '#639922')}
    ${priBar('None',   'none',   '#A8A8A4')}
  `;

  if (tagEntries.length) {
    html += `<div class="stat-sec-lbl" style="margin-top:1.25rem">Tasks by tag</div>`;
    const max = tagEntries[0][1];
    tagEntries.forEach(([tag, count]) => {
      const c = tc(tag);
      const w = Math.round(count / max * 100);
      html += `<div class="stat-row">
        <span class="stat-row-lbl" style="color:${c.t}">#${esc(tag)}</span>
        <div class="stat-bar-wrap"><div class="stat-bar-fill" style="width:${w}%;background:${c.b}"></div></div>
        <span class="stat-row-val">${count}</span>
      </div>`;
    });
  }

  document.getElementById('stats-content').innerHTML = html;
}

// ─── Confetti ─────────────────────────────────────────────────────────────────
function fireConfetti() {
  const canvas = document.getElementById('confetti');
  canvas.style.display = 'block';
  const W = canvas.width  = window.innerWidth;
  const H = canvas.height = window.innerHeight;
  const ctx  = canvas.getContext('2d');
  const cols = ['#639922','#BA7517','#378ADD','#7F77DD','#E24B4A','#DB2777','#1D9E75','#FAC775'];
  const parts = Array.from({ length: 90 }, () => ({
    x: Math.random() * W, y: -20 - Math.random() * 120,
    vx: (Math.random() - .5) * 2.5, vy: 2.5 + Math.random() * 3,
    r: 3 + Math.random() * 5, col: cols[Math.floor(Math.random() * cols.length)],
    rot: Math.random() * 360, vr: (Math.random() - .5) * 7, a: 1,
  }));
  let f = 0;
  function draw() {
    ctx.clearRect(0, 0, W, H);
    parts.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      if (f > 55) p.a = Math.max(0, p.a - .018);
      ctx.save();
      ctx.globalAlpha = p.a;
      ctx.fillStyle   = p.col;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillRect(-p.r, -p.r * .5, p.r * 2, p.r);
      ctx.restore();
    });
    f++;
    if (f < 130) requestAnimationFrame(draw);
    else { ctx.clearRect(0, 0, W, H); canvas.style.display = 'none'; }
  }
  draw();
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
function calPrev() {
  if (calMonth === 0) { calMonth = 11; calYear--; } else calMonth--;
  renderCalendar();
}
function calNext() {
  if (calMonth === 11) { calMonth = 0; calYear++; } else calMonth++;
  renderCalendar();
}

function renderCalendar() {
  const MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
  const DOW_LABELS  = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  const PRI_COLOR   = { high: '#E24B4A', medium: '#BA7517', low: '#639922', none: 'var(--border2)' };

  const todStr   = todayStr();
  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay  = new Date(calYear, calMonth + 1, 0);
  const startDow = firstDay.getDay();
  const daysInMo = lastDay.getDate();

  document.getElementById('cal-month-lbl').textContent =
    `${MONTH_NAMES[calMonth]} ${calYear}`;

  // ── Day-of-week header row ──
  let html = '<div class="cal-grid">';
  DOW_LABELS.forEach(d => { html += `<div class="cal-dow">${d}</div>`; });

  // ── Leading blank cells ──
  for (let i = 0; i < startDow; i++) {
    html += '<div class="cal-day cal-day-empty"></div>';
  }

  // ── One cell per day ──
  for (let day = 1; day <= daysInMo; day++) {
    const dateObj = new Date(calYear, calMonth, day);
    const dow     = dateObj.getDay();
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday = dateStr === todStr;

    // Tasks that appear on this day
    const dayTasks = todos.filter(t => {
      if (!t.recurring || t.recurring === 'none') return t.dueDate === dateStr;
      switch (t.recurring) {
        case 'daily':    return true;
        case 'weekdays': return dow >= 1 && dow <= 5;
        case 'weekends': return dow === 0 || dow === 6;
        case 'weekly': {
          if (!t.dueDate) return dow === 1;
          const [wy, wm, wd] = t.dueDate.split('-').map(Number);
          return new Date(wy, wm - 1, wd).getDay() === dow;
        }
        case 'monthly': {
          if (!t.dueDate) return day === 1;
          return parseInt(t.dueDate.split('-')[2], 10) === day;
        }
        default: return false;
      }
    });

    html += `<div class="cal-day${isToday ? ' cal-today' : ''}">`;
    html += `<div class="cal-day-num">${day}</div>`;

    const maxShow = 3;
    dayTasks.slice(0, maxShow).forEach(t => {
      // Non-recurring: use the task's own done state.
      // Recurring: only show as done on today's cell (the task only has one live done state).
      const isDone = t.done && (!t.recurring || t.recurring === 'none' || isToday);
      const col    = PRI_COLOR[t.priority] || PRI_COLOR.none;
      html += `<div class="cal-task${isDone ? ' cal-task-done' : ''}" `
            + `style="border-left-color:${col}" title="${esc(t.text)}">`
            + (isDone ? '<i class="ti ti-check"></i>' : '')
            + `<span>${esc(t.text)}</span></div>`;
    });

    if (dayTasks.length > maxShow) {
      html += `<div class="cal-more">+${dayTasks.length - maxShow} more</div>`;
    }

    html += '</div>';
  }

  // ── Trailing blank cells to complete the final row ──
  const total    = startDow + daysInMo;
  const trailing = (7 - (total % 7)) % 7;
  for (let i = 0; i < trailing; i++) {
    html += '<div class="cal-day cal-day-empty"></div>';
  }

  html += '</div>';
  document.getElementById('cal-content').innerHTML = html;
}

// ─── Recurring reset ─────────────────────────────────────────────────────────
// Checks all recurring tasks and resets any whose next-occurrence time has passed.
function checkRecurringResets() {
  const now     = Date.now();
  let changed   = false;
  todos.forEach(t => {
    if (t.done && t.recurring && t.recurring !== 'none' && t.resetAt && now >= t.resetAt) {
      t.done        = false;
      t.completedAt = null;
      t.resetAt     = null;
      changed       = true;
    }
  });
  if (changed) { save(); renderAll(); }
}

// Schedules checkRecurringResets at each midnight (30 s after to avoid edge cases).
function scheduleMidnightCheck() {
  const now       = new Date();
  const tomorrow  = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 30, 0);
  const msUntil   = tomorrow.getTime() - now.getTime();
  setTimeout(() => {
    checkRecurringResets();
    scheduleMidnightCheck(); // reschedule for the following midnight
  }, msUntil);
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderAll() {
  renderDarkBtn(); renderProg(); renderAddOpts(); renderTagStrip();
  renderList(); renderFtr(); renderBulkBar(); renderBackupStatus();
}

function renderProg() {
  const d      = new Date();
  const total  = todos.length;
  const done   = todos.filter(t => t.done).length;
  const pct    = total > 0 ? Math.round(done / total * 100) : 0;
  const active = todos.filter(t => !t.done).length;

  document.getElementById('date-lbl').textContent   = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  document.getElementById('pct-lbl').textContent    = pct + '%';
  document.getElementById('prog-fill').style.width  = pct + '%';
  document.getElementById('active-cnt').textContent = active === 1 ? '1 left' : `${active} left`;

  lastPct = pct;
}

function renderAddOpts() {
  const pC  = { none: '', low: 'p-low', medium: 'p-med', high: 'p-high' };
  const pL  = { none: 'Priority', low: 'Low ·', medium: 'Medium ·', high: 'High ·' };
  const rOn = newRec !== 'none';

  let h = `<button class="pill ${pC[newPri] || ''}" onclick="cycleNewPri()" title="Set priority"><i class="ti ti-flag-3" style="font-size:10px"></i>${pL[newPri]}</button>`;
  h += `<input type="date" class="date-pill" value="${newDate}" onchange="setNewDate(this.value)" title="Set due date"/>`;
  h += `<button class="pill${rOn ? ' r-on' : ''}" onclick="cycleNewRec()" title="Set recurrence"><i class="ti ti-repeat" style="font-size:10px"></i>${REC_LBL[newRec]}</button>`;

  allTags.forEach((tag, i) => {
    const on = newSelTags.includes(tag);
    const c  = tc(tag);
    h += `<button class="pill${on ? ' t-on' : ''}" onclick="toggleNewTag(${i})" style="${on ? `background:${c.bg};color:${c.t};border-color:${c.b}` : ''}" title="Tag: ${esc(tag)}"><i class="ti ti-hash" style="font-size:10px"></i>${esc(tag)}</button>`;
  });

  if (showNtag) {
    h += `<input id="ntag-inp" class="ntag-inp" placeholder="tag name…" maxlength="20" style="display:inline-flex"
      onkeydown="if(event.key==='Enter')addNewTag();else if(event.key==='Escape'){showNtag=false;renderAddOpts();}"
      onblur="setTimeout(()=>{if(showNtag){showNtag=false;renderAddOpts();}},200)"/>`;
  } else {
    h += `<button class="pill" onclick="showNtagField()" title="Create a new tag"><i class="ti ti-plus" style="font-size:10px"></i>tag</button>`;
  }

  document.getElementById('add-opts').innerHTML = h;
}

let _usedTags = [];

function renderTagStrip() {
  _usedTags = [...new Set(todos.flatMap(t => t.tags || []))];
  const s   = document.getElementById('tag-strip');
  if (!_usedTags.length) { s.innerHTML = ''; return; }

  s.innerHTML = _usedTags.map(tag => {
    const c   = tc(tag);
    const act = tagFilter === tag;

    if (renamingTag === tag) {
      return `<span class="tag-chip" style="background:${c.bg};color:${c.t};border-color:${c.b};outline:1.5px solid ${c.b};outline-offset:1px;padding:2px 6px;">
        <input id="tag-rename-inp" value="${esc(tag)}" maxlength="20"
          style="width:72px;font-size:11px;border:none;background:transparent;outline:none;font-family:'Geist',sans-serif;color:${c.t};"
          onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();commitRenameTag();}else if(event.key==='Escape'){renamingTag=null;renderTagStrip();}"
          onblur="setTimeout(commitRenameTag,150)"/>
      </span>`;
    }

    return `<span class="tag-chip" style="background:${c.bg};color:${c.t};border-color:${c.b};${act ? `outline:1.5px solid ${c.b};outline-offset:1px` : ''}"
      onclick="setTagFilter('${esc(tag)}')">
      <span class="chip-lbl">#${esc(tag)}</span>
      <button class="chip-edit" onclick="event.stopPropagation();startRenameTag('${esc(tag)}')" title="Rename tag" aria-label="Rename tag"><i class="ti ti-pencil" style="font-size:9px"></i></button>
      <button class="chip-del"  onclick="event.stopPropagation();deleteTag('${esc(tag)}')"      title="Delete tag"  aria-label="Delete tag"><i class="ti ti-x"      style="font-size:9px"></i></button>
    </span>`;
  }).join('');
}

function renderList() {
  const list = document.getElementById('todo-list');
  const vis  = getVis();

  if (!vis.length) {
    const msgs = {
      all:    'ti-clipboard|No tasks yet — add one above',
      active: 'ti-circle-check|All done! Great work.',
      done:   'ti-clock|No completed tasks yet.',
    };
    const [ico, msg] = searchQ
      ? ['ti-search', `No results for "${searchQ}"`]
      : msgs[filter].split('|');
    list.innerHTML = `<div class="empty"><i class="ti ${ico}"></i>${esc(msg)}</div>`;
    return;
  }

  list.innerHTML = vis.map(renderTask).join('');
}

function renderTask(t) {
  const psC   = { none: 'ps-n', low: 'ps-l', medium: 'ps-m', high: 'ps-h' }[t.priority] || 'ps-n';
  const isSel = selIds.has(t.id);

  const txtH = editingId === t.id
    ? `<input id="edt-${t.id}" type="text" value="${esc(t.text)}" class="task-edt"
         onblur="saveEdit(${t.id})"
         onkeydown="if(event.key==='Enter')saveEdit(${t.id});else if(event.key==='Escape')cancelEdit()"/>`
    : `<span class="task-txt">${esc(t.text)}</span>`;

  const bChk = selMode
    ? `<div class="bulk-chk${isSel ? ' sel' : ''}" onclick="toggleSel(${t.id})" role="checkbox" aria-checked="${isSel}" aria-label="Select task"><i class="ti ti-check"></i></div>`
    : '';

  const meta = [];
  if (t.pinned) meta.push(`<span class="pin-badge"><i class="ti ti-pin" style="font-size:9px"></i>Pinned</span>`);
  if (t.dueDate) {
    const d = fmtDate(t.dueDate);
    if (d) meta.push(`<span class="due-tag ${d.cls}"><i class="ti ti-calendar" style="font-size:9px"></i>${esc(d.lbl)}</span>`);
  }
  if (t.recurring && t.recurring !== 'none') {
    meta.push(`<span class="rec-badge"><i class="ti ti-repeat" style="font-size:9px"></i>${t.recurring}</span>`);
  }
  if (t.estimate) {
    meta.push(`<span class="est-badge"><i class="ti ti-clock" style="font-size:9px"></i>${esc(t.estimate)}</span>`);
  }
  if (t.tags && t.tags.length) {
    t.tags.forEach(tag => {
      const c = tc(tag);
      meta.push(`<span class="due-tag" style="background:${c.bg};color:${c.t}">#${esc(tag)}</span>`);
    });
  }
  if (t.subtasks && t.subtasks.length) {
    const dn = t.subtasks.filter(s => s.done).length;
    meta.push(`<span class="sub-prog">${dn}/${t.subtasks.length} steps</span>`);
  }
  const metaH = meta.length ? `<div class="task-meta">${meta.join('')}</div>` : '';

  const subH = t.subtasks.map(s => `
    <div class="sub-r">
      <button class="sub-chk${s.done ? ' dn' : ''}" onclick="toggleSub(${t.id},${s.id})" aria-label="Toggle step"><i class="ti ti-check"></i></button>
      <span class="sub-txt${s.done ? ' dn' : ''}">${esc(s.text)}</span>
      <button class="sub-del" onclick="deleteSub(${t.id},${s.id})" aria-label="Delete step"><i class="ti ti-x"></i></button>
    </div>`).join('');

  const priOpts = ['none', 'low', 'medium', 'high'].map(p => {
    const lbl = { none: 'None', low: 'Low', medium: 'Medium', high: 'High' }[p];
    const sel = t.priority === p;
    return `<button class="opt-p${sel ? ' s-' + p[0] : ''}" onclick="setPriority(${t.id},'${p}')">${lbl}</button>`;
  }).join('');

  const recOpts = REC.map(r => {
    const lbl = { none: 'None', daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly', monthly: 'Monthly' }[r];
    const sel = (t.recurring || 'none') === r;
    return `<button class="opt-p${sel ? ' s-r' : ''}" onclick="setRecurring(${t.id},'${r}')">${lbl}</button>`;
  }).join('');

  const expPanel = `
    <div class="exp-panel${t.expanded ? ' op' : ''}" id="exp-${t.id}">
      <div class="ep-lbl">Priority</div>
      <div class="opt-row">${priOpts}</div>
      <div class="ep-lbl">Due date</div>
      <input type="date" class="date-pill ep-date" value="${t.dueDate || ''}" onchange="setDueDate(${t.id},this.value)"/>
      ${t.dueDate ? `<button class="ep-clear-date" onclick="setDueDate(${t.id},'')">Clear date</button>` : ''}
      <div class="ep-lbl">Repeat</div>
      <div class="opt-row">${recOpts}</div>
      <div class="ep-lbl">Time estimate</div>
      <input type="text" class="est-inp" placeholder="e.g. 30m, 2h, 1 day" maxlength="20" value="${esc(t.estimate || '')}"
        oninput="setEstimate(${t.id},this.value)"/>
      <div class="ep-lbl">Note</div>
      <textarea class="note-area" placeholder="Add a note…" oninput="saveNote(${t.id},this.value)">${esc(t.note || '')}</textarea>
      <div class="ep-lbl">Steps</div>
      <div class="sub-list">${subH}</div>
      <div class="sub-add-row">
        <input id="si-${t.id}" type="text" class="sub-add-inp" placeholder="Add a step…" maxlength="100"
          onkeydown="if(event.key==='Enter')addSubtask(${t.id})"/>
        <button class="sub-add-btn" onclick="addSubtask(${t.id})">Add</button>
      </div>
    </div>`;

  return `
    <div class="task-item${t.done ? ' is-dn' : ''}${t.pinned ? ' is-pinned' : ''}" id="ti-${t.id}"
      draggable="${!selMode}"
      ondragstart="onDragStart(event,${t.id})"
      ondragover="onDragOver(event,${t.id})"
      ondragend="onDragEnd()"
      ondrop="onDrop(event,${t.id})">
      <div class="task-row">
        ${bChk}
        <span class="grip"><i class="ti ti-grip-vertical"></i></span>
        <button id="chk-${t.id}" class="chk${t.done ? ' dn' : ''}" onclick="toggleTodo(${t.id})" aria-label="${t.done ? 'Mark incomplete' : 'Mark complete'}">
          <i class="ti ti-check"></i>
        </button>
        <div class="p-stripe ${psC}" title="Priority: ${t.priority}"></div>
        <div class="task-body">${txtH}${metaH}</div>
        <div class="row-acts">
          <button class="act-btn${t.pinned ? ' pin-act-on' : ''}" onclick="togglePin(${t.id})" title="${t.pinned ? 'Unpin' : 'Pin'}" aria-label="${t.pinned ? 'Unpin' : 'Pin'}">
            <i class="ti ti-pin"></i>
          </button>
          <button class="act-btn" onclick="startEdit(${t.id})" title="Edit task" aria-label="Edit">
            <i class="ti ti-pencil"></i>
          </button>
          <button class="act-btn exp-act${t.expanded ? ' op' : ''}" onclick="toggleExpand(${t.id})" title="Details" aria-label="Details">
            <i class="ti ti-chevron-down"></i>
          </button>
          <button class="act-btn del-act" onclick="deleteTodo(${t.id})" title="Delete task" aria-label="Delete">
            <i class="ti ti-trash"></i>
          </button>
        </div>
      </div>
      ${expPanel}
    </div>`;
}

function renderFtr() {
  const total = todos.length;
  const done  = todos.filter(t => t.done).length;
  const ftr   = document.getElementById('ftr');
  if (total > 0) {
    ftr.style.display = 'flex';
    document.getElementById('ftr-note').textContent = `${done} of ${total} completed`;
  } else {
    ftr.style.display = 'none';
  }
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const el     = document.activeElement;
  const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

  if (typing) {
    if (e.key === 'Escape') {
      el.blur();
      if (editingId) cancelEdit();
      if (el.id === 'search-inp') clearSearch();
    }
  } else {
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); document.getElementById('new-inp').focus(); }
    if (e.key === '/')                  { e.preventDefault(); document.getElementById('search-inp').focus(); }
    if (e.key === '?')                  { showView('help'); }
    if (e.key === 'd' || e.key === 'D') { toggleDark(); }
    if (e.key === 's' || e.key === 'S') {
      const sv = document.getElementById('stats-view');
      showView(sv && sv.style.display !== 'none' ? 'main' : 'stats');
    }
    if (e.key === 'Escape') { showView('main'); }
  }
});

document.getElementById('new-inp').addEventListener('keydown', e => {
  if (e.key === 'Enter') addTodo();
});

// ─── Init ─────────────────────────────────────────────────────────────────────
load();
