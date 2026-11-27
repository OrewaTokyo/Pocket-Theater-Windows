PT.pages = PT.pages || {};

PT.pages.account = async function (main) {
  const el = PT.util.el;
  const me = PT.state.me || {};
  const server = PT.state.server || {};

  let remembered = false;
  let player = null;
  let savedPlayer = false;
  try {
    const phones = await PT.call('servers:list');
    const mine = phones.find((p) => p.id === server.id);
    remembered = !!(mine && mine.remembered);
  } catch (err) { /* shown as "no" */ }
  try { const info = await PT.call('player:info'); player = info.player; savedPlayer = info.saved; } catch (err) { /* shown as "none" */ }
  if (!document.getElementById('main') || location.hash.indexOf('#/account') !== 0) return;

  // ---- change password ----
  const current = el('input', { type: 'password', id: 'cur', autocomplete: 'current-password', 'aria-label': 'Current password' });
  const next = el('input', { type: 'password', id: 'new', autocomplete: 'new-password', 'aria-label': 'New password' });
  const error = el('p', { class: 'error', role: 'alert', hidden: true });
  const done = el('p', { class: 'notice ok', role: 'status', hidden: true, text: 'Password changed.' });
  const save = el('button', { class: 'go', type: 'submit', text: 'Change password' });
  const form = el('form', { class: 'stack', novalidate: true }, [
    el('label', { for: 'cur', text: 'Current password' }), current,
    el('label', { for: 'new', text: 'New password' }), next,
    error, done,
    el('div', { class: 'row-actions' }, [save]),
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    done.hidden = true;
    const problem = !current.value ? 'Type your current password.' : PT.util.passwordProblem(next.value, me.username);
    if (problem) { error.textContent = problem; error.hidden = false; return; }
    save.disabled = true;
    try {
      await PT.call('session:password', { current: current.value, next: next.value });
      current.value = '';
      next.value = '';
      done.hidden = false;
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
    save.disabled = false;
  });

  const signOut = async () => {
    try { await PT.call('session:logout'); } catch (err) { /* leaving anyway */ }
    PT.views.auth(PT.state.server, null);
  };
  const forget = async () => {
    if (!(await PT.confirm('Remove ' + server.name + '?', 'The app forgets this phone and its saved sign-in. You can add it again later.', 'Remove', true))) return;
    await PT.call('servers:remove', server.id).catch(() => {});
    PT.views.phones();
  };
  const choosePlayer = async () => {
    if (await PT.files.chooseDefaultPlayer()) PT.shell.route();
  };
  const askEachTime = async () => {
    await PT.call('player:forget').catch(() => {});
    await PT.files.refreshPlayer();
    PT.shell.route();
  };

  const fingerprint = server.secure && server.fingerprint
    ? el('div', { class: 'fingerprint' }, PT.util.fingerprintLines(server.fingerprint).map((l) => el('div', { text: l })))
    : null;

  main.replaceChildren(
    el('h1', { text: 'Account' }),
    el('section', { class: 'panel' }, [
      el('h2', { text: 'Signed in' }),
      el('p', {}, [el('strong', { text: me.username || '' })]),
      el('p', { class: 'note', text: remembered ? 'This PC keeps you signed in.' : 'This PC asks for your password each time you open the app.' }),
      el('div', { class: 'row-actions' }, [el('button', { class: 'ghost', type: 'button', text: 'Sign out', onclick: signOut })]),
    ]),
    el('section', { class: 'panel' }, [el('h2', { text: 'Change password' }), form]),
    el('section', { class: 'panel' }, [
      el('h2', { text: 'This phone' }),
      el('p', {}, [el('strong', { text: server.name || '' }), document.createTextNode(' \u00B7 ' + server.host + ':' + server.port)]),
      el('p', { class: 'note', text: server.secure ? 'Secure connection. The app only talks to a phone that shows this exact certificate:' : 'Not encrypted. Your password and the files cross your network unprotected.' }),
      fingerprint,
      el('div', { class: 'row-actions' }, [
        el('button', { class: 'ghost', type: 'button', text: 'Switch phone', onclick: async () => { await PT.call('servers:disconnect').catch(() => {}); PT.views.phones(); } }),
        el('button', { class: 'danger', type: 'button', text: 'Remove this phone', onclick: forget }),
      ]),
    ]),
    el('section', { class: 'panel' }, [
      el('h2', { text: 'Video player' }),
      el('p', {}, [el('strong', { text: player || 'None chosen' })]),
      el('p', { class: 'note', text: savedPlayer
        ? 'Used by Play in player for videos this app can\u2019t play by itself.'
        : (player ? 'Found automatically. Used by Play in player for videos this app can\u2019t play by itself.' : 'Play in player will list the video players installed on this PC.') }),
      el('div', { class: 'row-actions' }, [
        el('button', { class: 'ghost', type: 'button', text: 'Choose a player\u2026', onclick: choosePlayer }),
        savedPlayer ? el('button', { class: 'ghost', type: 'button', text: 'Back to automatic', onclick: askEachTime }) : null,
      ]),
    ]),
    el('section', { class: 'panel' }, [
      el('h2', { text: 'About and legal' }),
      el('p', { class: 'note', text: 'Pocket Theater for Windows ' + ((PT.state.info && PT.state.info.version) || '') }),
      el('div', { class: 'row-actions' }, ['terms', 'privacy', 'security', 'author'].map((name) =>
        el('button', { class: 'ghost', type: 'button', text: PT.docs.titles[name], onclick: () => PT.docs.show(name) }))),
    ]),
    el('p', { class: 'note about', text: 'Free and open source. Apache License 2.0.' })
  );
};
