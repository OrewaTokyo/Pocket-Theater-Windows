// The screens before the theater: pick a phone, add a phone (and check its certificate), connect, sign in.
PT.views = PT.views || {};

(function () {
  const el = PT.util.el;
  const root = () => document.getElementById('root');

  function brand() {
    return el('div', { class: 'brand-big' }, [
      el('span', { class: 'brand-mark', text: '\u{1F39F}\uFE0F' }),
      el('div', {}, [el('h1', { text: 'Pocket Theater' }), el('p', { class: 'note', text: 'Your phone\u2019s shared folders, on this PC' })]),
    ]);
  }

  function screen(children, wide) {
    if (PT.shell) PT.shell.leave();
    root().replaceChildren(el('div', { class: 'center' }, [el('div', { class: 'card' + (wide ? ' wide' : '') }, [brand()].concat(children, [PT.docs.links()]))]));
    const first = root().querySelector('input');
    if (first) first.focus();
  }

  function errorBox() {
    return el('p', { class: 'error', role: 'alert', hidden: true });
  }
  function showError(box, text) {
    box.textContent = text;
    box.hidden = !text;
  }

  // ---- connecting to a saved phone ----

  PT.enter = async function (id, name) {
    screen([
      el('p', { class: 'spinner-line' }, [el('span', { class: 'spinner' }), el('span', { text: ' Connecting to ' + (name || 'your phone') + '\u2026' })]),
      el('div', { class: 'row-actions' }, [el('button', { class: 'ghost', type: 'button', text: 'Choose another phone', onclick: () => PT.views.phones() })]),
    ]);
    try {
      const result = await PT.call('servers:connect', id);
      PT.state.server = result.server;
      if (result.state === 'signed-in') PT.shell.start(result.me);
      else PT.views.auth(result.server, result.note);
    } catch (err) {
      failed(id, name, err);
    }
  };

  function failed(id, name, err) {
    const actions = [
      el('button', { class: 'go', type: 'button', text: 'Try again', onclick: () => PT.enter(id, name) }),
      el('button', { class: 'ghost', type: 'button', text: 'Choose another phone', onclick: () => PT.views.phones() }),
    ];
    if (err.code === 'CERT') {
      actions.push(el('button', { class: 'danger', type: 'button', text: 'Remove this phone', onclick: async () => {
        await PT.call('servers:remove', id).catch(() => {});
        PT.views.phones();
      } }));
    }
    screen([
      el('h2', { text: err.code === 'CERT' ? 'Is that still your phone?' : 'Can\u2019t reach the phone' }),
      el('p', { class: 'error', role: 'alert', text: err.message }),
      el('div', { class: 'row-actions' }, actions),
    ]);
  }

  // ---- the list of phones ----

  PT.views.phones = async function (options) {
    const opts = options || {};
    let phones = [];
    try { phones = await PT.call('servers:list'); } catch (err) { /* show the add form below */ }
    if (phones.length === 0) return PT.views.addPhone({ first: true });

    const rows = phones.map((p) => {
      const rename = async () => {
        const input = el('input', { type: 'text', value: p.name, maxlength: '40', 'aria-label': 'Phone name' });
        const answer = await PT.modal({
          title: 'Rename this phone',
          body: [input],
          actions: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Save', value: true, kind: 'go' }],
        });
        if (answer === true && input.value.trim()) {
          try { await PT.call('servers:rename', p.id, input.value); } catch (err) { PT.toast(err.message, 'error'); }
          PT.views.phones();
        }
      };
      const remove = async () => {
        if (await PT.confirm('Remove ' + p.name + '?', 'The app forgets this phone and its saved sign-in. You can add it again later.', 'Remove', true)) {
          await PT.call('servers:remove', p.id).catch((err) => PT.toast(err.message, 'error'));
          PT.views.phones();
        }
      };
      return el('div', { class: 'phone-row' }, [
        el('button', { class: 'phone-main', type: 'button', onclick: () => PT.enter(p.id, p.name) }, [
          el('span', { class: 'phone-icon', text: p.secure ? '\u{1F512}' : '\u26A0\uFE0F', title: p.secure ? 'Secure connection' : 'Not encrypted' }),
          el('span', { class: 'phone-text' }, [
            el('strong', { text: p.name }),
            el('span', { class: 'note', text: p.host + ':' + p.port + (p.remembered ? ' \u00B7 signed in as ' + p.username : '') }),
          ]),
        ]),
        el('button', { class: 'ghost small', type: 'button', text: 'Rename', onclick: rename }),
        el('button', { class: 'ghost small', type: 'button', text: 'Remove', onclick: remove }),
      ]);
    });
    screen([
      el('h2', { text: 'Your phones' }),
      el('div', { class: 'phone-list' }, rows),
      el('div', { class: 'row-actions' }, [el('button', { class: 'ghost', type: 'button', text: '+ Add another phone', onclick: () => PT.views.addPhone({}) })]),
    ]);
    if (opts.focusFirst) root().querySelector('.phone-main').focus();
  };

  // ---- adding a phone ----

  PT.views.addPhone = function (options) {
    const opts = options || {};
    const address = el('input', { type: 'text', id: 'address', placeholder: '192.168.1.20', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Phone address' });
    const error = errorBox();
    const find = el('button', { class: 'go', type: 'submit', text: 'Find phone' });
    const form = el('form', { class: 'stack', novalidate: true }, [
      el('label', { for: 'address', text: 'Phone address' }),
      address,
      el('p', { class: 'note', text: 'The address is shown on the phone while the theater is open. Both devices need to be on the same Wi-Fi.' }),
      error,
      el('div', { class: 'row-actions' }, [find].concat(opts.first ? [] : [el('button', { class: 'ghost', type: 'button', text: 'Back', onclick: () => PT.views.phones() })])),
    ]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      showError(error, '');
      find.disabled = true;
      find.textContent = 'Looking\u2026';
      try {
        const found = await PT.call('servers:probe', address.value);
        PT.views.trust(found, opts);
      } catch (err) {
        showError(error, err.message);
        find.disabled = false;
        find.textContent = 'Find phone';
      }
    });
    screen([el('h2', { text: opts.first ? 'Connect to your phone' : 'Add a phone' }), form]);
  };

  /** The person compares the fingerprint with the phone before the app trusts the certificate. */
  PT.views.trust = function (found, opts) {
    const name = el('input', { type: 'text', id: 'phone-name', value: found.host, maxlength: '40', 'aria-label': 'Name for this phone' });
    const error = errorBox();
    const go = el('button', { class: 'go', type: 'button', text: found.secure ? 'It matches, continue' : 'Continue anyway' });
    const body = [el('h2', { text: 'Found your phone' }), el('p', { class: 'note', text: found.host + ':' + found.port })];
    if (found.secure) {
      const lines = PT.util.fingerprintLines(found.fingerprint);
      body.push(
        el('p', { text: 'Before you continue, check that this matches the phone. It proves this is your phone and not something pretending to be it.' }),
        el('div', { class: 'fingerprint', 'aria-label': 'Certificate fingerprint' }, lines.map((l) => el('div', { text: l }))),
        el('p', { class: 'note', text: 'On the phone: Profile, Settings, Certificate fingerprint.' })
      );
    } else {
      body.push(el('p', { class: 'error', text: 'This phone answered without encryption. Your password would cross your network unprotected, and the admin website cannot be used. Turn on HTTPS in the phone\u2019s settings if you can.' }));
    }
    body.push(el('label', { for: 'phone-name', text: 'Name' }), name, error, el('div', { class: 'row-actions' }, [
      go,
      el('button', { class: 'ghost', type: 'button', text: 'Back', onclick: () => PT.views.addPhone(opts) }),
    ]));
    screen(body, true);
    go.focus();
    go.addEventListener('click', async () => {
      go.disabled = true;
      showError(error, '');
      try {
        const saved = await PT.call('servers:trust', found, name.value);
        PT.enter(saved.id, saved.name);
      } catch (err) {
        showError(error, err.message);
        go.disabled = false;
      }
    });
  };

  // ---- signing in ----

  PT.views.auth = function (server, note, startTab) {
    const canRemember = !!(PT.state.info && PT.state.info.canRemember);
    let tab = startTab || 'in';

    const draw = (prefill) => {
      const tabs = el('div', { class: 'tabs', role: 'tablist' }, [
        el('button', { class: tab === 'in' ? 'tab active' : 'tab', type: 'button', role: 'tab', text: 'Sign in', onclick: () => { tab = 'in'; draw(); } }),
        el('button', { class: tab === 'up' ? 'tab active' : 'tab', type: 'button', role: 'tab', text: 'Request access', onclick: () => { tab = 'up'; draw(); } }),
      ]);
      const error = errorBox();
      const ok = el('p', { class: 'notice ok', hidden: true, role: 'status' });
      const username = el('input', { type: 'text', id: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '20', value: prefill || server.username || '', 'aria-label': 'Username' });
      const password = el('input', { type: 'password', id: 'password', autocomplete: tab === 'in' ? 'current-password' : 'new-password', 'aria-label': 'Password' });
      const submit = el('button', { class: 'go', type: 'submit', text: tab === 'in' ? 'Sign in' : 'Send request' });
      const fields = [
        el('label', { for: 'username', text: 'Username' }), username,
        el('label', { for: 'password', text: 'Password' }), password,
      ];
      let remember = null;
      let agree = null;
      if (tab === 'in' && canRemember) {
        remember = el('input', { type: 'checkbox', id: 'remember', checked: true });
        fields.push(el('label', { class: 'check', for: 'remember' }, [remember, el('span', { text: 'Keep me signed in on this PC' })]));
      }
      if (tab === 'up') {
        agree = el('input', { type: 'checkbox', id: 'agree' });
        const legal = (which, label) => el('button', { class: 'linklike', type: 'button', text: label, onclick: () => showLegal(which, label) });
        fields.push(
          el('p', { class: 'note', text: 'The admin decides. You can sign in once they approve your request.' }),
          el('label', { class: 'check', for: 'agree' }, [agree, el('span', {}, [document.createTextNode('I agree to the '), legal('terms', 'Terms of Use'), document.createTextNode(' and the '), legal('privacy', 'Privacy Policy')])])
        );
      }
      const form = el('form', { class: 'stack', novalidate: true }, fields.concat([error, ok, el('div', { class: 'row-actions' }, [submit])]));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        showError(error, '');
        const name = username.value.trim().toLowerCase();
        if (tab === 'up') {
          const problem = PT.util.usernameProblem(name) || PT.util.passwordProblem(password.value, name) || (agree.checked ? null : 'Please accept the Terms of Use and the Privacy Policy.');
          if (problem) return showError(error, problem);
        } else if (!name || !password.value) {
          return showError(error, 'Type your username and password.');
        }
        submit.disabled = true;
        try {
          if (tab === 'in') {
            const result = await PT.call('session:login', { username: name, password: password.value, remember: !!(remember && remember.checked) });
            PT.shell.start(result.me);
          } else {
            await PT.call('session:register', { username: name, password: password.value, agree: true });
            tab = 'in';
            draw(name);
            const box = root().querySelector('.notice.ok');
            box.textContent = 'Request sent. You can sign in once the admin approves it.';
            box.hidden = false;
          }
        } catch (err) {
          showError(error, err.message);
          submit.disabled = false;
        }
      });
      const children = [
        el('p', { class: 'note', text: server.name + ' \u00B7 ' + server.host + ':' + server.port }),
        tabs,
        form,
        el('div', { class: 'row-actions split' }, [el('button', { class: 'linklike', type: 'button', text: 'Switch phone', onclick: async () => { await PT.call('servers:disconnect').catch(() => {}); PT.views.phones(); } })]),
      ];
      if (note) children.splice(1, 0, el('p', { class: 'notice', role: 'status', text: note }));
      screen(children);
      if (prefill || server.username) password.focus();
    };
    draw();
  };

  async function showLegal(which, title) {
    const body = el('div', { class: 'doc' }, [el('p', { class: 'note', text: 'Loading\u2026' })]);
    const done = PT.modal({ title, body: [body], actions: [{ label: 'Close', value: true, kind: 'go' }] });
    try {
      const text = await PT.call('legal:get', which);
      body.replaceChildren(...PT.md.render(PT.md.parse(text)));
    } catch (err) {
      body.replaceChildren(el('p', { class: 'error', text: err.message }));
    }
    return done;
  }
  PT.showLegal = showLegal;
})();
