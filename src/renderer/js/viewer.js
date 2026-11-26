// The viewer: video, audio, images and PDFs, with subtitles, "continue where you stopped" and
// picking up again by itself when the phone comes back after a dropped connection.

// What was last watched, kept on this PC per phone. Only used for "Continue watching" and resuming.
PT.recent = (function () {
  const key = () => 'pt.recent.' + (PT.state.server ? PT.state.server.id : 'none');
  function read() {
    try { const v = JSON.parse(localStorage.getItem(key()) || '[]'); return Array.isArray(v) ? v : []; } catch (err) { return []; }
  }
  function write(list) {
    try { localStorage.setItem(key(), JSON.stringify(list.slice(0, 30))); } catch (err) { /* storage full or blocked: nothing to resume */ }
  }
  const same = (a, b) => a.lib === b.lib && a.parts.join('/') === b.parts.join('/');
  return {
    list() { return read().filter((r) => r.dur > 60 && r.pos > 10 && r.pos < r.dur - 30).slice(0, 6); },
    get(lib, parts) { return read().find((r) => same(r, { lib, parts })) || null; },
    save(lib, parts, pos, dur) {
      if (!(dur > 60)) return;
      const entry = { lib, parts, name: parts[parts.length - 1], pos: Math.floor(pos), dur: Math.floor(dur), at: Date.now() };
      write([entry].concat(read().filter((r) => !same(r, entry))));
    },
    forget(lib, parts) { write(read().filter((r) => !same(r, { lib, parts }))); },
    left(r) {
      const minutes = Math.max(1, Math.round((r.dur - r.pos) / 60));
      return minutes + (minutes === 1 ? ' minute left' : ' minutes left');
    },
  };
})();

PT.viewer = (function () {
  const el = PT.util.el;
  let state = null; // { lib, parts, entries, index, kind }

  const subLangKey = 'pt.subtitle';
  const autoNextKey = 'pt.autonext';
  const readFlag = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (err) { return d; } };
  const writeFlag = (k, v) => { try { localStorage.setItem(k, v); } catch (err) { /* ignore */ } };

  function root() { return document.getElementById('viewer-root'); }

  function close() {
    if (!state) return;
    stopMedia();
    root().replaceChildren();
    root().hidden = true;
    document.removeEventListener('keydown', onKey, true);
    if (state.opener && state.opener.focus) state.opener.focus();
    state = null;
  }

  function stopMedia() {
    const media = root().querySelector('video, audio');
    if (media) { saveProgress(media, true); media.pause(); media.removeAttribute('src'); media.load(); }
    if (state && state.unsubBack) state.unsubBack();
  }

  function open(options) {
    if (state) { stopMedia(); }
    state = { lib: options.lib, parts: options.parts, entries: options.entries, index: options.index, opener: document.activeElement };
    root().hidden = false;
    document.addEventListener('keydown', onKey, true);
    draw();
  }

  function go(step) {
    if (!state) return;
    const next = state.index + step;
    if (next < 0 || next >= state.entries.length) return;
    stopMedia();
    state.index = next;
    draw();
  }

  function onKey(event) {
    if (!state) return;
    if (event.key === 'Escape' && !document.getElementById('modal-root').children.length) {
      if (document.fullscreenElement) return; // Esc leaves full screen first
      event.preventDefault();
      close();
      return;
    }
    const tag = (event.target && event.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if ((event.ctrlKey && event.key === 'ArrowRight') || (event.key === 'ArrowRight' && state.kind === 'image')) { event.preventDefault(); go(1); }
    else if ((event.ctrlKey && event.key === 'ArrowLeft') || (event.key === 'ArrowLeft' && state.kind === 'image')) { event.preventDefault(); go(-1); }
    else if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.altKey) {
      const stage = root().querySelector('.stage');
      if (!stage) return;
      event.preventDefault();
      if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen().catch(() => {});
    }
  }

  // ---- drawing ----

  function draw() {
    const entry = state.entries[state.index];
    const kind = PT.util.kind(entry);
    state.kind = kind;
    const entryParts = state.parts.concat(entry.name);
    const stage = el('div', { class: 'stage' });
    const side = [];

    const prev = el('button', { class: 'ghost small', type: 'button', text: '\u2039 Previous', disabled: state.index === 0, onclick: () => go(-1), title: 'Previous (Ctrl+Left)' });
    const next = el('button', { class: 'ghost small', type: 'button', text: 'Next \u203A', disabled: state.index === state.entries.length - 1, onclick: () => go(1), title: 'Next (Ctrl+Right)' });
    if (kind === 'video' || kind === 'audio') {
      side.push(el('button', { class: 'ghost small', type: 'button', text: 'Play in VLC', title: 'Play in an outside player', onclick: () => PT.files.playOutside(state.lib, entryParts) }));
    }
    side.push(el('button', { class: 'ghost small', type: 'button', text: 'Save', onclick: () => PT.files.save(state.lib, entryParts) }));
    if (kind === 'pdf' || kind === 'image') {
      side.push(el('button', { class: 'ghost small', type: 'button', text: 'Open in Windows', onclick: () => PT.files.openDefault(state.lib, entryParts) }));
    }
    const bar = el('div', { class: 'viewer-bar' }, [
      el('button', { class: 'ghost', type: 'button', text: '\u2190 Close', onclick: close, title: 'Close (Esc)' }),
      el('div', { class: 'viewer-title' }, [el('strong', { text: entry.name }), el('span', { class: 'note', text: (state.index + 1) + ' of ' + state.entries.length })]),
      el('div', { class: 'viewer-tools' }, side),
      prev, next,
    ]);
    root().replaceChildren(el('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': entry.name }, [bar, stage]));

    if (kind === 'video' || kind === 'audio') mediaStage(stage, entry, kind, entryParts);
    else if (kind === 'image') imageStage(stage, entry, entryParts);
    else pdfStage(stage, entry, entryParts);
    const focusTarget = root().querySelector('video, audio, .viewer-bar button');
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }

  function imageStage(stage, entry, entryParts) {
    const img = el('img', { class: 'fit', alt: entry.name, src: PT.api.fileUrl(state.lib, entryParts) });
    img.addEventListener('click', () => img.classList.toggle('fit'));
    img.addEventListener('error', () => stage.replaceChildren(problem('This picture could not be loaded.', entry.name, entryParts)));
    stage.append(img);
  }

  function pdfStage(stage, entry, entryParts) {
    const frame = el('iframe', { class: 'pdf', title: entry.name, src: PT.api.fileUrl(state.lib, entryParts) });
    stage.append(frame);
  }

  function problem(message, name, entryParts, hint) {
    const buttons = [
      el('button', { class: 'go', type: 'button', text: 'Play in VLC', onclick: () => PT.files.playOutside(state.lib, entryParts) }),
      el('button', { class: 'ghost', type: 'button', text: 'Open in Windows', onclick: () => PT.files.openDefault(state.lib, entryParts) }),
      el('button', { class: 'ghost', type: 'button', text: 'Save', onclick: () => PT.files.save(state.lib, entryParts) }),
    ];
    return el('div', { class: 'problem' }, [
      el('p', { class: 'problem-title', text: message }),
      hint ? el('p', { class: 'note', text: hint }) : null,
      el('div', { class: 'row-actions' }, buttons),
    ]);
  }

  // ---- video and audio ----

  function saveProgress(media, force) {
    if (!state || !media || !(media.duration > 60)) return;
    const now = Date.now();
    if (!force && now - (state.lastSaved || 0) < 5000) return;
    state.lastSaved = now;
    const parts = state.parts.concat(state.entries[state.index].name);
    if (media.currentTime > media.duration - 30) PT.recent.forget(state.lib, parts);
    else if (media.currentTime > 5) PT.recent.save(state.lib, parts, media.currentTime, media.duration);
  }

  function mediaStage(stage, entry, kind, entryParts) {
    const media = el(kind === 'video' ? 'video' : 'audio', { class: kind === 'video' ? 'player' : 'player audio', controls: true, autoplay: true, preload: 'auto', crossorigin: 'anonymous' });
    const status = el('p', { class: 'player-status', role: 'status', hidden: true });
    let resumeAt = 0;
    const saved = PT.recent.get(state.lib, entryParts);
    if (saved && saved.pos > 10 && saved.pos < saved.dur - 30) resumeAt = saved.pos;
    let retries = 0;
    let waiting = false;

    const load = (at) => {
      media.src = PT.api.fileUrl(state.lib, entryParts);
      media.dataset.start = String(at || 0);
      media.load();
    };

    media.addEventListener('loadedmetadata', () => {
      const at = Number(media.dataset.start || 0);
      if (at > 0 && at < (media.duration || Infinity)) media.currentTime = at;
      media.dataset.start = '0';
      status.hidden = true;
      retries = 0;
      waiting = false;
    });
    media.addEventListener('timeupdate', () => saveProgress(media, false));
    media.addEventListener('pause', () => saveProgress(media, true));
    media.addEventListener('ended', () => {
      PT.recent.forget(state.lib, entryParts);
      if (readFlag(autoNextKey, '1') === '1' && state.index < state.entries.length - 1) go(1);
    });

    // A dropped connection is not the end of the film: wait for the phone and carry on from the same second.
    media.addEventListener('error', () => {
      const code = media.error ? media.error.code : 0;
      const at = media.currentTime || Number(media.dataset.start || 0);
      const cutOff = code === 2 || (code === 4 && !PT.state.online);
      if (cutOff && retries < 6) {
        retries++;
        waiting = true;
        status.textContent = 'The connection to the phone was lost. Playback continues when it is back\u2026';
        status.hidden = false;
        const resume = () => {
          if (!state || state.entries[state.index] !== entry || !waiting) return;
          status.textContent = 'Reconnecting\u2026';
          load(at);
        };
        if (PT.state.online) setTimeout(resume, 1500);
        else state.unsubBack = once('back', resume);
        return;
      }
      stage.replaceChildren(problem(
        code === 4 ? 'Windows can\u2019t play this kind of video here.' : 'This could not be played.',
        entry.name, entryParts,
        code === 4 ? 'VLC plays almost everything. If it is installed, use the button below.' : 'Check the connection to the phone and try again.'
      ));
    });

    // Subtitles from the phone arrive as WebVTT, so the player can show them as they are.
    const subs = Array.isArray(entry.subs) ? entry.subs : [];
    const preferred = readFlag(subLangKey, '');
    subs.forEach((s) => {
      const track = el('track', { kind: 'subtitles', label: s.label || s.lang || 'Subtitles', srclang: s.lang || 'und', src: PT.api.subtitleUrl(state.lib, s.path.split('/')) });
      media.append(track);
    });
    if (subs.length) {
      media.addEventListener('loadedmetadata', () => {
        const tracks = Array.from(media.textTracks);
        tracks.forEach((t) => { t.mode = preferred && (t.language === preferred || t.label === preferred) ? 'showing' : 'disabled'; });
        tracks.forEach((t) => t.addEventListener('change', () => { if (t.mode === 'showing') writeFlag(subLangKey, t.language || t.label); }));
      }, { once: true });
    }

    const wrap = el('div', { class: 'player-wrap' }, [
      kind === 'audio' ? el('div', { class: 'audio-art', text: '\u{1F3A7}' }) : null,
      media,
      status,
    ]);
    const autoNext = el('input', { type: 'checkbox', id: 'autonext', checked: readFlag(autoNextKey, '1') === '1' });
    autoNext.addEventListener('change', () => writeFlag(autoNextKey, autoNext.checked ? '1' : '0'));
    stage.append(wrap);
    if (state.entries.length > 1) stage.append(el('label', { class: 'check autonext', for: 'autonext' }, [autoNext, el('span', { text: 'Play the next one automatically' })]));
    load(resumeAt);
  }

  // Runs `fn` the next time the named event fires, and gives back a way to cancel.
  function once(name, fn) {
    const handler = () => { PT.bus.off(name, handler); fn(); };
    PT.bus.on(name, handler);
    return () => PT.bus.off(name, handler);
  }

  return { open, close, isOpen: () => !!state };
})();
