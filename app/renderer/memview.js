'use strict';
// 기억 보기(읽기 전용): 가운데 영역에 목록·그래프 두 가지 보기를 그린다.
// 기억의 이름·본문은 신뢰할 수 없는 글이므로 모든 글자는 textContent / SVG 글자 노드로만 넣는다(HTML 문자열 조립 없음).
// 움직임은 requestAnimationFrame 루프 하나로 하고(그래프가 열려 있고 문서가 보일 때만), 계산은 Lib.graphStep 등 순수 함수가 한다.
// main 이 준 목록(id 포함)만 쓰고 main 에 되돌려 보내는 것은 없다. 힘 계산(simulateGraph)은 자료를 받을 때 한 번만 하고, 칸 크기가 바뀌면 맞추기(fitGraph)만 다시 한다.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const TYPES = ['user', 'feedback', 'project', 'reference'];
  const VBW = 1000; let VBH = 700; // viewBox: 가로는 고정, 세로는 그래프 칸의 실제 가로세로 비율을 따른다(칸 크기가 바뀌면 다시 맞춘다)
  const K_MIN = 0.6; const K_MAX = 8;
  const LABEL_PX = 10.5; // 기본 확대(k=1)에서 이름 글자의 화면 크기(px). viewBox 단위 크기는 칸의 실제 배율로 정하고, 확대하면 노드와 함께 커진다
  const ENTRY_MS = 750; // 처음 들어올 때 퍼지며 나타나는 시간
  const EASE_TAU_MS = 60; // 확대·이동이 목표로 다가가는 시간 상수(약 200ms 에 가라앉는다)
  const SEARCH_DEBOUNCE_MS = 120;
  const SPREAD_DEBOUNCE_MS = 180; // 크기를 바꾸는 동안은 퍼뜨리기를 미루고 마지막 변화 뒤에 한 번만 한다

  function create({ T, $, el, Lib, onClose, lang }) {
    let items = []; let byId = new Map(); let idxOf = new Map();
    let skipped = 0; let loaded = false; let failed = false; let seq = 0;
    let mode = 'list'; let query = ''; let tag = ''; let selId = null; let open = false;
    let graph = null; // { edges, pos, nbr, deg } (자료 한 벌에 한 번)
    let view = { k: 1, tx: 0, ty: 0 }; let tv = { k: 1, tx: 0, ty: 0 }; // tv: 목표(휠·버튼은 목표만 바꾸고 루프가 view 를 다가가게 한다)
    let live = []; let wx = []; let wy = []; let moved = new Set(); let raf = 0; let lastT = 0; let clock = 0; let entryMs = 0; let lbo = -1; let dragNode = false; let hoverT = 0; let spreadT = 0; let scl = 1; let topK = -1; let blurred = false; let skipTick = false; let accDt = 0; let lfs = 11; let boxes = []; let lastFit = null; // lfs: 이름 글자 크기(viewBox 단위)
    let nodeEls = []; let edgeEls = []; let rowEls = new Map(); let hoverI = -1;
    let svgBuilt = false; let searchTimer = 0; let texts = []; let focusKey = ''; let focusVal = null;
    const svg = $('mv-svg');
    const svgEl = (tagName, cls) => { const e = document.createElementNS(NS, tagName); if (cls) e.setAttribute('class', cls); return e; };
    const typeOf = (m) => (TYPES.includes(m.type) ? m.type : 'reference');
    const pad2 = (n) => String(n).padStart(2, '0');
    const fmtDate = (ms) => { if (!(ms > 0)) return '-'; const d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
    const cutName = (s, n) => { const a = [...s]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : s; };
    const disp = (m) => Lib.memoryDisplay(m, lang ? lang() : 'ko'); // 화면 언어에 맞는 제목·설명(없으면 slug·최상위 설명으로 되돌아간다)
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
    // 안쪽 여백: 위는 안내 글, 아래는 범례(실제 자리를 재서 viewBox 단위로 바꾼다) + 떠다니는 폭 + 노드 반지름 + 아래 이름 글자
    function fitOpts() {
      const s = scale(); const gr = $('mv-graph').getBoundingClientRect(); const amp = Lib.GRAPH_DRIFT_AMP;
      const hr = $('mv-hint').getBoundingClientRect(); const lr = $('mv-legend').getBoundingClientRect();
      const topPx = gr.height > 0 && hr.height > 0 ? Math.max(0, hr.bottom - gr.top) + 8 : 44; const botPx = gr.height > 0 && lr.height > 0 ? Math.max(0, gr.bottom - lr.top) + 8 : 64;
      lastFit = { width: VBW, height: VBH, pad: 40 + amp, padTop: Math.max(60, topPx / s + amp + 16), padBottom: Math.max(90, botPx / s + amp + 16 + lfs * 1.3) };
      return lastFit;
    }
    // 이름 상자(노드 중심 기준, 둘레에 글자 크기의 0.4배(가로)·0.3배(세로) 여유 = 상자 사이 0.8배·0.6배): 가로는 글자 폭 또는 노드 반지름 중 큰 쪽, 세로는 노드 위쪽부터 이름 아래까지. 글자 폭은 어림으로 센다(한글은 1em, 나머지는 약 0.6em).
    function textW(s, fs) { let w = 0; for (const ch of s) w += ch.codePointAt(0) > 0x2E7F ? 1 : 0.6; return w * fs; }
    function makeBoxes() {
      const lab = new Uint8Array(items.length); graph.order.slice(0, Lib.graphLabelCount(items.length, 1)).forEach((i) => { lab[i] = 1; }); // 40개를 넘으면 기본 배율에서 이름이 보이는 노드만 이름 크기의 상자를 쓴다
      boxes = items.map((m, i) => { const rad = radiusOf(i); if (!lab[i]) return { hw: rad * 1.2 + lfs * 0.4, hh: rad * 1.2 + lfs * 0.3, cy: 0 }; const w = textW(cutName(disp(m).title, 30), lfs); const t = -rad * 1.2 - lfs * 0.3; const b = rad * 1.2 + lfs * 1.35 + lfs * 0.3; return { hw: Math.max(w / 2, rad * 1.2) + lfs * 0.4, hh: (b - t) / 2, cy: (b + t) / 2 }; });
    }
    const boundsNow = () => { const fo = lastFit || fitOpts(); return { x0: 4, x1: VBW - 4, y0: fo.padTop, y1: VBH - fo.padBottom }; };
    // 맞춘 자리를 이름 상자가 겹치지 않게 퍼뜨린 자리로 바꾼다(끌어 옮긴 노드는 제자리). 이 자리가 새 자리 목표가 된다.
    function spread(fit) { return Lib.graphSettle(fit, graph.edges, boxes, boundsNow(), { pinned: moved }); }
    // 이름 글자 크기를 칸의 실제 배율에서 정한다(바뀌었을 때만 DOM 을 고친다)
    function sizeLabels() {
      if (!graph || !svgBuilt) return;
      const next = Math.round(LABEL_PX / scale() * 10) / 10; if (Math.abs(next - lfs) < 0.05) return;
      lfs = next; makeBoxes();
      nodeEls.forEach((n, i) => { const t = n.lastChild; t.setAttribute('font-size', String(lfs)); t.setAttribute('y', (radiusOf(i) * 1.2 + lfs).toFixed(1)); t.setAttribute('stroke-width', (lfs * 0.28).toFixed(2)); });
    }
    function ensureGraph() {
      if (graph) return graph;
      VBH = vbhFor($('mv-graph').getBoundingClientRect());
      svg.setAttribute('viewBox', '0 0 ' + VBW + ' ' + VBH); refreshScale(); lfs = Math.round(LABEL_PX / scale() * 10) / 10;
      const edges = Lib.buildMemoryGraph(items);
      const raw = Lib.simulateGraph(items.length, edges, { width: VBW, height: VBH }); // 원시 좌표는 그대로 두고 맞추기만 다시 한다
      const pos = Lib.fitGraph(raw, fitOpts());
      const nbr = items.map(() => new Set()); const deg = items.map(() => 0);
      for (const e of edges) { nbr[e.a].add(e.b); nbr[e.b].add(e.a); deg[e.a]++; deg[e.b]++; }
      graph = { edges, raw, pos, nbr, deg, order: Lib.graphLabelOrder(deg) };
      return graph;
    }
    // 칸 크기가 바뀌었을 때: 싼 것만 바로 한다(viewBox·글자 크기·맞춘 자리). 퍼뜨리기(힘 계산)는 잠깐 기다렸다 한 번만 한다.
    function refit() {
      if (!graph || !svgBuilt) return;
      const prevS = scl; refreshScale();
      const next = vbhFor($('mv-graph').getBoundingClientRect()); const vbhChanged = next !== VBH;
      if (!vbhChanged && Math.abs(scl - prevS) < 1e-6) return; // 배율이 바뀌었으면 세로 비율이 같아도 여백·경계를 다시 잡는다
      if (vbhChanged) { VBH = next; svg.setAttribute('viewBox', '0 0 ' + VBW + ' ' + VBH); }
      sizeLabels();
      const fit = Lib.fitGraph(graph.raw, fitOpts()); // 끌어 옮긴 노드는 그 자리를 지킨다(칸 아래로 벗어났을 때만 안쪽으로)
      const keep = graph.pos; graph.pos = fit.map((p, i) => (moved.has(i) ? { x: keep[i].x, y: Math.min(keep[i].y, VBH - 20) } : p));
      live.forEach((p, i) => { if (!moved.has(i)) p.free = false; });
      if (reduceMotion()) live.forEach((p, i) => { if (!p.pin) { p.x = graph.pos[i].x; p.y = graph.pos[i].y; p.vx = 0; p.vy = 0; } });
      // 움직임 줄이기가 아니면 실제 자리는 용수철로 부드럽게 새 자리 목표를 따라간다
      clearTimeout(spreadT); spreadT = setTimeout(respread, SPREAD_DEBOUNCE_MS);
      wake();
    }
    function respread() {
      spreadT = 0; if (!open || mode !== 'graph' || !graph || !svgBuilt) return;
      graph.pos = spread(graph.pos);
      if (reduceMotion()) live.forEach((p, i) => { if (!p.pin) { p.x = graph.pos[i].x; p.y = graph.pos[i].y; p.vx = 0; p.vy = 0; } });
      wake();
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
      if (mode === 'list') { stopLoop(); renderList(); } else renderGraph();
      renderDetail();
    }

    // ---- 목록 ----
    function renderList() {
      const box = $('mv-list'); box.replaceChildren(); rowEls = new Map();
      const ids = new Set(Lib.filterMemories(items, query, tag, texts));
      const frag = document.createDocumentFragment();
      let shown = 0;
      for (const type of TYPES) {
        const group = items.filter((m) => typeOf(m) === type && ids.has(m.id)).sort((a, b) => { const x = disp(a).title.toLowerCase(); const y = disp(b).title.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
        if (!group.length) continue;
        const h = el('h3', 'mv-gh'); h.append(el('span', 'mv-dot t-' + type), el('span', '', T('mem.type.' + type) + ' · ' + group.length));
        frag.append(h);
        for (const m of group) {
          const row = el('button', 'mv-row' + (m.id === selId ? ' sel' : '')); row.type = 'button'; row.dataset.id = m.id;
          row.setAttribute('aria-pressed', m.id === selId ? 'true' : 'false'); // 목록 역할 없이 누름 단추로만 둔다
          const dm = disp(m); const r1 = el('div', 'mv-r1'); r1.append(el('span', 'mv-name', dm.title), el('span', 'mv-date', fmtDate(m.modified)));
          row.append(r1);
          if (dm.description) row.append(el('div', 'mv-desc', dm.description));
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
      const dm = disp(m); const b = el('button', 'mv-link', dm.title); b.type = 'button'; b.dataset.id = id; b.title = dm.description || dm.title;
      return b;
    }
    function renderDetail() {
      const box = $('mv-detail'); box.replaceChildren();
      const m = selId ? byId.get(selId) : null;
      if (!m) { box.append(el('div', 'hint', T('mem.pick'))); return; }
      const type = typeOf(m);
      const dm = disp(m);
      box.append(el('h3', 'mv-d-title', dm.title));
      if (m.slug && m.slug !== dm.title) box.append(el('div', 'mv-d-slug', m.slug)); // [[링크]]에 쓰는 이름은 작고 흐리게 따로 보인다
      const meta = el('div', 'mv-d-meta'); meta.append(el('span', 'mv-dot t-' + type), el('span', '', T('mem.type.' + type)), el('span', '', T('mem.modified', { date: fmtDate(m.modified) })));
      box.append(meta);
      if (dm.description) box.append(el('div', 'mv-d-desc', dm.description));
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
      } else { applyHighlight(); if (selId && o && o.scroll) ensureVisible(idxOf.get(selId)); }
      renderDetail();
    }
    function setTag(t) {
      tag = t || ''; $('mv-tag').value = tag; if ($('mv-tag').value !== tag) tag = '';
      if (mode === 'list') renderList(); else { applyHighlight(); }
      renderDetail();
    }
    function setQuery(q) {
      query = q;
      if (mode === 'list') renderList(); else { applyHighlight(); }
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
    const tf = (x, y) => 'translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ')';
    function buildSvg() {
      resetDrag(); topK = -1; clearTimeout(spreadT); spreadT = 0;
      const g = ensureGraph();
      svg.replaceChildren();
      const rm = reduceMotion(); makeBoxes(); moved = new Set(); g.pos = spread(g.pos);
      const vp = svgEl('g'); vp.id = 'mv-vp';
      const hull = svgEl('g'); hull.id = 'mv-hulls';
      const eg = svgEl('g'); const ng = svgEl('g');
      // 살아 있는 자리: 처음엔 가운데 근처에서 시작해 자리 목표로 퍼져 나간다(움직임 줄이기면 바로 자리에)
      live = items.map((m, i) => { const a = g.pos[i]; return rm ? { x: a.x, y: a.y, vx: 0, vy: 0, pin: false } : { x: VBW / 2 + (a.x - VBW / 2) * 0.15, y: VBH / 2 + (a.y - VBH / 2) * 0.15, vx: 0, vy: 0, pin: false }; });
      wx = live.map((p) => p.x); wy = live.map((p) => p.y); moved = new Set(); clock = 0; entryMs = rm ? ENTRY_MS : 0; lbo = -1;
      edgeEls = g.edges.map((e) => {
        const l = svgEl('line', 'mv-e ' + e.kind);
        l.setAttribute('x1', live[e.a].x.toFixed(1)); l.setAttribute('y1', live[e.a].y.toFixed(1)); l.setAttribute('x2', live[e.b].x.toFixed(1)); l.setAttribute('y2', live[e.b].y.toFixed(1));
        eg.append(l); return l;
      });
      nodeEls = items.map((m, i) => {
        const rad = radiusOf(i);
        const n = svgEl('g', 'mv-node'); n.setAttribute('transform', tf(live[i].x, live[i].y));
        const halo = svgEl('circle', 'mv-halo'); halo.setAttribute('r', (rad * 1.5 + 5).toFixed(1));
        const p = svgEl('path', 'mv-n t-' + typeOf(m)); p.setAttribute('d', shapePath(typeOf(m), 0, 0, rad)); p.dataset.i = String(i);
        const lb = svgEl('text', 'mv-lb'); lb.textContent = cutName(disp(m).title, 30); lb.setAttribute('x', '0'); lb.setAttribute('y', (rad * 1.2 + lfs).toFixed(1));
        lb.setAttribute('text-anchor', 'middle'); lb.setAttribute('font-size', String(lfs)); lb.setAttribute('stroke-width', (lfs * 0.28).toFixed(2));
        const hit = svgEl('circle', 'mv-hit'); hit.setAttribute('r', (rad * 1.2 + 6).toFixed(1)); hit.dataset.i = String(i); // 보이지 않는 넉넉한 마우스 자리: 작은 노드·떠다니는 노드 위에서 호버가 안정적이다
        n.append(hit, halo, p, lb); ng.append(n); return n;
      });
      vp.append(hull, eg, ng); svg.append(vp);
      if (!rm) vp.setAttribute('opacity', '0');
      svgBuilt = true; view = { k: 1, tx: 0, ty: 0 }; tv = { ...view }; applyView();
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
      refreshScale(); $('mv-hint').textContent = T('mem.graph.hint'); legend(); // 여백을 재기 전에 안내 글·범례를 먼저 채운다
      if (!svgBuilt) buildSvg();
      applyHighlight(); applyView(); wake();
    }
    // 화면 배율은 한 번 재서 두고 쓴다(크기가 바뀔 때·처음 만들 때만 다시 잰다): 확대 중 매 프레임 레이아웃을 건드리지 않게
    function refreshScale() { const r = svg.getBoundingClientRect(); scl = r.width > 0 && r.height > 0 ? Math.min(r.width / VBW, r.height / VBH) : 1; }
    const scale = () => scl;
    // 이름 글자 투명도: 화면에서의 글자 크기(px)로 정해 맨 바깥 그룹의 클래스 하나에만 쓴다(노드마다 쓰지 않는다)
    function applyView() {
      const vp = $('mv-vp'); if (!vp) return;
      vp.setAttribute('transform', 'translate(' + view.tx.toFixed(2) + ' ' + view.ty.toFixed(2) + ') scale(' + view.k.toFixed(4) + ')');
      const o = Math.round(Lib.graphLabelOpacity(lfs * view.k * scale()) * 10); // 0~10 단계 클래스 하나(lb0~lb10): CSS 가 단계 사이를 부드럽게 잇는다
      if (o !== lbo) { lbo = o; vp.setAttribute('class', 'lb' + o); }
      applyLabelTop();
    }
    // 40개를 넘는 그래프는 확대 배율에 따라 연결이 많은 노드부터 이름을 보인다(lx = 아직 이름을 숨기는 노드). K 가 바뀔 때만 클래스를 고친다.
    function applyLabelTop() {
      if (!graph || !svgBuilt) return;
      const K = Lib.graphLabelCount(items.length, view.k); if (K === topK) return; topK = K;
      const limited = items.length > Lib.GRAPH_LABEL_ALL_MAX; const on = new Uint8Array(items.length); for (let q = 0; q < K; q++) on[graph.order[q]] = 1;
      nodeEls.forEach((n, i) => n.classList.toggle('lx', limited && !on[i]));
    }
    // 선택·태그·검색에 따른 강조: 선택이 있으면 그 노드와 이웃만 밝게, 없으면 태그·검색에 맞는 노드를 밝게(나머지는 흐리게)
    // 같은 (선택, 태그, 검색어)에는 한 번만 계산한다: 키 입력마다 거르기를 두 번 하지 않는다
    function focusSet() {
      const key = (selId || '') + '\u0001' + tag + '\u0001' + query;
      if (key === focusKey) return focusVal;
      let v = null;
      if (selId && idxOf.has(selId)) { const i = idxOf.get(selId); v = { set: new Set([i, ...graph.nbr[i]]), center: i }; }
      else if (tag || query.trim()) { const ids = Lib.filterMemories(items, query, tag, texts); v = { set: new Set(ids.map((id) => idxOf.get(id))), center: -1 }; }
      focusKey = key; focusVal = v; return v;
    }
    // 강조 클래스: dim(흐림) nb(마우스 올린 노드의 이웃) sel(선택) hov(마우스 아래) show(이름을 항상 보임). 전환은 CSS 가 부드럽게 한다.
    // 마우스를 올리면(끌고 있지 않을 때) 선택·검색 강조 위에서 잠시 그 노드와 이웃만 남기고 나머지는 강하게 흐린다. 떠나면 원래 강조가 돌아온다.
    function applyHighlight() {
      if (!graph || !svgBuilt) return;
      const base = focusSet();
      const h = !dragNode && hoverI >= 0 && items[hoverI] ? hoverI : -1;
      const f = h >= 0 ? { set: new Set([h, ...graph.nbr[h]]), center: h } : base;
      nodeEls.forEach((n, i) => {
        const inSet = !!f && f.set.has(i);
        n.classList.toggle('dim', !!f && !inSet); n.classList.toggle('sel', !!base && base.center === i);
        n.classList.toggle('nb', h >= 0 && i !== h && inSet); n.classList.toggle('hov', i === hoverI);
        n.classList.toggle('show', inSet || i === hoverI);
      });
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
    // 태그 묶음 테두리: 살아 있는 자리를 따라간다(경로 하나를 재사용)
    function drawHull() {
      const hg = $('mv-hulls'); if (!hg) return;
      if (!tag) { if (hg.firstChild) hg.replaceChildren(); return; }
      const pts = []; items.forEach((m, i) => { if (m.tags.some((x) => x.toLowerCase() === tag)) pts.push({ x: live[i].x, y: live[i].y }); });
      if (!pts.length) { hg.replaceChildren(); return; }
      const h = convexHull(pts);
      const d = h.length === 1 ? 'M' + h[0].x.toFixed(1) + ' ' + h[0].y.toFixed(1) + 'l0.1 0' : 'M' + h.map((q) => q.x.toFixed(1) + ' ' + q.y.toFixed(1)).join('L') + (h.length > 2 ? 'Z' : '');
      let a = hg.firstChild; if (!a) { a = svgEl('path', 'mv-hull'); a.setAttribute('stroke-width', '34'); hg.append(a); }
      a.setAttribute('d', d);
    }
    // ---- 움직임 루프: 그래프가 열려 있고 문서가 보일 때만 돈다. 가라앉으면(움직임 줄이기) 스스로 멈춘다 ----
    const needLoop = () => open && mode === 'graph' && svgBuilt && !document.hidden;
    function wake() { if (!raf && needLoop()) { lastT = 0; raf = requestAnimationFrame(frame); } }
    function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; lastT = 0; }
    function frame(now) {
      raf = 0;
      if (!needLoop() || !graph) return;
      const dt = lastT ? Math.min(Math.max(now - lastT, 0), Lib.GRAPH_DT_MAX_MS) : 16; lastT = now; clock += dt;
      const rm = reduceMotion(); let busy = !!dragNode;
      const vp = $('mv-vp');
      if (entryMs < ENTRY_MS) { // 들어올 때: 가운데에서 퍼지며 나타난다
        entryMs += dt; busy = true; const t = Math.min(1, entryMs / ENTRY_MS);
        if (t >= 1) vp.removeAttribute('opacity'); else vp.setAttribute('opacity', (1 - Math.pow(1 - t, 3)).toFixed(3));
      }
      // 이름 상자가 겹치지 않게 서로 밀어내고(용수철은 약하게), 칸 안에 머물게 한다. 창이 흐려지면 떠다님은 멈춰 가라앉고 루프가 잔다.
      // 250개를 넘으면 계산·그리기를 한 프레임 걸러 한다(시간은 모아서 넘긴다)
      const big = live.length > 250 && !dragNode && entryMs >= ENTRY_MS;
      if (big && (skipTick = !skipTick)) { accDt += dt; busy = true; }
      else {
        const sdt = dt + accDt; accDt = 0; const drift = !rm && !blurred;
        const r = Lib.graphStep(live, graph.pos, graph.edges, { dtMs: sdt, tMs: clock, amp: drift ? Lib.GRAPH_DRIFT_AMP : 0, boxes, spring: 3.5, damp: 7, bounds: boundsNow() });
        if (drift || r.move > 0.005) busy = true;
        const dirty = new Uint8Array(live.length); let any = false;
        for (let i = 0; i < live.length; i++) {
          const p = live[i];
          if (Math.abs(p.x - wx[i]) > 0.05 || Math.abs(p.y - wy[i]) > 0.05) { wx[i] = p.x; wy[i] = p.y; nodeEls[i].setAttribute('transform', tf(p.x, p.y)); dirty[i] = 1; any = true; } // 0.05 이하로 움직였으면 DOM 을 건드리지 않는다
        }
        if (any) {
          graph.edges.forEach((e, k) => {
            if (!dirty[e.a] && !dirty[e.b]) return;
            const l = edgeEls[k]; l.setAttribute('x1', wx[e.a].toFixed(1)); l.setAttribute('y1', wy[e.a].toFixed(1)); l.setAttribute('x2', wx[e.b].toFixed(1)); l.setAttribute('y2', wy[e.b].toFixed(1));
          });
          if (tag) drawHull();
        }
      }
      if (view.k !== tv.k || view.tx !== tv.tx || view.ty !== tv.ty) {
        const e = rm ? { ...tv, done: true } : Lib.graphEaseView(view, tv, dt, EASE_TAU_MS);
        view = { k: e.k, tx: e.tx, ty: e.ty }; if (!e.done) busy = true; applyView();
      }
      if (busy) raf = requestAnimationFrame(frame); else lastT = 0;
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopLoop(); else wake(); });
    window.addEventListener('blur', () => { blurred = true; }); // 창이 흐려지면 떠다님을 멈춰 가라앉힌다
    window.addEventListener('focus', () => { blurred = false; wake(); });
    // 보는 위치 목표를 바꾼다: 루프가 부드럽게 다가간다(움직임 줄이기이거나 루프가 안 돌면 바로 적용)
    function goView(t) {
      tv = t;
      if (reduceMotion() || !needLoop()) { view = { ...tv }; applyView(); } else wake();
    }
    function ensureVisible(i) {
      if (i === undefined || !graph || !live[i]) return;
      const rect = svg.getBoundingClientRect(); if (!(rect.width > 0)) return;
      const s = scale(); const ox = (rect.width - VBW * s) / 2; const oy = (rect.height - VBH * s) / 2;
      const x = (tv.tx + tv.k * graph.pos[i].x) * s + ox; const y = (tv.ty + tv.k * graph.pos[i].y) * s + oy;
      if (x > 30 && y > 30 && x < rect.width - 30 && y < rect.height - 30) return;
      goView({ k: tv.k, tx: (rect.width / 2 - ox) / s - tv.k * graph.pos[i].x, ty: (rect.height / 2 - oy) / s - tv.k * graph.pos[i].y });
    }
    function zoomAt(factor, cx, cy) { // cx, cy: svg 안의 화면 좌표(px). 목표 기준으로 곱해 휠을 빠르게 돌려도 이어진다
      const rect = svg.getBoundingClientRect(); const s = scale();
      const ox = (rect.width - VBW * s) / 2; const oy = (rect.height - VBH * s) / 2;
      const k2 = Math.min(K_MAX, Math.max(K_MIN, tv.k * factor)); if (k2 === tv.k) return;
      const vx = ((cx - ox) / s - tv.tx) / tv.k; const vy = ((cy - oy) / s - tv.ty) / tv.k;
      goView({ k: k2, tx: (cx - ox) / s - vx * k2, ty: (cy - oy) / s - vy * k2 });
    }
    function toGraph(e) { // 포인터 위치 -> 그래프 좌표(지금 보이는 위치 기준)
      const r = svg.getBoundingClientRect(); const s = scale();
      return { x: (((e.clientX - r.left) - (r.width - VBW * s) / 2) / s - view.tx) / view.k, y: (((e.clientY - r.top) - (r.height - VBH * s) / 2) / s - view.ty) / view.k };
    }
    // 포인터: 빈 곳을 끌면 이동, 노드를 끌면 그 노드가 따라온다(이웃은 연결 선으로 살짝 끌려온다). 거의 안 움직이고 놓으면 클릭(노드면 선택, 빈 곳이면 선택 해제)
    let drag = null;
    // 끌기 상태를 모두 풀고 잡았던 노드의 고정도 푼다(닫을 때·다시 그릴 때·포인터를 놓친 때)
    function resetDrag() {
      if (drag && drag.node >= 0 && drag.moved && live[drag.node]) live[drag.node].pin = false;
      drag = null; dragNode = false; svg.classList.remove('pan'); svg.classList.remove('nd');
    }
    const nodeAt = (t) => { const n = t && t.closest ? t.closest('[data-i]') : null; const i = n && n.dataset ? Number(n.dataset.i) : -1; return i >= 0 && items[i] ? i : -1; };
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false, target: e.target, node: nodeAt(e.target), off: null };
      try { svg.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
    });
    svg.addEventListener('pointermove', (e) => {
      if (drag && e.buttons === 0) { endDrag(e, true); return; } // 버튼을 이미 뗀 채 움직임이 오면 끌기를 취소한다
      if (drag) {
        const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) {
          drag.moved = true; hideTip();
          if (drag.node >= 0) { // 잡은 자리와 노드 중심의 차이를 두어 처음에 튀지 않게 한다
            const g0 = toGraph({ clientX: drag.x, clientY: drag.y }); const p = live[drag.node];
            drag.off = { x: p.x - g0.x, y: p.y - g0.y }; p.pin = true; p.free = true; dragNode = true; hoverI = drag.node; svg.classList.add('nd'); applyHighlight(); wake();
          } else { svg.classList.add('pan'); tv = { ...view }; }
        }
        if (drag.moved && drag.node >= 0) { const g1 = toGraph(e); const p = live[drag.node]; p.x = g1.x + drag.off.x; p.y = g1.y + drag.off.y; p.vx = 0; p.vy = 0; }
        else if (drag.moved) { const s = scale(); view.tx = drag.tx + dx / s; view.ty = drag.ty + dy / s; tv = { ...view }; applyView(); } // 이동은 지연 없이 바로
        return;
      }
      const i = nodeAt(e.target);
      if (i >= 0) { clearTimeout(hoverT); hoverT = 0; if (i !== hoverI) { hoverI = i; applyHighlight(); } showTip(e, items[i]); }
      else { hideTip(); if (hoverI >= 0 && !hoverT) hoverT = setTimeout(() => { hoverT = 0; hoverI = -1; applyHighlight(); }, 140); } // 노드 사이 빈틈을 지날 때 깜빡이지 않게 잠깐 기다렸다 푼다
    });
    const endDrag = (e, cancel) => {
      if (!drag) return; const d = drag; drag = null; svg.classList.remove('pan'); svg.classList.remove('nd');
      try { svg.releasePointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
      if (d.moved && d.node >= 0) {
        const p = live[d.node]; p.pin = false; dragNode = false; applyHighlight();
        if (!cancel) { graph.pos[d.node] = { x: p.x, y: p.y }; moved.add(d.node); } // 놓은 자리가 새 자리 목표(이번 열기 동안만)
        wake(); return;
      }
      if (cancel || d.moved) return;
      const i = nodeAt(d.target);
      select(i >= 0 ? items[i].id : null);
    };
    svg.addEventListener('lostpointercapture', (e) => { if (drag) endDrag(e, true); });
    svg.addEventListener('pointerup', (e) => endDrag(e, false));
    svg.addEventListener('pointercancel', (e) => endDrag(e, true));
    svg.addEventListener('pointerleave', () => { hideTip(); clearTimeout(hoverT); hoverT = 0; if (!drag && hoverI >= 0) { hoverI = -1; applyHighlight(); } });
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoomAt(Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.0016), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    function showTip(e, m) {
      const tip = $('mv-tip'); const wrap = $('mv-graph'); const r = wrap.getBoundingClientRect();
      tip.textContent = T('mem.graph.node', { name: disp(m).title, type: T('mem.type.' + typeOf(m)) });
      tip.hidden = false;
      const x = Math.min(e.clientX - r.left + 14, Math.max(4, r.width - tip.offsetWidth - 6)); const y = Math.min(e.clientY - r.top + 14, Math.max(4, r.height - tip.offsetHeight - 6));
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    }
    function hideTip() { $('mv-tip').hidden = true; }
    const center = () => { const r = svg.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
    $('mv-zin').addEventListener('click', () => zoomAt(1.4, ...center()));
    $('mv-zout').addEventListener('click', () => zoomAt(1 / 1.4, ...center()));
    $('mv-zreset').addEventListener('click', () => { // 처음 위치: 끌어 옮긴 자리도 맞춘 자리로 되돌린다
      if (graph && svgBuilt) { moved.clear(); live.forEach((p) => { p.free = false; }); graph.pos = spread(Lib.fitGraph(graph.raw, fitOpts())); if (reduceMotion()) live.forEach((p, i) => { p.x = graph.pos[i].x; p.y = graph.pos[i].y; p.vx = 0; p.vy = 0; }); wake(); }
      goView({ k: 1, tx: 0, ty: 0 });
    });
    new ResizeObserver(() => { if (!open || mode !== 'graph' || !graph || !svgBuilt) return; refit(); applyView(); }).observe($('mv-graph'));

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
      hide() { open = false; stopLoop(); resetDrag(); clearTimeout(spreadT); spreadT = 0; clearTimeout(hoverT); hoverT = 0; hoverI = -1; clearTimeout(searchTimer); $('mem-view').hidden = true; hideTip(); },
      clearSearch,
      // 언어를 바꾸면 이름 글자와 상자 크기를 새로 만든다(위치는 그대로, 한 번짜리 배치는 다시 돌리지 않는다)
      relabel() {
        if (!open) return;
        if (graph && svgBuilt) {
          nodeEls.forEach((n, i) => { n.lastChild.textContent = cutName(disp(items[i]).title, 30); });
          graph.order = Lib.graphLabelOrder(graph.deg); topK = -1; makeBoxes(); applyLabelTop(); wake();
        }
        render();
      },
      // 시험 전용(렌더러가 개발 실행에서만 부른다): 가운데를 기준으로 k 까지 확대하고/또는 연결이 가장 많은 노드를 고른다
      devPose(o) {
        if (!open || mode !== 'graph' || !svgBuilt || !graph) return;
        if (o && o.hover) { let b = 0; graph.deg.forEach((d, i) => { if (d > graph.deg[b]) b = i; }); hoverI = b; applyHighlight(); }
        if (o && o.sel) { let b = 0; graph.deg.forEach((d, i) => { if (d > graph.deg[b]) b = i; }); select(items[b].id); }
        if (o && o.zoom > 0) zoomAt(Math.min(K_MAX, Math.max(K_MIN, o.zoom)) / tv.k, ...center());
      },
      title: () => $('mv-title'),
    };
  }
  window.MaruMemView = { create };
})();
