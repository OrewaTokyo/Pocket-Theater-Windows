window.PT = window.PT || {};

// One place that defines every shelf. "id" is what the phone saves, so never rename an id: Games is shown as Gaming.
PT.cats = [
  { id: 'Series', label: 'Series', icon: '\u{1F4FA}', accent: '#5ee0ff', main: true, blurb: 'Shows, seasons and binge nights' },
  { id: 'Anime', label: 'Anime', icon: '\u{1F365}', accent: '#ff7bb5', main: true, blurb: 'Episodes, OVAs and movies' },
  { id: 'Movies', label: 'Movies', icon: '\u{1F3AC}', accent: '#ffb547', main: true, blurb: 'Hollywood and beyond' },
  { id: 'Games', label: 'Gaming', icon: '\u{1F3AE}', accent: '#5cff9d', main: true, blurb: 'Gameplay, trailers and game files' },
  { id: 'Documents', label: 'Documents', icon: '\u{1F4DA}', accent: '#a39bc4', main: false, blurb: 'PDFs, books and notes' },
  { id: 'Other', label: 'Other', icon: '\u{1F4E6}', accent: '#a39bc4', main: false, blurb: 'Everything else' },
];

// Passwords the phone refuses (the same list as on the phone).
PT.commonPasswords = [
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123',
  '11111111', 'iloveyou', 'letmein1', 'welcome1', 'admin123', 'abc12345', 'pockettheater', '00000000',
];

PT.state = { server: null, me: null, shelves: null, online: true, mediaBase: '', info: null };

// ---- tiny event hub ----
PT.bus = {
  handlers: {},
  on(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); },
  off(name, fn) { this.handlers[name] = (this.handlers[name] || []).filter((h) => h !== fn); },
  emit(name, payload) { (this.handlers[name] || []).slice().forEach((fn) => { try { fn(payload); } catch (err) { console.error(err); } }); },
};

// ---- page elements ----
PT.util = {
  // File names come from the phone, so they are only ever inserted as text.
  el(tag, props, children) {
    const node = document.createElement(tag);
    const p = props || {};
    for (const key in p) {
      const value = p[key];
      if (value === undefined || value === null || value === false && key !== 'hidden' && key !== 'disabled') continue;
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else if (key === 'style') { for (const k in value) { if (k.startsWith('--')) node.style.setProperty(k, value[k]); else node.style[k] = value[k]; } }
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (typeof value === 'boolean') node[key] = value;
      else node.setAttribute(key, value);
    }
    (children || []).forEach((child) => { if (child) node.append(child); });
    return node;
  },
  size(bytes) {
    if (bytes < 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return bytes.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  },
  kind(entry) {
    if (entry.dir) return 'folder';
    const mime = (entry.mime || '').toLowerCase();
    const ext = entry.name.split('.').pop().toLowerCase();
    if (mime.startsWith('video/') || ['mp4', 'mkv', 'webm', 'm4v', 'mov', 'avi'].includes(ext)) return 'video';
    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
    if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (mime.startsWith('audio/') || ['mp3', 'm4a', 'flac', 'ogg', 'wav'].includes(ext)) return 'audio';
    return 'file';
  },
  icon(kind) {
    return { folder: '\u{1F4C1}', video: '\u{1F39E}\uFE0F', image: '\u{1F5BC}\uFE0F', pdf: '\u{1F4C4}', audio: '\u{1F3A7}', file: '\u{1F4E6}' }[kind];
  },
  cat(id) {
    return PT.cats.find((c) => c.id === id) || { id, label: id, icon: '\u{1F4E6}', accent: '#a39bc4', main: false, blurb: '' };
  },
  // Same rules as the phone. A sentence when something is wrong, otherwise null.
  usernameProblem(name) {
    return /^[a-z0-9_]{3,20}$/.test(name) ? null : 'Username must be 3 to 20 letters, numbers or _ (lowercase).';
  },
  passwordProblem(password, username) {
    if (password.length < 8) return 'Password needs at least 8 characters.';
    if (password.length > 64) return 'Password can be at most 64 characters.';
    if (PT.commonPasswords.includes(password.toLowerCase()) || new Set(password).size === 1) return 'That password is too easy to guess. Pick another one.';
    if (username && password.toLowerCase() === username) return "The password can't be your username.";
    return null;
  },
  clock(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },
  fingerprintLines(fp) {
    const bytes = String(fp || '').split(':');
    return [bytes.slice(0, 16).join(':'), bytes.slice(16).join(':')];
  },
  natural(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  },
};

// ---- talking to the app ----
// Every answer from the app is { ok, data } or { ok: false, error }. Errors become plain Error objects with a sentence.
PT.call = async function (channel, ...args) {
  const answer = await window.pt.invoke(channel, ...args);
  if (!answer || !answer.ok) {
    const e = new Error((answer && answer.error && answer.error.message) || 'Something went wrong.');
    e.code = answer && answer.error && answer.error.code;
    e.status = answer && answer.error && answer.error.status;
    throw e;
  }
  return answer.data;
};
PT.on = (channel, fn) => window.pt.on(channel, fn);

PT.api = {
  json(path) { return PT.call('api:get', path); },
  post(path, body) { return PT.call('api:post', path, body || {}); },
  me() { return PT.call('session:me'); },
  libraries() { return PT.api.json('/api/libraries'); },
  list(lib, parts) { return PT.api.json('/api/list?lib=' + encodeURIComponent(lib) + '&path=' + encodeURIComponent(parts.join('/'))); },
  // Links that only work on this PC. The app fetches the real file from the phone.
  fileUrl(lib, parts) { return PT.state.mediaBase + '/file?lib=' + encodeURIComponent(lib) + '&path=' + encodeURIComponent(parts.join('/')); },
  subtitleUrl(lib, parts) { return PT.state.mediaBase + '/subtitle?lib=' + encodeURIComponent(lib) + '&path=' + encodeURIComponent(parts.join('/')); },
};

// ---- small notices ----
PT.toast = function (text, kind) {
  const box = document.getElementById('toasts');
  const item = PT.util.el('div', { class: 'toast ' + (kind || ''), text });
  box.append(item);
  setTimeout(() => item.classList.add('out'), 3600);
  setTimeout(() => item.remove(), 4200);
};

/**
 * A dialog in the app's own look.
 * options: {
 *   title, body: [nodes],
 *   choices: [{ label, sub, value }]   a vertical list of big buttons; picking one closes the dialog
 *   check: { label, checked }          a tick box under the list; the answer then is { value, checked }
 *   actions: [{ label, value, kind }]  buttons along the bottom
 * }
 * Resolves with the chosen value, or null for Esc / clicking outside.
 */
PT.modal = function (options) {
  const el = PT.util.el;
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const previous = document.activeElement;
    const tick = options.check ? el('input', { type: 'checkbox', id: 'modal-check', checked: !!options.check.checked }) : null;
    const close = (value) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (previous && previous.focus) previous.focus();
      resolve(tick && value !== null ? { value, checked: tick.checked } : value);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(null); }
    };
    const actions = options.actions || (options.choices ? [{ label: 'Cancel', value: null, kind: 'ghost' }] : [{ label: 'OK', value: true, kind: 'go' }]);
    const buttons = actions.map((a) => el('button', { class: a.kind || 'ghost', type: 'button', text: a.label, onclick: () => close(a.value) }));
    const choices = (options.choices || []).map((c) => el('button', { class: 'choice', type: 'button', onclick: () => close(c.value) }, [
      el('strong', { text: c.label }),
      c.sub ? el('span', { class: 'note', text: c.sub }) : null,
    ]));
    const dialog = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': options.title }, [
      el('h2', { text: options.title }),
      el('div', { class: 'modal-body' }, (options.body || []).concat(choices.length ? [el('div', { class: 'choices' }, choices)] : [])),
      tick ? el('label', { class: 'check', for: 'modal-check' }, [tick, el('span', { text: options.check.label })]) : null,
      el('div', { class: 'modal-actions' }, buttons),
    ]);
    const overlay = el('div', { class: 'overlay' }, [dialog]);
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(null); });
    document.addEventListener('keydown', onKey, true);
    root.append(overlay);
    const first = dialog.querySelector('button.choice, button.go, button.danger') || buttons[buttons.length - 1];
    if (first) first.focus();
  });
};

PT.confirm = async function (title, text, okLabel, danger) {
  const result = await PT.modal({
    title,
    body: [PT.util.el('p', { text })],
    actions: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: okLabel || 'OK', value: true, kind: danger ? 'danger' : 'go' }],
  });
  return result === true;
};
