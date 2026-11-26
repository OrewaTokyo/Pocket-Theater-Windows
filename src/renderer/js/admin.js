PT.pages = PT.pages || {};

// The admin page, the same as on the phone's website. It opens after the phone scans the admin QR code and the
// admin types the password. It closes by itself after 30 minutes without use, and the phone can end it at any time.
PT.pages.admin = (function () {
  const el = PT.util.el;
  let timer = null;
  let host = null;
  let notice = null; // { kind, text, secret }
  let busy = false;

  function stop() {
    clearInterval(timer);
    timer = null;
    host = null;
  }

  function button(label, cls, onClick) {
    return el('button', { class: cls, type: 'button', text: label, onclick: onClick });
  }

  async function act(url, body, done) {
    try {
      const result = await PT.api.post(url, body);
      notice = result.password
        ? { kind: 'ok', text: 'New password for ' + body.name + ':', secret: result.password }
        : { kind: 'ok', text: done };
    } catch (err) {
      notice = { kind: 'error', text: err.message };
    }
    draw();
  }

  function stat(label, value, sub) {
    return el('div', { class: 'stat' }, [
      el('p', { class: 'stat-label', text: label }),
      el('p', { class: 'stat-value', text: value }),
      el('p', { class: 'note', text: sub }),
    ]);
  }

  function section(title, children) {
    return el('section', { class: 'panel' }, [el('h2', { text: title })].concat(children));
  }

  function row(title, sub, actions) {
    return el('div', { class: 'arow' }, [
      el('div', { class: 'arow-text' }, [el('strong', { text: title }), el('span', { class: 'note', text: sub })]),
      el('div', { class: 'arow-actions' }, actions),
    ]);
  }

  async function draw() {
    const mine = host;
    if (!mine || busy) return;
    busy = true;
    let overview, users, devices;
    try {
      [overview, users, devices] = await Promise.all([
        PT.api.json('/api/admin/overview'),
        PT.api.json('/api/admin/users'),
        PT.api.json('/api/admin/devices'),
      ]);
    } catch (err) {
      busy = false;
      if (host !== mine) return;
      stop();
      mine.replaceChildren(
        el('h1', { text: 'Admin' }),
        el('p', { class: 'error', role: 'alert', text: err.message }),
        el('p', { class: 'note', text: 'Start it again with Admin sign-in in the sidebar.' })
      );
      return;
    }
    busy = false;
    if (host !== mine) return; // the person went somewhere else while this loaded

    const parts = [];
    parts.push(el('div', { class: 'admin-head' }, [
      el('div', {}, [
        el('h1', { text: 'Admin' }),
        el('p', { class: 'note', text: 'Opened from the phone. It closes by itself after 30 minutes without use.' }),
      ]),
      button('End admin session', 'ghost', async () => {
        try { await PT.api.post('/api/admin/end', {}); } catch (err) { /* already closed */ }
        stop();
        location.hash = '#/';
      }),
    ]));

    if (notice) {
      const box = el('div', { class: 'notice ' + notice.kind, role: 'status' }, [el('span', { text: notice.text + ' ' })]);
      if (notice.secret) box.append(el('code', { text: notice.secret }), el('span', { text: ' Give it to them. They can change it on their Account page.' }));
      box.append(button('Dismiss', 'ghost small', () => { notice = null; draw(); }));
      parts.push(box);
    }

    parts.push(el('div', { class: 'stats' }, [
      stat('Awake', overview.awake, 'Total ' + overview.awake_total),
      stat('Users', String(overview.members), overview.online + ' online, ' + overview.waiting + ' waiting'),
      stat('Data sent', overview.data_total, 'This session ' + overview.data_session),
      stat('Requests', overview.requests_total, 'This session ' + overview.requests_session),
      stat('Phone', overview.cpu + '% CPU', overview.ram + '% RAM'),
      stat('Battery', overview.battery + '%', overview.charging ? 'Charging' : 'On battery'),
    ]));

    parts.push(section('Sign-up requests', users.pending.length
      ? users.pending.map((p) => row(p.name, 'Asked at ' + PT.util.clock(p.created), [
        button('Approve', 'go small', () => act('/api/admin/user', { action: 'approve', name: p.name }, p.name + ' was approved.')),
        button('Decline', 'ghost small', () => act('/api/admin/user', { action: 'decline', name: p.name }, p.name + ' was declined.')),
      ]))
      : [el('p', { class: 'note', text: 'No one is waiting.' })]));

    parts.push(section('Accounts', users.members.length
      ? users.members.map((m) => row(m.name, m.status === 'off' ? 'Turned off' : 'Active', [
        button(m.status === 'off' ? 'Turn on' : 'Turn off', 'ghost small', () =>
          act('/api/admin/user', { action: m.status === 'off' ? 'on' : 'off', name: m.name }, m.name + ' was updated.')),
        button('Reset password', 'ghost small', async () => {
          if (await PT.confirm('Reset the password for ' + m.name + '?', 'They will be signed out.', 'Reset')) act('/api/admin/user', { action: 'reset', name: m.name });
        }),
        button('Delete', 'danger small', async () => {
          if (await PT.confirm('Delete ' + m.name + '?', 'They will have to ask for access again.', 'Delete', true)) act('/api/admin/user', { action: 'delete', name: m.name }, m.name + ' was deleted.');
        }),
      ]))
      : [el('p', { class: 'note', text: 'No one has an account yet.' })]));

    parts.push(section('Devices', devices.devices.map((d) => {
      const tags = (d.you ? ' (this device)' : '') + (d.admin ? ' - admin' : '');
      const actions = [];
      if (d.admin && !d.you) actions.push(button('End admin', 'ghost small', () => act('/api/admin/device', { action: 'revoke', id: d.id }, 'Admin ended on ' + d.label + '.')));
      if (!d.you) {
        actions.push(button('Sign out', 'danger small', async () => {
          if (await PT.confirm('Sign out ' + d.label + '?', d.user + ' will have to sign in again on that device.', 'Sign out', true)) act('/api/admin/device', { action: 'signout', id: d.id }, d.label + ' was signed out.');
        }));
      }
      return row(d.label + tags, d.user + ' \u00B7 ' + d.ip + ' \u00B7 signed in ' + PT.util.clock(d.since), actions);
    })));

    mine.replaceChildren(...parts);
  }

  function open(main) {
    stop();
    host = main;
    notice = null;
    busy = false;
    main.replaceChildren(PT.pages.loading());
    draw();
    timer = setInterval(() => {
      if (location.hash.indexOf('#/admin') !== 0) stop();
      else draw();
    }, 5000);
  }

  open.stop = stop;
  return open;
})();
