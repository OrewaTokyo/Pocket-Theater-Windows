// The app's own documents (Terms of Use, Privacy Policy, Security Policy, Author) and the first-run screen
// that asks you to accept them.
PT.views = PT.views || {};

PT.docs = (function () {
  const el = PT.util.el;
  const titles = { terms: 'Terms of Use', privacy: 'Privacy Policy', security: 'Security Policy', author: 'Author' };

  /** A document as page elements. Rejects with a plain sentence if it cannot be read. */
  async function render(name, options) {
    const blocks = PT.md.parse(await PT.call('docs:get', name));
    // In a dialog the dialog's title already says what the document is, so its own big heading is left out.
    if (options && options.skipTitle && blocks.length && blocks[0].type === 'h' && blocks[0].level === 1) blocks.shift();
    return PT.md.render(blocks);
  }

  /** Shows one document in a dialog. */
  async function show(name) {
    const body = el('div', { class: 'doc' }, [el('p', { class: 'note', text: 'Loading\u2026' })]);
    const done = PT.modal({ title: titles[name] || 'Document', body: [body], actions: [{ label: 'Close', value: true, kind: 'go' }] });
    try {
      body.replaceChildren(...(await render(name, { skipTitle: true })));
    } catch (err) {
      body.replaceChildren(el('p', { class: 'error', text: err.message }));
    }
    return done;
  }

  /** Small row of links to the documents, for the bottom of a screen. */
  function links() {
    return el('nav', { class: 'doc-links', 'aria-label': 'Documents' }, ['terms', 'privacy', 'security', 'author'].map((name) =>
      el('button', { class: 'linklike', type: 'button', text: titles[name], onclick: () => show(name) })));
  }

  return { titles, render, show, links };
})();

// ---- the first time the app opens (and again whenever the documents change) ----
PT.views.terms = function () {
  const el = PT.util.el;
  const root = document.getElementById('root');
  const tabs = ['terms', 'privacy', 'security'];
  let current = 'terms';

  const box = el('div', { class: 'doc terms-doc', tabindex: '0', 'aria-label': 'Document text' });
  const tabBar = el('div', { class: 'tabs', role: 'tablist' });
  const error = el('p', { class: 'error', role: 'alert', hidden: true });
  const accept = el('button', { class: 'go', type: 'button', text: 'Accept and continue' });
  const decline = el('button', { class: 'ghost', type: 'button', text: 'Decline' });

  const draw = async () => {
    tabBar.replaceChildren(...tabs.map((name) => el('button', {
      class: name === current ? 'tab active' : 'tab', type: 'button', role: 'tab', text: PT.docs.titles[name],
      'aria-selected': name === current ? 'true' : 'false', onclick: () => { current = name; draw(); },
    })));
    box.replaceChildren(el('p', { class: 'note', text: 'Loading\u2026' }));
    box.scrollTop = 0;
    try {
      box.replaceChildren(...(await PT.docs.render(current)));
    } catch (err) {
      box.replaceChildren();
      error.textContent = err.message;
      error.hidden = false;
      accept.disabled = true; // never accept what could not be shown
    }
  };

  accept.addEventListener('click', async () => {
    accept.disabled = true;
    try {
      await PT.call('terms:accept');
      PT.begin();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      accept.disabled = false;
    }
  });

  decline.addEventListener('click', async () => {
    const close = await PT.modal({
      title: 'You need to accept to use Pocket Theater',
      body: [
        el('p', { text: 'Pocket Theater can\u2019t be used without accepting the Terms of Use. If you decline, the app closes.' }),
        el('p', { class: 'note', text: 'It will ask again the next time you open it.' }),
      ],
      actions: [{ label: 'Read the terms again', value: false, kind: 'go' }, { label: 'Close the app', value: true, kind: 'danger' }],
    });
    if (close === true) PT.call('terms:decline').catch(() => {});
  });

  root.replaceChildren(el('div', { class: 'center' }, [el('div', { class: 'card xwide' }, [
    el('div', { class: 'brand-big' }, [
      el('span', { class: 'brand-mark', text: '\u{1F39F}\uFE0F' }),
      el('div', {}, [el('h1', { text: 'Before you start' }), el('p', { class: 'note', text: 'Please read and accept the Terms of Use. They include the Privacy Policy and the Security Policy.' })]),
    ]),
    tabBar,
    box,
    error,
    el('div', { class: 'row-actions split' }, [decline, accept]),
    el('p', { class: 'note terms-note', text: 'By choosing Accept and continue you agree to all three documents.' }),
  ])]));
  draw();
  accept.focus();
};
