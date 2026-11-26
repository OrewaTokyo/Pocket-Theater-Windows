// The theater itself: sidebar, pages, the connection banner and the admin sign-in code.
PT.pages = PT.pages || {};

PT.shell = (function () {
  const el = PT.util.el;
  let active = false;
  let backTimer = null;
  let routeToken = 0;

  function root() { return document.getElementById('root'); }

  function build() {
    root().replaceChildren(el('div', { class: 'shell' }, [
      el('aside', { class: 'side' }, [
        el('a', { class: 'side-brand', href: '#/', 'aria-label': 'Pocket Theater home' }, [el('span', { text: '\u{1F39F}\uFE0F' }), el('strong', { text: 'Pocket Theater' })]),
        el('nav', { id: 'nav', 'aria-label': 'Main' }),
        el('div', { class: 'side-foot' }, [
          el('div', { class: 'who', id: 'who' }),
          el('div', { class: 'conn', id: 'conn' }),
          el('button', { class: 'ghost small', type: 'button', text: 'Switch phone', onclick: switchPhone }),
        ]),
      ]),
      el('section', { class: 'content' }, [el('div', { id: 'main', tabindex: '-1' })]),
    ]));
    drawFoot();
  }

  async function switchPhone() {
    await PT.call('servers:disconnect').catch(() => {});
    PT.views.phones();
  }

  function drawFoot() {
    const me = PT.state.me;
    const who = document.getElementById('who');
    const conn = document.getElementById('conn');
    if (who && me) who.textContent = '\u{1F464} ' + me.username;
    if (conn && PT.state.server) {
      conn.replaceChildren(
        el('span', { class: PT.state.online ? 'dot ok' : 'dot bad' }),
        el('span', { text: PT.state.server.name })
      );
      conn.title = PT.state.server.host + ':' + PT.state.server.port + (PT.state.server.secure ? ' (secure)' : ' (not encrypted)');
    }
  }

  // ---- navigation list ----

  function currentSection() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (parts[0] === 'cat') return decodeURIComponent(parts[1] || '');
    if (parts[0] === 'admin') return 'Admin';
    if (parts[0] === 'account') return 'Account';
    if (parts[0] === 'lib') return '';
    return 'Home';
  }

  function drawNav(activeId) {
    const nav = document.getElementById('nav');
    if (!nav) return;
    const me = PT.state.me || {};
    const item = (id, icon, label, href, accent) => el('a', {
      class: 'nav-item' + (activeId === id ? ' active' : ''), href, 'aria-current': activeId === id ? 'page' : undefined,
      style: accent ? { '--accent': accent } : undefined,
    }, [el('span', { class: 'nav-icon', text: icon }), el('span', { text: label })]);
    const list = [item('Home', '\u{1F3E0}', 'Home', '#/')];
    PT.cats.forEach((c) => {
      if (PT.state.shelves && PT.state.shelves.has(c.id)) list.push(item(c.id, c.icon, c.label, '#/cat/' + encodeURIComponent(c.id), c.accent));
    });
    list.push(el('div', { class: 'nav-gap' }));
    if (me.admin) list.push(item('Admin', '\u{1F6E0}\uFE0F', 'Admin', '#/admin'));
    else if (me.admin_ready && PT.state.server && PT.state.server.secure) {
      list.push(el('button', { class: 'nav-item', type: 'button', onclick: () => PT.pairing.start() }, [el('span', { class: 'nav-icon', text: '\u{1F6E0}\uFE0F' }), el('span', { text: 'Admin sign-in' })]));
    }
    list.push(item('Account', '\u{1F464}', 'Account', '#/account'));
    nav.replaceChildren(...list);
  }

  // ---- pages ----

  function route() {
    if (!active) return;
    routeToken++;
    PT.renderId = routeToken; // an older page that finishes loading late must not draw over a newer one
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map((part) => {
      try { return decodeURIComponent(part); } catch (err) { return part; } // a damaged link must not blank the page
    });
    const main = document.getElementById('main');
    if (!main) return;
    PT.viewer.close();
    if (parts[0] !== 'admin' && PT.pages.admin) PT.pages.admin.stop();
    drawNav(currentSection());
    const content = main.parentElement;
    if (content) content.scrollTop = 0;
    if (parts[0] === 'admin' && PT.state.me && PT.state.me.admin) PT.pages.admin(main);
    else if (parts[0] === 'account') PT.pages.account(main);
    else if (parts[0] === 'lib' && parts[1]) PT.pages.library(main, parts[1], parts.slice(2), routeToken);
    else if (parts[0] === 'cat' && parts[1]) PT.pages.home(main, parts[1], routeToken);
    else PT.pages.home(main, null, routeToken);
  }

  async function loadShelves() {
    try {
      const data = await PT.api.libraries();
      PT.state.libraries = data.libraries;
      PT.state.shelves = new Set(data.libraries.map((l) => l.category));
      drawNav(currentSection());
    } catch (err) { /* the page shows its own error */ }
  }

  // ---- the connection ----

  function banner(kind, text) {
    const b = document.getElementById('banner');
    clearTimeout(backTimer);
    if (!kind) { b.hidden = true; return; }
    b.className = 'banner ' + kind;
    b.textContent = text;
    b.hidden = false;
    if (kind === 'online') backTimer = setTimeout(() => { b.hidden = true; }, 2600);
  }

  function onStatus(status) {
    if (!active) return;
    const was = PT.state.online;
    PT.state.online = status.online;
    if (!status.online && was) banner('offline', 'Lost the connection to the phone. Trying to reconnect\u2026');
    if (status.online && !was) { banner('online', 'Back online.'); PT.bus.emit('back'); }
    if (status.me) {
      const changed = JSON.stringify(status.me) !== JSON.stringify(PT.state.me);
      const hadAdmin = !!(PT.state.me && PT.state.me.admin);
      PT.state.me = status.me;
      if (changed) {
        drawNav(currentSection());
        drawFoot();
        PT.bus.emit('me', status.me);
        if (hadAdmin && !status.me.admin && location.hash.indexOf('#/admin') === 0) {
          location.hash = '#/';
          PT.toast('The admin session ended.');
        }
      }
    }
    drawFoot();
  }

  function onSignedOut() {
    if (!active || !PT.state.server) return;
    PT.views.auth(PT.state.server, 'You were signed out. Sign in again to carry on.');
  }

  PT.bus.on('back', () => {
    if (!active) return;
    loadShelves();
    if (document.querySelector('#main .error')) route();
  });

  return {
    start(me) {
      PT.state.me = me;
      PT.state.online = true;
      PT.state.shelves = null;
      PT.state.libraries = null;
      active = true;
      build();
      window.addEventListener('hashchange', route);
      loadShelves();
      route();
      PT.files.refreshPlayer(); // in the background: only used for tooltips and the Account page
    },
    leave() {
      if (!active) return;
      active = false;
      window.removeEventListener('hashchange', route);
      if (PT.pages.admin) PT.pages.admin.stop();
      PT.viewer.close();
      PT.pairing.close(true);
      banner(null);
      PT.call('monitor:fast', false).catch(() => {});
    },
    onStatus, onSignedOut, route, loadShelves,
    refreshNav() { drawNav(currentSection()); },
  };
})();

// ---- the admin sign-in code ----
// The phone shows no admin page of its own. It scans this QR code, the admin types the password on the phone,
// and this PC is then allowed to open the Admin page.
PT.pairing = (function () {
  const el = PT.util.el;
  let overlay = null;
  let countdown = null;
  let expiresAt = 0;
  let lastCode = '';
  let unsub = null;

  function close(quiet) {
    clearInterval(countdown);
    countdown = null;
    if (overlay) { overlay.remove(); overlay = null; }
    lastCode = '';
    if (!quiet) PT.call('monitor:fast', false).catch(() => {});
  }

  function fmt(seconds) {
    const s = Math.max(0, Math.round(seconds));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  async function show(pair) {
    if (!overlay) return;
    const box = overlay.querySelector('.pair-body');
    expiresAt = Date.now() + (pair.expires_in || 0) * 1000;
    let qr = null;
    try { qr = await PT.call('pair:qr'); } catch (err) { /* the code under it still works */ }
    if (!overlay) return;
    box.replaceChildren(
      qr ? el('img', { class: 'qr', src: qr, alt: 'QR code to scan with the phone', width: '200', height: '200' }) : null,
      el('p', { class: 'pair-code', text: pair.code }),
      el('p', { class: 'note', id: 'pair-status', text: 'Waiting for the phone\u2026' }),
      el('p', { class: 'note', id: 'pair-time' })
    );
    tick();
  }

  function tick() {
    const time = document.getElementById('pair-time');
    if (!time) return;
    const left = (expiresAt - Date.now()) / 1000;
    time.textContent = left > 0 ? 'The code runs out in ' + fmt(left) : '';
  }

  function onMe(me) {
    if (!overlay) return;
    if (me.admin) {
      close();
      location.hash = '#/admin';
      PT.toast('Admin opened on this PC.', 'ok');
      return;
    }
    const status = document.getElementById('pair-status');
    if (me.pair) {
      if (me.pair.code !== lastCode) { lastCode = me.pair.code; show(me.pair); }
      if (status) status.textContent = me.pair.scanned ? 'Scanned. Now type the admin password on the phone.' : 'Waiting for the phone\u2026';
    } else if (status && lastCode) {
      status.textContent = 'The code ran out. Close this and try again.';
      status.classList.add('error');
    }
  }

  return {
    close,
    async start() {
      if (overlay) return;
      let pair;
      try { pair = await PT.api.post('/api/pair/start'); } catch (err) { PT.toast(err.message, 'error'); return; }
      lastCode = pair.code;
      const cancel = async () => {
        await PT.api.post('/api/pair/cancel').catch(() => {});
        close();
      };
      overlay = el('div', { class: 'overlay' }, [el('div', { class: 'modal pair', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Admin sign-in' }, [
        el('h2', { text: 'Admin sign-in' }),
        el('p', { text: 'On the phone open Profile, then Scan admin QR, and scan this code. Then type your admin password on the phone.' }),
        el('div', { class: 'pair-body' }),
        el('div', { class: 'modal-actions' }, [el('button', { class: 'ghost', type: 'button', text: 'Cancel', onclick: cancel })]),
      ])]);
      document.getElementById('modal-root').append(overlay);
      overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') cancel(); });
      PT.call('monitor:fast', true).catch(() => {});
      clearInterval(countdown);
      countdown = setInterval(tick, 1000);
      if (!unsub) { PT.bus.on('me', onMe); unsub = true; }
      show(pair);
      overlay.querySelector('button').focus();
    },
  };
})();
