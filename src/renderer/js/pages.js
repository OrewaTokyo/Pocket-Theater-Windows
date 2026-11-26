// Home, shelves and folders.
PT.pages = PT.pages || {};

(function () {
  const el = PT.util.el;
  const enc = encodeURIComponent;

  PT.pages.loading = () => el('p', { class: 'spinner-line' }, [el('span', { class: 'spinner' }), el('span', { text: ' Loading\u2026' })]);

  PT.pages.fail = function (main, err, headline) {
    main.replaceChildren(
      el('h1', { text: headline || 'Something went wrong' }),
      el('p', { class: 'error', role: 'alert', text: err.message }),
      el('div', { class: 'row-actions' }, [el('button', { class: 'go', type: 'button', text: 'Try again', onclick: () => PT.shell.route() })])
    );
  };

  function libraryHref(lib, parts) {
    return '#/lib/' + enc(lib) + (parts && parts.length ? '/' + parts.map(enc).join('/') : '');
  }

  // ---- home and shelves ----

  PT.pages.home = async function (main, catId, token) {
    main.replaceChildren(PT.pages.loading());
    let data;
    try {
      data = await PT.api.libraries();
    } catch (err) {
      if (token === PT.renderId) PT.pages.fail(main, err, 'Could not load your shelves');
      return;
    }
    if (token !== PT.renderId) return;
    const libs = data.libraries;
    PT.state.libraries = libs;
    PT.state.shelves = new Set(libs.map((l) => l.category));
    PT.shell.refreshNav();

    if (catId) return shelf(main, catId, libs);

    const me = PT.state.me || {};
    const parts = [el('h1', { text: 'Welcome' + (me.username ? ', ' + me.username : '') }), el('p', { class: 'lead', text: 'Pick a shelf to start watching.' })];
    if (!libs.length) {
      parts.push(empty('Nothing is shared yet', 'On the phone, open Folders and choose a folder to share. It shows up here by itself.'));
      main.replaceChildren(...parts);
      return;
    }

    const recent = PT.recent ? PT.recent.list() : [];
    if (recent.length) {
      parts.push(el('h2', { text: 'Continue watching' }));
      parts.push(el('div', { class: 'recent' }, recent.map((r) => el('button', {
        class: 'recent-card', type: 'button', title: r.name, onclick: () => PT.pages.openByPath(r.lib, r.parts),
      }, [
        el('span', { class: 'recent-name', text: r.name.replace(/\.[^.]+$/, '') }),
        el('span', { class: 'bar' }, [el('span', { class: 'bar-fill', style: { width: Math.min(100, Math.round((r.pos / r.dur) * 100)) + '%' } })]),
        el('span', { class: 'note', text: PT.recent.left(r) }),
      ]))));
    }

    const tiles = PT.cats.filter((c) => PT.state.shelves.has(c.id)).map((c) => {
      const count = libs.filter((l) => l.category === c.id).length;
      return el('a', { class: 'tile' + (c.main ? ' big' : ''), href: '#/cat/' + enc(c.id), style: { '--accent': c.accent } }, [
        el('span', { class: 'tile-icon', text: c.icon }),
        el('strong', { text: c.label }),
        el('span', { class: 'note', text: c.blurb }),
        el('span', { class: 'tile-count', text: count + (count === 1 ? ' folder' : ' folders') }),
      ]);
    });
    parts.push(el('div', { class: 'tiles' }, tiles));
    main.replaceChildren(...parts);
  };

  function empty(title, text) {
    return el('div', { class: 'empty' }, [el('div', { class: 'empty-icon', text: '\u{1F39E}\uFE0F' }), el('h2', { text: title }), el('p', { class: 'note', text })]);
  }

  function shelf(main, catId, libs) {
    const cat = PT.util.cat(catId);
    const mine = libs.filter((l) => l.category === catId);
    const head = [
      el('nav', { class: 'crumbs', 'aria-label': 'You are here' }, [el('a', { href: '#/', text: 'Home' }), el('span', { text: '/' }), el('span', { text: cat.label })]),
      el('h1', {}, [el('span', { class: 'h-icon', text: cat.icon }), document.createTextNode(' ' + cat.label)]),
    ];
    if (!mine.length) {
      main.replaceChildren(...head, empty('Nothing here yet', 'Share a folder on the phone and put it on this shelf.'));
      return;
    }
    main.replaceChildren(...head, el('div', { class: 'cards' }, mine.map((l) => el('a', { class: 'card-link', href: libraryHref(l.id, []), style: { '--accent': cat.accent } }, [
      el('span', { class: 'tile-icon', text: cat.icon }),
      el('strong', { text: l.name }),
      el('span', { class: 'note', text: typeof l.items === 'number' ? l.items + (l.items === 1 ? ' item' : ' items') : '' }),
    ]))));
  }

  // ---- inside a folder ----

  PT.pages.library = async function (main, libId, parts, token) {
    main.replaceChildren(PT.pages.loading());
    let data;
    try {
      data = await PT.api.list(libId, parts);
    } catch (err) {
      if (token === PT.renderId) PT.pages.fail(main, err, 'Could not open this folder');
      return;
    }
    if (token !== PT.renderId) return;
    main.replaceChildren(...buildFolder(data, libId, parts));
  };

  function sortEntries(entries) {
    return entries.slice().sort((a, b) => (a.dir === b.dir ? PT.util.natural(a.name, b.name) : a.dir ? -1 : 1));
  }

  function buildFolder(data, libId, parts) {
    const lib = data.library;
    const cat = PT.util.cat(lib.category);
    const entries = sortEntries(data.entries);
    const crumbs = [el('a', { href: '#/', text: 'Home' }), el('span', { text: '/' }), el('a', { href: '#/cat/' + enc(lib.category), text: cat.label }), el('span', { text: '/' })];
    crumbs.push(parts.length ? el('a', { href: libraryHref(libId, []), text: lib.name }) : el('span', { class: 'here', text: lib.name }));
    parts.forEach((p, i) => {
      crumbs.push(el('span', { text: '/' }));
      crumbs.push(i === parts.length - 1 ? el('span', { class: 'here', text: p }) : el('a', { href: libraryHref(libId, parts.slice(0, i + 1)), text: p }));
    });

    const filter = el('input', { type: 'search', class: 'filter', placeholder: 'Filter this folder', 'aria-label': 'Filter this folder', autocomplete: 'off', spellcheck: 'false' });
    const count = el('span', { class: 'note' });
    const list = el('div', { class: 'list', role: 'list' });

    // What the viewer steps through: the other files of the same kind in this folder.
    const playlistOf = (kind) => entries.filter((e) => PT.util.kind(e) === kind);
    const rows = entries.map((entry) => {
      const kind = PT.util.kind(entry);
      const entryParts = parts.concat(entry.name);
      let open;
      const actions = [];
      if (kind === 'folder') {
        open = () => { location.hash = libraryHref(libId, entryParts); };
      } else if (kind === 'file') {
        open = () => PT.files.openDefault(libId, entryParts);
        actions.push(small('Open', 'Open with the program Windows uses for this file', () => PT.files.openDefault(libId, entryParts)));
        actions.push(small('Save', 'Save a copy to this PC', () => PT.files.save(libId, entryParts)));
      } else {
        open = () => {
          const items = playlistOf(kind);
          PT.viewer.open({ lib: libId, parts, entries: items, index: items.indexOf(entry) });
        };
        if (kind === 'video' || kind === 'audio') actions.push(small(PT.files.playLabel(), PT.files.playHint(), () => PT.files.playOutside(libId, entryParts)));
        actions.push(small('Save', 'Save a copy to this PC', () => PT.files.save(libId, entryParts)));
      }
      const meta = kind === 'folder' ? 'Folder' : [PT.util.size(entry.size), entry.modified ? new Date(entry.modified).toLocaleDateString() : ''].filter(Boolean).join(' \u00B7 ');
      const row = el('div', { class: 'ticket', role: 'listitem' }, [
        el('button', { class: 'ticket-main', type: 'button', onclick: open }, [
          el('span', { class: 'ticket-icon', text: PT.util.icon(kind) }),
          el('span', { class: 'ticket-text' }, [el('strong', { text: entry.name }), el('span', { class: 'note', text: meta })]),
          kind === 'folder' ? el('span', { class: 'chev', text: '\u203A' }) : null,
        ]),
        actions.length ? el('div', { class: 'ticket-actions' }, actions) : null,
      ]);
      return { row, name: entry.name.toLowerCase() };
    });
    rows.forEach((r) => list.append(r.row));

    const none = el('p', { class: 'note', hidden: true, text: 'Nothing matches that.' });
    const apply = () => {
      const q = filter.value.trim().toLowerCase();
      let shown = 0;
      rows.forEach((r) => { const ok = !q || r.name.includes(q); r.row.hidden = !ok; if (ok) shown++; });
      none.hidden = shown !== 0 || rows.length === 0;
      count.textContent = rows.length ? (q ? shown + ' of ' + rows.length : rows.length) + (rows.length === 1 ? ' item' : ' items') : '';
    };
    filter.addEventListener('input', apply);
    apply();

    const content = [
      el('nav', { class: 'crumbs', 'aria-label': 'You are here' }, crumbs),
      el('div', { class: 'folder-head' }, [el('h1', { text: parts.length ? parts[parts.length - 1] : lib.name }), el('div', { class: 'folder-tools' }, [count, filter])]),
    ];
    content.push(rows.length ? list : empty('This folder is empty', 'Nothing to show here yet.'));
    content.push(none);
    return content;
  }

  function small(label, title, onClick) {
    return el('button', { class: 'ghost small', type: 'button', text: label, title, onclick: (event) => { event.stopPropagation(); onClick(); } });
  }

  // Opens one file by its place, for example from "Continue watching".
  PT.pages.openByPath = async function (lib, parts) {
    try {
      const folder = parts.slice(0, -1);
      const data = await PT.api.list(lib, folder);
      const entries = sortEntries(data.entries);
      const target = entries.find((e) => e.name === parts[parts.length - 1]);
      if (!target) throw new Error('That file is not on the phone any more.');
      const kind = PT.util.kind(target);
      const items = entries.filter((e) => PT.util.kind(e) === kind);
      PT.viewer.open({ lib, parts: folder, entries: items, index: items.indexOf(target) });
    } catch (err) {
      PT.toast(err.message, 'error');
    }
  };
})();
