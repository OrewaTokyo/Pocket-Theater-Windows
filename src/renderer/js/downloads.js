// Saving and opening files, playing in an outside player, and the small downloads panel.
PT.files = (function () {
  const el = PT.util.el;
  const items = new Map();

  function panel() { return document.getElementById('downloads'); }

  function draw() {
    const box = panel();
    if (!box) return;
    box.hidden = items.size === 0;
    box.replaceChildren(...Array.from(items.values()).map((d) => {
      const pct = d.total > 0 ? Math.min(100, Math.round((d.received / d.total) * 100)) : null;
      let line;
      let actions = [];
      if (d.state === 'running') {
        line = d.opening ? 'Getting ready to open\u2026 ' : 'Saving\u2026 ';
        line += pct === null ? PT.util.size(d.received) : pct + '% of ' + PT.util.size(d.total);
        actions = [el('button', { class: 'ghost small', type: 'button', text: 'Cancel', onclick: () => PT.call('file:cancel', d.id).catch(() => {}) })];
      } else if (d.state === 'done') {
        line = d.opening ? 'Opened in Windows' : 'Saved \u00B7 ' + PT.util.size(d.received);
        if (!d.opening) actions.push(el('button', { class: 'ghost small', type: 'button', text: 'Show in folder', onclick: () => PT.call('file:reveal', d.id).catch((err) => PT.toast(err.message, 'error')) }));
        actions.push(el('button', { class: 'ghost small', type: 'button', text: 'Dismiss', onclick: () => { items.delete(d.id); draw(); } }));
      } else {
        line = d.message || 'The download failed.';
        actions = [el('button', { class: 'ghost small', type: 'button', text: 'Dismiss', onclick: () => { items.delete(d.id); draw(); } })];
      }
      return el('div', { class: 'dl ' + d.state }, [
        el('strong', { class: 'dl-name', text: d.name, title: d.name }),
        el('span', { class: d.state === 'error' ? 'error' : 'note', text: line }),
        d.state === 'running' ? el('span', { class: 'bar' }, [el('span', { class: pct === null ? 'bar-fill busy' : 'bar-fill', style: pct === null ? {} : { width: pct + '%' } })]) : null,
        el('div', { class: 'row-actions' }, actions),
      ]);
    }));
  }

  PT.on('download:progress', (p) => {
    if (p.state === 'canceled') { items.delete(p.id); draw(); return; }
    const old = items.get(p.id) || {};
    items.set(p.id, Object.assign({}, old, p));
    draw();
    if (p.state === 'done' && p.opening) setTimeout(() => { items.delete(p.id); draw(); }, 3500);
  });

  // ---- outside video players ----

  /** Asks which player to use, from the ones found on this PC. Resolves { type, path?, remember } or null. */
  async function pickPlayer(options) {
    const opts = options || {};
    let list = [];
    try { list = (await PT.call('player:list')).players; } catch (err) { /* shown as "none found" */ }
    const choices = list.map((p) => ({ label: p.name, sub: p.path, value: { type: 'player', path: p.path, name: p.name } }));
    choices.push({ label: 'Browse for another player\u2026', sub: 'Pick the program (.exe) yourself', value: { type: 'browse' } });
    if (!opts.setDefault) choices.push({ label: 'Open in the Windows player', sub: 'Saves the video to a temporary place first, then opens it', value: { type: 'windows' } });
    if (!list.some((p) => p.name === 'VLC')) choices.push({ label: 'Get VLC (free)', sub: 'Opens the VLC website. It plays almost every video.', value: { type: 'site' } });
    const answer = await PT.modal({
      title: list.length ? 'Choose a video player' : 'No video player found',
      body: [el('p', { class: 'note', text: list.length
        ? 'These video players are installed on this PC.'
        : 'Windows\u2019 own player may not play every video. VLC is free and plays almost everything.' })],
      choices,
      check: opts.setDefault ? null : { label: 'Always use the one I choose', checked: true },
    });
    if (answer === null) return null;
    const value = opts.setDefault ? answer : answer.value;
    const remember = opts.setDefault ? true : !!answer.checked;
    if (value.type === 'browse') {
      try {
        const picked = await PT.call('player:choose');
        if (picked.canceled) return null;
        return { type: 'player', path: picked.path, name: picked.name, remember };
      } catch (err) { PT.toast(err.message, 'error'); return null; }
    }
    return Object.assign({}, value, { remember });
  }

  const label = () => 'Play in player';
  const hint = () => (PT.state.player ? 'Play in ' + PT.state.player : 'Play in an outside video player');

  return {
    playLabel: label,
    playHint: hint,
    async refreshPlayer() {
      try { PT.state.player = (await PT.call('player:info')).player; } catch (err) { PT.state.player = null; }
    },
    /** Account page: choose the player to use from now on. */
    async chooseDefaultPlayer() {
      const pick = await pickPlayer({ setDefault: true });
      if (!pick) return false;
      if (pick.type === 'site') { PT.call('app:openHelp', 'vlc').catch((err) => PT.toast(err.message, 'error')); return false; }
      if (pick.type !== 'player') return false;
      try {
        const r = await PT.call('player:set', { path: pick.path });
        PT.state.player = r.player;
        PT.toast('Using ' + r.player);
        return true;
      } catch (err) { PT.toast(err.message, 'error'); return false; }
    },
    async save(lib, parts) {
      try {
        const r = await PT.call('file:save', { lib, parts });
        if (!r.canceled) PT.toast('Saving ' + r.name + '\u2026');
      } catch (err) { PT.toast(err.message, 'error'); }
    },
    async openDefault(lib, parts) {
      try { await PT.call('file:open', { lib, parts }); } catch (err) {
        if (err.code === 'UNSAFE') {
          const save = await PT.modal({
            title: 'This file can run programs',
            body: [el('p', { text: err.message })],
            actions: [{ label: 'Close', value: false, kind: 'ghost' }, { label: 'Save it instead', value: true, kind: 'go' }],
          });
          if (save === true) PT.files.save(lib, parts);
        } else {
          PT.toast(err.message, 'error');
        }
      }
    },
    /** Plays a video in an outside player. If none is chosen (and there is no VLC), the installed players are listed. */
    async playOutside(lib, parts, playerPath, remember) {
      try {
        const r = await PT.call('player:launch', { lib, parts, playerPath, remember });
        PT.state.player = remember || !playerPath ? r.player : PT.state.player;
        PT.toast('Opened in ' + r.player);
      } catch (err) {
        if (err.code !== 'NO_PLAYER') { PT.toast(err.message, 'error'); return; }
        const pick = await pickPlayer();
        if (!pick) return;
        if (pick.type === 'player') return PT.files.playOutside(lib, parts, pick.path, pick.remember);
        if (pick.type === 'windows') return PT.files.openDefault(lib, parts);
        if (pick.type === 'site') PT.call('app:openHelp', 'vlc').catch((e) => PT.toast(e.message, 'error'));
      }
    },
  };
})();
