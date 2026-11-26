// A tiny Markdown reader for the legal pages (copied from the phone's website; links are shown as plain text here): headings, paragraphs, lists, tables, bold, code and links.
// It builds page elements one by one and never inserts raw HTML, so nothing in a document can run as code.
PT.md = {
  // Splits one line of text into pieces: plain text, bold, code and links.
  inline(text) {
    const out = [];
    const pattern = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
    let last = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      if (m.index > last) out.push({ t: "text", text: text.slice(last, m.index) });
      if (m[1] !== undefined) out.push({ t: "b", text: m[1] });
      else if (m[2] !== undefined) out.push({ t: "code", text: m[2] });
      else out.push({ t: "a", text: m[3], href: m[4] });
      last = pattern.lastIndex;
    }
    if (last < text.length) out.push({ t: "text", text: text.slice(last) });
    return out;
  },

  // Turns the text of a document into a list of blocks.
  parse(text) {
    const lines = text.replace(/\r/g, "").split("\n");
    const blocks = [];
    let i = 0;
    const isTable = (l) => /^\s*\|/.test(l);
    const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      if (h) { blocks.push({ type: "h", level: h[1].length, text: h[2] }); i++; continue; }
      if (isTable(line)) {
        const rows = [];
        while (i < lines.length && isTable(lines[i])) { rows.push(cells(lines[i])); i++; }
        const body = rows.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
        blocks.push({ type: "table", head: body[0] || [], rows: body.slice(1) });
        continue;
      }
      if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        const ordered = /^\s*\d+\./.test(line);
        const items = [];
        while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
          items.push(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, ""));
          i++;
        }
        blocks.push({ type: ordered ? "ol" : "ul", items });
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\s*\||\s*[-*]\s|\s*\d+\.\s)/.test(lines[i])) { para.push(lines[i].trim()); i++; }
      blocks.push({ type: "p", text: para.join(" ") });
    }
    return blocks;
  },

  // Adds the pieces from `inline()` to an element.
  fill(el, text) {
    PT.md.inline(text).forEach((piece) => {
      if (piece.t === "b") el.append(PT.util.el("strong", { text: piece.text }));
      else if (piece.t === "code") el.append(PT.util.el("code", { text: piece.text }));
      else if (piece.t === "a") el.append(PT.util.el("span", { class: "doc-link", text: piece.text }));
      else el.append(document.createTextNode(piece.text));
    });
    return el;
  },

  render(blocks) {
    const el = PT.util.el;
    const out = [];
    blocks.forEach((b) => {
      if (b.type === "h") out.push(PT.md.fill(el("h" + (b.level + 1)), b.text));
      else if (b.type === "p") out.push(PT.md.fill(el("p"), b.text));
      else if (b.type === "ul" || b.type === "ol") {
        const list = el(b.type);
        b.items.forEach((item) => list.append(PT.md.fill(el("li"), item)));
        out.push(list);
      } else if (b.type === "table") {
        const table = el("table");
        const head = el("tr");
        b.head.forEach((c) => head.append(PT.md.fill(el("th"), c)));
        table.append(head);
        b.rows.forEach((r) => {
          const row = el("tr");
          r.forEach((c) => row.append(PT.md.fill(el("td"), c)));
          table.append(row);
        });
        const wrap = el("div", { class: "table-wrap" });
        wrap.append(table);
        out.push(wrap);
      }
    });
    return out;
  },
};
