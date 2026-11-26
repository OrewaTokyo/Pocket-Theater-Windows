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

  return {
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
    async playOutside(lib, parts) {
      try {
        const r = await PT.call('player:launch', { lib, parts });
        PT.toast('Opened in ' + r.player);
      } catch (err) {
        if (err.code !== 'NO_PLAYER') { PT.toast(err.message, 'error'); return; }
        const choose = await PT.modal({
          title: 'No outside player found',
          body: [el('p', { text: 'VLC plays almost every kind of video. Install it, or choose another player on this PC.' })],
          actions: [{ label: 'Close', value: false, kind: 'ghost' }, { label: 'Choose a player\u2026', value: true, kind: 'go' }],
        });
        if (choose === true) {
          try {
            const picked = await PT.call('player:choose');
            if (picked.player) { PT.toast('Using ' + picked.player); PT.files.playOutside(lib, parts); }
          } catch (e) { PT.toast(e.message, 'error'); }
        }
      }
    },
  };
})();
