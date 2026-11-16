'use strict';
// 기억 보기(읽기 전용): 가운데 영역에 목록·그래프 두 가지 보기를 그린다.
// 기억의 이름·본문은 신뢰할 수 없는 글이므로 모든 글자는 textContent / SVG 글자 노드로만 넣는다(HTML 문자열 조립 없음).
// main 이 준 목록(id 포함)만 쓰고 main 에 되돌려 보내는 것은 없다. 힘 계산(simulateGraph)은 자료를 받을 때 한 번만 하고, 칸 크기가 바뀌면 맞추기(fitGraph)만 다시 한다.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const TYPES = ['user', 'feedback', 'project', 'reference'];
  const VBW = 1000; let VBH = 700; // viewBox: 가로는 고정, 세로는 그래프 칸의 실제 가로세로 비율을 따른다(칸 크기가 바뀌면 다시 맞춘다)
  const K_MIN = 0.6; const K_MAX = 8;
  const LABEL_ALL_MAX = 40; // 노드가 이 수 이하이면 모든 노드에 이름을 붙인다(겹쳐도 가장 덜 겹치는 자리에)
  const SEARCH_DEBOUNCE_MS = 120;

  function create({ T, $, el, Lib, onClose }) {
    let items = []; let byId = new Map(); let idxOf = new Map();
    let skipped = 0; let loaded = false; let failed = false; let seq = 0;
    let mode = 'list'; let query = ''; let tag = ''; let selId = null; let open = false;
    let graph = null; // { edges, pos, nbr, deg } (자료 한 벌에 한 번)
    let view = { k: 1, tx: 0, ty: 0 };
    let nodeEls = []; let edgeEls = []; let rowEls = new Map(); let hoverI = -1;
    let svgBuilt = false; let labelTimer = 0; let searchTimer = 0; let texts = []; let focusKey = ''; let focusVal = null;
    const svg = $('mv-svg');
    const svgEl = (tagName, cls) => { const e = document.createElementNS(NS, tagName); if (cls) e.setAttribute('class', cls); return e; };
    const typeOf = (m) => (TYPES.includes(m.type) ? m.type : 'reference');
    const pad2 = (n) => String(n).padStart(2, '0');
    const fmtDate = (ms) => { if (!(ms > 0)) return '-'; const d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
    const cutName = (s, n) => { const a = [...s]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : s; };
    const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    // ---- 자료 ----
    async function load() {
      const my = ++seq;
      let r = null;
      try { r = await window.maru.getMemories(); } catch (x) { r = null; }
      if (my !== seq) return;
      failed = !r || !Array.isArray(r.items);
      items = failed ? [] : r.items; skipped = failed ? 0 : (Number(r.skipped) || 0);
      byId = new Map(items.map((m) => [m.id, m])); idxOf = new Map(items.map((m, i) => [m.id, i]));
      texts = items.map((m) => Lib.memorySearchText(m)); focusKey = ''; focusVal = null; // 검색용 소문자 글자는 자료가 올 때 한 번만 만든다
      loaded = true; graph = null; svgBuilt = false;
      if (selId && !byId.has(selId)) selId = null;
      if (tag && !items.some((m) => m.tags.some((x) => x.toLowerCase() === tag))) tag = '';
      render();
    }
    const vbhFor = (box) => (box.width > 0 && box.height > 0 ? Math.min(4000, Math.max(100, Math.round(VBW * box.height / box.width))) : 700);
    const fitOpts = () => ({ width: VBW, height: VBH, pad: 40, padTop: 60, padBottom: 90 }); // 위는 안내 글, 아래는 범례가 놓이는 자리
    function ensureGraph() {
      if (graph) return graph;
      VBH = vbhFor($('mv-graph').getBoundingClientRect());
      svg.setAttribute('viewBox', '0 0 ' + VBW + ' ' + VBH);
      const edges = Lib.buildMemoryGraph(items);
      const raw = Lib.simulateGraph(items.length, edges, { width: VBW, height: VBH }); // 원시 좌표는 그대로 두고 맞추기만 다시 한다
      const pos = Lib.fitGraph(raw, fitOpts());
      const nbr = items.map(() => new Set()); const deg = items.map(() => 0);
      for (const e of edges) { nbr[e.a].add(e.b); nbr[e.b].add(e.a); deg[e.a]++; deg[e.b]++; }
      graph = { edges, raw, pos, nbr, deg };
      return graph;
    }
    // 칸 크기가 바뀌었을 때: viewBox 와 맞추기만 다시 한다(힘 계산은 다시 하지 않는다)
    function refit() {
      if (!graph || !svgBuilt) return;
      const next = vbhFor($('mv-graph').getBoundingClientRect());
      if (next === VBH) return;
      VBH = next; svg.setAttribute('viewBox', '0 0 ' + VBW + ' ' + VBH);
      graph.pos = Lib.fitGraph(graph.raw, fitOpts());
      graph.edges.forEach((e, k) => {
        const l = edgeEls[k]; const a = graph.pos[e.a]; const b = graph.pos[e.b];
        l.setAttribute('x1', a.x.toFixed(1)); l.setAttribute('y1', a.y.toFixed(1)); l.setAttribute('x2', b.x.toFixed(1)); l.setAttribute('y2', b.y.toFixed(1));
      });
      items.forEach((m, i) => nodeEls[i].setAttribute('d', shapePath(typeOf(m), graph.pos[i].x, graph.pos[i].y, radiusOf(i))));
      drawHull();
    }

    // ---- 겉틀 ----
    function setMode(m) {
      mode = m === 'graph' ? 'graph' : 'list';
      for (const b of $('mv-mode').querySelectorAll('[data-mode]')) { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; }
      render();
    }
    function tagOptions() {
      const sel = $('mv-tag'); const counts = new Map();
      for (const m of items) for (const t of m.tags) { const k = t.toLowerCase(); const c = counts.get(k); if (c) c.n++; else counts.set(k, { tag: t, n: 1 }); }
      const list = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1));
      sel.replaceChildren();
      const all = el('option', '', T('mem.tag.all')); all.value = ''; sel.append(all);
      for (const [k, c] of list) { const o = el('option', '', T('mem.tag.opt', { tag: c.tag, n: c.n })); o.value = k; sel.append(o); }
      sel.value = tag; if (sel.value !== tag) { tag = ''; sel.value = ''; }
      sel.hidden = list.length === 0;
    }
    function render() {
      if (!open) return;
      const empty = loaded && items.length === 0;
      $('mv-empty').hidden = !empty; $('mv-body').hidden = empty;
      $('mv-empty-t').textContent = failed ? T('mem.loadfail') : T('mem.empty');
      $('mv-empty-h').textContent = failed ? '' : T('mem.empty.hint');
      $('mv-count').textContent = T('mem.count', { n: items.length });
      $('mv-note').textContent = skipped > 0 ? T('mem.skipped', { n: skipped }) : T('mem.readonly');
      document.querySelectorAll('#mv-q').forEach((q) => { q.placeholder = T('mem.search'); });
      $('mv-tag').closest('.mv-tools').hidden = empty;
      $('mv-mode').hidden = empty;
      if (empty || !loaded) { $('mv-detail').replaceChildren(); return; }
      tagOptions();
      $('mv-list').hidden = mode !== 'list'; $('mv-graph').hidden = mode !== 'graph';
      if (mode === 'list') renderList(); else renderGraph();
      renderDetail();
    }

    // ---- 목록 ----
    function renderList() {
      const box = $('mv-list'); box.replaceChildren(); rowEls = new Map();
      const ids = new Set(Lib.filterMemories(items, query, tag, texts));
      const frag = document.createDocumentFragment();
      let shown = 0;
      for (const type of TYPES) {
        const group = items.filter((m) => typeOf(m) === type && ids.has(m.id)).sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
        if (!group.length) continue;
        const h = el('h3', 'mv-gh'); h.append(el('span', 'mv-dot t-' + type), el('span', '', T('mem.type.' + type) + ' · ' + group.length));
        frag.append(h);
        for (const m of group) {
          const row = el('button', 'mv-row' + (m.id === selId ? ' sel' : '')); row.type = 'button'; row.dataset.id = m.id;
          row.setAttribute('aria-pressed', m.id === selId ? 'true' : 'false'); // 목록 역할 없이 누름 단추로만 둔다
          const r1 = el('div', 'mv-r1'); r1.append(el('span', 'mv-name', m.name), el('span', 'mv-date', fmtDate(m.modified)));
          row.append(r1);
          if (m.description) row.append(el('div', 'mv-desc', m.description));
          if (m.tags.length) { const tg = el('div', 'mv-tags'); for (const t of m.tags) tg.append(el('span', 'mv-tg', t)); row.append(tg); }
          rowEls.set(m.id, row); frag.append(row); shown++;
        }
      }
      if (!shown) frag.append(el('div', 'empty', T('mem.nomatch')));
      box.append(frag);
    }

    // ---- 상세(읽기 전용) ----
    function linkBtn(id) {
      const m = byId.get(id); if (!m) return null;
      const b = el('button', 'mv-link', m.name); b.type = 'button'; b.dataset.id = id; b.title = m.description || m.name;
      return b;
    }
    function renderDetail() {
      const box = $('mv-detail'); box.replaceChildren();
      const m = selId ? byId.get(selId) : null;
      if (!m) { box.append(el('div', 'hint', T('mem.pick'))); return; }
      const type = typeOf(m);
      box.append(el('h3', 'mv-d-title', m.name));
      const meta = el('div', 'mv-d-meta'); meta.append(el('span', 'mv-dot t-' + type), el('span', '', T('mem.type.' + type)), el('span', '', T('mem.modified', { date: fmtDate(m.modified) })));
      box.append(meta);
      if (m.description) box.append(el('div', 'mv-d-desc', m.description));
      if (m.tags.length) {
        box.append(el('h4', 'pd-h', T('mem.sec.tags')));
        const tg = el('div', 'mv-tags');
        for (const t of m.tags) { const b = el('button', 'mv-tg' + (t.toLowerCase() === tag ? ' on' : ''), t); b.type = 'button'; b.dataset.tag = t.toLowerCase(); tg.append(b); }
        box.append(tg);
      }
      box.append(el('pre', 'mv-pre', m.body || T('mem.empty.body')));
      for (const [key, ids] of [['mem.sec.out', m.out], ['mem.sec.in', m.in]]) {
        box.append(el('h4', 'pd-h', T(key)));
        const lk = el('div', 'mv-links');
        const bs = (ids || []).map(linkBtn).filter(Boolean);
        if (!bs.length) lk.append(el('span', 'empty', T('mem.link.none'))); else lk.append(...bs);
        box.append(lk);
      }
    }

    // ---- 선택 ----
    function select(id, o) {
      selId = id && byId.has(id) ? id : null;
      if (mode === 'list') {
        for (const [rid, row] of rowEls) { const on = rid === selId; row.classList.toggle('sel', on); row.setAttribute('aria-pressed', on ? 'true' : 'false'); }
        const row = selId ? rowEls.get(selId) : null;
        if (!row && selId) { clearTimeout(searchTimer); query = ''; $('mv-q').value = ''; setTag(''); // 필터를 풀 때 태그 <select> 값도 함께 되돌린다
           const r2 = rowEls.get(selId); if (r2) { r2.classList.add('sel'); r2.scrollIntoView({ block: 'nearest' }); } }
        else if (row && o && o.scroll) row.scrollIntoView({ block: 'nearest' });
      } else { applyHighlight(); if (selId && o && o.scroll) ensureVisible(idxOf.get(selId)); scheduleLabels(); }
      renderDetail();
    }
    function setTag(t) {
      tag = t || ''; $('mv-tag').value = tag; if ($('mv-tag').value !== tag) tag = '';
      if (mode === 'list') renderList(); else { applyHighlight(); scheduleLabels(); }
      renderDetail();
    }
    function setQuery(q) {
      query = q;
      if (mode === 'list') renderList(); else { applyHighlight(); scheduleLabels(); }
    }
    // 입력은 잠깐 모아서 한 번만 걸러낸다. flush 는 Esc 로 지울 때처럼 바로 반영해야 할 때.
    function queueQuery(q) { clearTimeout(searchTimer); searchTimer = setTimeout(() => { searchTimer = 0; setQuery(q); }, SEARCH_DEBOUNCE_MS); }
    function clearSearch() { // 검색어가 있으면 지우고 true(Esc 가 검색만 지우도록)
      const q = $('mv-q'); if (!q.value) return false;
      clearTimeout(searchTimer); q.value = ''; setQuery(''); return true;
    }

    // ---- 그래프 ----
    function shapePath(type, x, y, r) {
      const f = (n) => Math.round(n * 10) / 10;
      if (type === 'feedback') { const s = r * 0.9; return 'M' + f(x - s) + ' ' + f(y - s) + 'H' + f(x + s) + 'V' + f(y + s) + 'H' + f(x - s) + 'Z'; }
      if (type === 'project') { const s = r * 1.2; return 'M' + f(x) + ' ' + f(y - s) + 'L' + f(x + s) + ' ' + f(y) + 'L' + f(x) + ' ' + f(y + s) + 'L' + f(x - s) + ' ' + f(y) + 'Z'; }
      if (type === 'reference') { const s = r * 1.15; return 'M' + f(x) + ' ' + f(y - s) + 'L' + f(x + s) + ' ' + f(y + s * 0.8) + 'L' + f(x - s) + ' ' + f(y + s * 0.8) + 'Z'; }
      return 'M' + f(x - r) + ' ' + f(y) + 'a' + f(r) + ' ' + f(r) + ' 0 1 0 ' + f(2 * r) + ' 0a' + f(r) + ' ' + f(r) + ' 0 1 0 ' + f(-2 * r) + ' 0Z';
    }
    const radiusOf = (i) => 8 + 2.2 * Math.sqrt(graph.deg[i]);
    function buildSvg() {
      const g = ensureGraph();
      svg.replaceChildren();
      const vp = svgEl('g'); vp.id = 'mv-vp';
      const hull = svgEl('g'); hull.id = 'mv-hulls';
      const eg = svgEl('g'); const ng = svgEl('g'); const lg = svgEl('g'); lg.id = 'mv-labels';
      edgeEls = g.edges.map((e) => {
        const l = svgEl('line', 'mv-e ' + e.kind);
        l.setAttribute('x1', g.pos[e.a].x.toFixed(1)); l.setAttribute('y1', g.pos[e.a].y.toFixed(1)); l.setAttribute('x2', g.pos[e.b].x.toFixed(1)); l.setAttribute('y2', g.pos[e.b].y.toFixed(1));
        eg.append(l); return l;
      });
      nodeEls = items.map((m, i) => {
        const p = svgEl('path', 'mv-n t-' + typeOf(m)); p.setAttribute('d', shapePath(typeOf(m), g.pos[i].x, g.pos[i].y, radiusOf(i))); p.dataset.i = String(i);
        ng.append(p); return p;
      });
      vp.append(hull, eg, ng, lg); svg.append(vp);
      svgBuilt = true; view = { k: 1, tx: 0, ty: 0 }; applyView(false);
    }
    function legend() {
      const lg = $('mv-legend'); lg.replaceChildren();
      for (const t of TYPES) {
        const s = svgEl('svg'); s.setAttribute('width', '14'); s.setAttribute('height', '14'); s.setAttribute('viewBox', '-8 -8 16 16'); s.setAttribute('aria-hidden', 'true');
        const p = svgEl('path', 'mv-n t-' + t); p.setAttribute('d', shapePath(t, 0, 0, 5.5)); s.append(p);
        const it = el('span', 'mv-lg'); it.append(s, el('span', '', T('mem.type.' + t))); lg.append(it);
      }
      const a = el('span', 'mv-lg'); a.append(el('span', 'mv-ln'), el('span', '', T('mem.legend.link')));
      const b = el('span', 'mv-lg'); b.append(el('span', 'mv-ln tag'), el('span', '', T('mem.legend.tag')));
      lg.append(a, b);
    }
    function renderGraph() {
      if (!svgBuilt) buildSvg();
      $('mv-hint').textContent = T('mem.graph.hint');
      legend();
      applyHighlight(); scheduleLabels();
    }
    const scale = () => { const r = svg.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? Math.min(r.width / VBW, r.height / VBH) : 1; };
    function applyView(labels) {
      const vp = $('mv-vp'); if (vp) vp.setAttribute('transform', 'translate(' + view.tx.toFixed(2) + ' ' + view.ty.toFixed(2) + ') scale(' + view.k.toFixed(4) + ')');
      if (labels !== false) scheduleLabels();
    }
    // 선택·태그·검색에 따른 강조: 선택이 있으면 그 노드와 이웃만 밝게, 없으면 태그·검색에 맞는 노드를 밝게(나머지는 흐리게)
    // 같은 (선택, 태그, 검색어)에는 한 번만 계산한다: 강조와 글자표가 연달아 부르므로 키 입력마다 거르기를 두 번 하지 않는다
    function focusSet() {
      const key = (selId || '') + '\u0001' + tag + '\u0001' + query;
      if (key === focusKey) return focusVal;
      let v = null;
      if (selId && idxOf.has(selId)) { const i = idxOf.get(selId); v = { set: new Set([i, ...graph.nbr[i]]), center: i }; }
      else if (tag || query.trim()) { const ids = Lib.filterMemories(items, query, tag, texts); v = { set: new Set(ids.map((id) => idxOf.get(id))), center: -1 }; }
      focusKey = key; focusVal = v; return v;
    }
    function applyHighlight() {
      if (!graph) return;
      const f = focusSet();
      nodeEls.forEach((n, i) => { n.classList.toggle('dim', !!f && !f.set.has(i)); n.classList.toggle('sel', !!f && f.center === i); });
      graph.edges.forEach((e, k) => {
        const on = !!f && (f.center >= 0 ? (e.a === f.center || e.b === f.center) : (f.set.has(e.a) && f.set.has(e.b)));
        edgeEls[k].classList.toggle('hot', on); edgeEls[k].classList.toggle('dim', !!f && !on);
      });
      drawHull();
    }
    function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
    function convexHull(pts) {
      const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
      if (p.length < 3) return p;
      const lo = []; for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
      const up = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
      lo.pop(); up.pop(); return lo.concat(up);
    }
    function drawHull() {
      const hg = $('mv-hulls'); if (!hg) return; hg.replaceChildren();
      if (!tag) return;
      const pts = []; items.forEach((m, i) => { if (m.tags.some((x) => x.toLowerCase() === tag)) pts.push({ x: graph.pos[i].x, y: graph.pos[i].y }); });
      if (!pts.length) return;
      const h = convexHull(pts);
      const d = h.length === 1 ? 'M' + h[0].x.toFixed(1) + ' ' + h[0].y.toFixed(1) + 'l0.1 0' : 'M' + h.map((q) => q.x.toFixed(1) + ' ' + q.y.toFixed(1)).join('L') + (h.length > 2 ? 'Z' : '');
      const a = svgEl('path', 'mv-hull'); a.setAttribute('d', d); a.setAttribute('stroke-width', '34');
      hg.append(a);
    }
    // 글자표: 겹치지 않게 욕심내어 놓는다. 우선순위: 선택 > 이웃 > 태그·검색 일치 > 마우스 아래 > 연결이 많은 순
    function scheduleLabels() { if (labelTimer) return; labelTimer = requestAnimationFrame(() => { labelTimer = 0; drawLabels(); }); }
    function textW(s, fs) { let w = 0; for (const ch of s) w += ch.codePointAt(0) > 0x2E7F ? 1 : 0.58; return w * fs; }
    function drawLabels() {
      const lg = $('mv-labels'); if (!lg || !graph || mode !== 'graph') return; lg.replaceChildren();
      const rect = svg.getBoundingClientRect(); if (!(rect.width > 0)) return;
      const s = scale(); const px = (i) => ({ x: (view.tx + view.k * graph.pos[i].x) * s + (rect.width - VBW * s) / 2, y: (view.ty + view.k * graph.pos[i].y) * s + (rect.height - VBH * s) / 2 });
      const f = focusSet();
      const prio = items.map((m, i) => i);
      const rank = (i) => (f && f.center === i ? 0 : f && f.center >= 0 && f.set.has(i) ? 1 : f && f.center < 0 && f.set.has(i) ? 2 : i === hoverI ? 2 : 3);
      prio.sort((a, b) => rank(a) - rank(b) || graph.deg[b] - graph.deg[a] || a - b);
      const FS = 11; const placed = []; const small = items.length <= LABEL_ALL_MAX;
      const maxLabels = small ? Infinity : (f && f.center < 0 ? 90 : 70); let count = 0;
      const fsVb = FS / (view.k * s);
      const overlaps = (box) => placed.reduce((n2, q) => n2 + (box.l < q.r && box.r > q.l && box.t < q.b && box.b > q.t ? 1 : 0), 0);
      for (const i of prio) {
        if (count >= maxLabels) break;
        const r = rank(i);
        if (r === 3 && f) break; // 강조가 있으면 강조된 것만 이름을 보인다
        const c = px(i); if (c.x < -20 || c.y < -20 || c.x > rect.width + 20 || c.y > rect.height + 20) continue;
        const name = cutName(items[i].name, small ? 30 : 26); const w = textW(name, FS) + 6; const rad = radiusOf(i) * view.k * s; const hh = FS + 3;
        const dg = rad * 0.7 + 2;
        // 자리 후보: 오른쪽, 왼쪽, 아래, 위, 네 대각선, 좌우에서 한 줄 아래·위
        const cands = [[c.x + rad + 3, c.y - FS / 2 - 1], [c.x - rad - 3 - w, c.y - FS / 2 - 1], [c.x - w / 2, c.y + rad + 2], [c.x - w / 2, c.y - rad - hh - 2],
          [c.x + dg, c.y + dg - 2], [c.x + dg, c.y - dg - hh + 2], [c.x - dg - w, c.y + dg - 2], [c.x - dg - w, c.y - dg - hh + 2],
          [c.x + rad + 3, c.y - FS / 2 - 1 + hh], [c.x + rad + 3, c.y - FS / 2 - 1 - hh], [c.x - rad - 3 - w, c.y - FS / 2 - 1 + hh], [c.x - rad - 3 - w, c.y - FS / 2 - 1 - hh]];
        let spot = null; let bestN = Infinity;
        for (const [l0, t0] of cands) {
          // 작은 그래프는 화면 안으로 밀어 넣고, 큰 그래프는 벗어나는 자리를 버린다
          const l = small ? Math.min(Math.max(2, l0), Math.max(2, rect.width - w - 2)) : l0; const t = small ? Math.min(Math.max(2, t0), Math.max(2, rect.height - hh - 2)) : t0;
          const box = { l, t, r: l + w, b: t + hh };
          if (!small && (box.l < 2 || box.r > rect.width - 2)) continue;
          const cnt = overlaps(box);
          if (cnt === 0) { spot = { l, t, box }; break; }
          if (small && cnt < bestN) { bestN = cnt; spot = { l, t, box }; } // 모두 겹치면 가장 덜 겹치는 자리
        }
        if (!spot) continue;
        placed.push(spot.box); count++;
        const t = svgEl('text', 'mv-lb'); t.textContent = name;
        t.setAttribute('x', ((spot.l + 3 - (rect.width - VBW * s) / 2) / s - view.tx) / view.k); // 왼쪽 여백 3px 은 위 w 계산(+6)과 맞춘다
        t.setAttribute('y', ((spot.t + FS - (rect.height - VBH * s) / 2) / s - view.ty) / view.k);
        t.setAttribute('font-size', fsVb.toFixed(3)); t.setAttribute('stroke-width', (3 / (view.k * s)).toFixed(3));
        lg.append(t);
      }
    }
    function ensureVisible(i) {
      if (i === undefined || !graph) return;
      const rect = svg.getBoundingClientRect(); if (!(rect.width > 0)) return;
      const s = scale(); const ox = (rect.width - VBW * s) / 2; const oy = (rect.height - VBH * s) / 2;
      const x = (view.tx + view.k * graph.pos[i].x) * s + ox; const y = (view.ty + view.k * graph.pos[i].y) * s + oy;
      if (x > 30 && y > 30 && x < rect.width - 30 && y < rect.height - 30) return;
      view.tx = (rect.width / 2 - ox) / s - view.k * graph.pos[i].x; view.ty = (rect.height / 2 - oy) / s - view.k * graph.pos[i].y;
      applyView();
    }
    function zoomAt(factor, cx, cy) { // cx, cy: svg 안의 화면 좌표(px)
      const rect = svg.getBoundingClientRect(); const s = scale();
      const ox = (rect.width - VBW * s) / 2; const oy = (rect.height - VBH * s) / 2;
      const k2 = Math.min(K_MAX, Math.max(K_MIN, view.k * factor)); if (k2 === view.k) return;
      const vx = ((cx - ox) / s - view.tx) / view.k; const vy = ((cy - oy) / s - view.ty) / view.k;
      view.tx = (cx - ox) / s - vx * k2; view.ty = (cy - oy) / s - vy * k2; view.k = k2;
      applyView();
    }
    // 포인터: 끌면 이동, 거의 안 움직이고 놓으면 클릭(노드면 선택, 빈 곳이면 선택 해제)
    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false, target: e.target };
      try { svg.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
    });
    svg.addEventListener('pointermove', (e) => {
      if (drag) {
        const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; svg.classList.add('pan'); hideTip(); }
        if (drag.moved) { const s = scale(); view.tx = drag.tx + dx / s; view.ty = drag.ty + dy / s; applyView(false); }
        return;
      }
      const n = e.target && e.target.closest ? e.target.closest('[data-i]') : null;
      const i = n && n.dataset ? Number(n.dataset.i) : -1;
      if (i !== hoverI) {
        if (hoverI >= 0 && nodeEls[hoverI]) nodeEls[hoverI].classList.remove('hov');
        hoverI = i >= 0 && items[i] ? i : -1;
        if (hoverI >= 0) { nodeEls[hoverI].classList.add('hov'); scheduleLabels(); }
      }
      if (hoverI >= 0) showTip(e, items[hoverI]); else hideTip();
    });
    const endDrag = (e, cancel) => {
      if (!drag) return; const d = drag; drag = null; svg.classList.remove('pan');
      try { svg.releasePointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
      if (cancel) return;
      if (d.moved) { scheduleLabels(); return; }
      const n = d.target && d.target.closest ? d.target.closest('[data-i]') : null;
      const i = n && n.dataset ? Number(n.dataset.i) : -1;
      select(i >= 0 && items[i] ? items[i].id : null);
    };
    svg.addEventListener('pointerup', (e) => endDrag(e, false));
    svg.addEventListener('pointercancel', (e) => endDrag(e, true));
    svg.addEventListener('pointerleave', () => { hideTip(); if (hoverI >= 0 && nodeEls[hoverI]) nodeEls[hoverI].classList.remove('hov'); if (hoverI >= 0) { hoverI = -1; scheduleLabels(); } });
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoomAt(Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.0016), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    function showTip(e, m) {
      const tip = $('mv-tip'); const wrap = $('mv-graph'); const r = wrap.getBoundingClientRect();
      tip.textContent = T('mem.graph.node', { name: m.name, type: T('mem.type.' + typeOf(m)) });
      tip.hidden = false;
      const x = Math.min(e.clientX - r.left + 14, Math.max(4, r.width - tip.offsetWidth - 6)); const y = Math.min(e.clientY - r.top + 14, Math.max(4, r.height - tip.offsetHeight - 6));
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    }
    function hideTip() { $('mv-tip').hidden = true; }
    const center = () => { const r = svg.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
    $('mv-zin').addEventListener('click', () => zoomAt(1.4, ...center()));
    $('mv-zout').addEventListener('click', () => zoomAt(1 / 1.4, ...center()));
    $('mv-zreset').addEventListener('click', () => { view = { k: 1, tx: 0, ty: 0 }; applyView(); });
    new ResizeObserver(() => { if (open && mode === 'graph') { refit(); scheduleLabels(); } }).observe($('mv-graph'));

    // ---- 이벤트(목록·상세) ----
    $('mv-list').addEventListener('click', (e) => { const r = e.target.closest ? e.target.closest('.mv-row') : null; if (r) select(r.dataset.id); });
    $('mv-detail').addEventListener('click', (e) => {
      const t = e.target.closest ? e.target.closest('button') : null; if (!t) return;
      if (t.dataset.id) select(t.dataset.id, { scroll: true });
      else if (t.dataset.tag) setTag(t.dataset.tag === tag ? '' : t.dataset.tag);
    });
    $('mv-q').addEventListener('input', (e) => queueQuery(e.target.value.slice(0, 100)));
    $('mv-tag').addEventListener('change', (e) => setTag(e.target.value));
    $('mv-mode').addEventListener('click', (e) => { const b = e.target.closest ? e.target.closest('[data-mode]') : null; if (b) setMode(b.dataset.mode); });
    $('mv-mode').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); setMode(mode === 'list' ? 'graph' : 'list'); $('mv-mode').querySelector('[data-mode="' + mode + '"]').focus();
    });
    $('mv-close').addEventListener('click', () => onClose());

    return {
      isOpen: () => open,
      // 열기: 처음 보는 방식은 목록(initialMode 는 시험 전용). 자료는 열 때마다 새로 받는다.
      show(initialMode) {
        open = true; $('mem-view').hidden = false; selId = null; query = ''; tag = ''; $('mv-q').value = ''; clearTimeout(searchTimer);
        loaded = false; setMode(initialMode === 'graph' ? 'graph' : 'list');
        return load();
      },
      hide() { open = false; clearTimeout(searchTimer); $('mem-view').hidden = true; hideTip(); },
      clearSearch,
      relabel() { if (open) render(); },
      title: () => $('mv-title'),
    };
  }
  window.MaruMemView = { create };
})();
