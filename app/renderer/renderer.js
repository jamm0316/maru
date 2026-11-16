'use strict';
(function () {
  // 터미널 글꼴: 영문 고정폭 유지, 한글 글리프만 명조 계열로 대체(시스템 설치 글꼴만)
  const TERM_FONT = "MaruHangul, 'SF Mono', Menlo, monospace";
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const Lib = window.MaruLib;
  const I18N = window.MaruI18n;

  // ---- 언어·프로필 상태 ----
  let lang = 'ko';
  let profile = null;
  let version = '';
  const T = (key, params) => I18N.t(lang, key, params);

  // ---- 모달 관리: 열려 있는 동안 .app 은 inert(키 입력·포커스 불가), 터미널 stdin 도 막는다 ----
  const modals = []; // [{ el, prev, closable(), close() }]
  const modalOpen = () => modals.length > 0;
  function syncModalState() {
    $('app').inert = modals.length > 0;
    for (const e of terms.values()) e.term.options.disableStdin = modals.length > 0;
    modals.forEach((m, i) => { m.el.inert = i !== modals.length - 1; });
  }
  function openModal(backdrop, focusEl, opts) {
    closeMenu(false); closeUpdate(false);
    const m = { el: backdrop, prev: document.activeElement, closable: () => true, close: () => closeModal(backdrop), ...opts };
    modals.push(m);
    backdrop.hidden = false;
    syncModalState();
    if (focusEl) focusEl.focus();
    return m;
  }
  function closeModal(backdrop) {
    const i = modals.findIndex((m) => m.el === backdrop);
    if (i < 0) return;
    const [m] = modals.splice(i, 1);
    backdrop.hidden = true;
    backdrop.inert = false;
    syncModalState();
    if (m.prev && document.contains(m.prev) && !m.prev.closest('[inert]')) m.prev.focus(); else focusTerm();
  }
  function focusTerm() {
    if (modalOpen()) return;
    if (detailOpen) { $('pd-title').focus(); return; } // 상세가 터미널 자리를 차지하는 동안은 상세에 포커스를 둔다
    const e = terms.get(activeId); if (e && e.opened) e.term.focus();
  }
  // Tab 순환(모달 안에서만)
  function trapTab(e) {
    const top = modals[modals.length - 1];
    if (!top) return;
    const f = [...top.el.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"]), pre[tabindex]')].filter((n) => !n.disabled && !n.hidden && n.offsetParent !== null);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0]; const last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !top.el.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !top.el.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }

  // ---- 터미널: 작업 공간마다 xterm 하나를 살려 두고 활성만 보인다 ----
  // WebGL 은 활성 터미널에만 붙이고, 숨길 때 dispose 한다(컨텍스트 수 제한 회피). 비활성 터미널은 DOM 렌더러 없이도 버퍼만 유지한다.
  let detailOpen = false; let detailKey = null; let detail = null; let detailSig = ''; let detailSeq = 0; // 프로젝트 상세(아래 '프로젝트' 절). 열려 있으면 터미널은 숨기기만 한다
  const terms = new Map(); // id -> { id, term, fit, host, gl, opened, started, starting }
  let activeId = null;
  let wsList = [];
  function createTerm(id) {
    const host = el('div', 'term-host'); host.hidden = true; $('terminal').append(host);
    const term = new window.Terminal({
      fontFamily: TERM_FONT, fontSize: 14, lineHeight: 1.25,
      cursorBlink: true, allowProposedApi: false, scrollback: 5000,
      theme: {
        background: '#0E0B08', foreground: '#F3ECE4', cursor: '#FF8A2A', cursorAccent: '#0E0B08',
        selectionBackground: '#5C3A1A',
      },
    });
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.options.disableStdin = modalOpen();
    term.attachCustomKeyEventHandler((e) => {
      if (modalOpen()) return false;
      const seq = Lib.keyToSeq(e);
      if (seq === null) return true;
      if (e.type === 'keydown') window.maru.ptyWrite(id, seq);
      return false;
    });
    term.onData((d) => { if (!modalOpen()) window.maru.ptyWrite(id, d); });
    const e = { id, term, fit, host, gl: null, opened: false, started: false, starting: false, failed: false, noted: false };
    terms.set(id, e);
    return e;
  }
  function disposeTerm(e) {
    if (e.gl) { try { e.gl.dispose(); } catch (x) { /* 무시 */ } e.gl = null; }
    try { e.term.dispose(); } catch (x) { /* 무시 */ }
    e.host.remove(); terms.delete(e.id);
  }
  // 한글 글꼴이 로드된 뒤 다시 적용해 글자 아틀라스를 새로 만든다
  if (document.fonts && document.fonts.load) document.fonts.load('14px MaruHangul', '가').then(() => { for (const e of terms.values()) { e.term.options.fontFamily = TERM_FONT + ' '; e.term.options.fontFamily = TERM_FONT; } }).catch(() => {});

  function doFit() {
    const e = terms.get(activeId);
    if (detailOpen || !e || !e.opened || e.host.hidden) return; // 상세가 터미널을 가리는 동안은 맞추지 않는다(크기 0 으로 pty 를 줄이지 않게)
    try { e.fit.fit(); window.maru.ptyResize(e.id, e.term.cols, e.term.rows); } catch (x) { /* 레이아웃 전 */ }
  }
  // 활성 터미널만 보이고(나머지는 숨김, WebGL 해제), 보일 때 맞춤·재그리기. 처음 보일 때 open(숨겨진 채로 열면 글자 크기를 못 잼).
  function showActive(focus) {
    if (detailOpen) return; // 상세가 열려 있으면 터미널을 그리지 않는다(닫을 때 closeDetail 이 다시 부른다)
    for (const e of terms.values()) {
      if (e.id === activeId) continue;
      e.host.hidden = true;
      if (e.gl) { try { e.gl.dispose(); } catch (x) { /* 무시 */ } e.gl = null; }
    }
    const e = terms.get(activeId);
    if (!e) return;
    e.host.hidden = false;
    if (!e.opened) { e.term.open(e.host); e.opened = true; }
    if (!e.gl) {
      try {
        const gl = new window.WebglAddon.WebglAddon();
        gl.onContextLoss(() => { try { gl.dispose(); } catch (x) { /* 무시 */ } if (e.gl === gl) e.gl = null; });
        e.term.loadAddon(gl); e.gl = gl;
      } catch (x) { /* WebGL 불가 시 DOM 렌더러 */ }
    }
    doFit();
    try { e.term.refresh(0, e.term.rows - 1); } catch (x) { /* 무시 */ }
    if (focus) focusTerm();
  }
  async function startTerm(e) {
    if (e.started || e.starting) return;
    e.starting = true;
    let ok = false;
    try { ok = !!(await window.maru.ptyStart(e.id, e.term.cols, e.term.rows)); } catch (x) { ok = false; }
    e.starting = false; e.started = ok; e.failed = !ok;
    if (!ok && terms.has(e.id)) e.term.write('\r\n\x1b[38;5;208m' + T('term.fail') + '\x1b[0m\r\n');
    if (ok && e.id === activeId) focusTerm();
  }
  // 활성 작업 공간만 시작한다(복원된 나머지는 처음 열 때). 사용 불가(폴더 없음)는 시작하지 않고 한 번 알린다.
  function ensureStarted(e) {
    if (!e || e.started || e.starting || e.failed) return;
    const w = wsList.find((x) => x.id === e.id);
    if (!w) return;
    if (w.state === 'unavailable') {
      if (!e.noted) { e.noted = true; e.term.write('\r\n\x1b[38;5;208m' + T('term.unavailable') + '\x1b[0m\r\n'); }
      return;
    }
    e.noted = false;
    startTerm(e);
  }
  window.maru.onPtyData((id, d) => { const e = terms.get(id); if (e) e.term.write(d); });
  window.maru.onPtyExit((id, code) => {
    const e = terms.get(id);
    if (e) e.term.write('\r\n\x1b[38;5;208m' + T('term.exit', { code }) + '\x1b[0m\r\n');
  });
  window.maru.onPtyRestart(async (id) => {
    const e = terms.get(id);
    if (!e) return;
    e.term.reset(); e.failed = false; e.noted = false;
    try { e.started = !!(await window.maru.ptyRestart(id, e.term.cols, e.term.rows)); } catch (x) { e.started = false; }
    e.failed = !e.started;
    if (e.started && id === activeId) focusTerm();
  });
  new ResizeObserver(doFit).observe($('terminal'));
  window.addEventListener('resize', doFit);

  // ---- 작업 공간 목록 ----
  let wsSeq = 0; let wsKey = null;
  const stateKey = (s) => (['busy', 'idle', 'waiting', 'exited', 'pending', 'unavailable'].includes(s) ? s : 'none');
  async function syncWs() {
    const my = ++wsSeq;
    let r = null;
    try { r = await window.maru.getWorkspaces(); } catch (x) { r = null; }
    if (!r || !Array.isArray(r.list) || my !== wsSeq) return; // 더 새 요청이 있으면 버린다
    const prev = activeId;
    const ids = new Set(r.list.map((w) => w.id));
    const fresh = [];
    for (const w of r.list) if (!terms.has(w.id)) { const e = createTerm(w.id); fresh.push(e); if (w.bp) e.term.write('\x1b[?2004h'); } // 화면 복구로 다시 붙을 때 붙여넣기 모드를 되살린다
    for (const e of [...terms.values()]) if (!ids.has(e.id)) disposeTerm(e);
    wsList = r.list; activeId = ids.has(r.active) ? r.active : null;
    renderWs();
    if (activeId !== prev || fresh.some((e) => e.id === activeId)) { closeDetail(false); showActive(true); } // 상세가 터미널을 가린 채로는 xterm 을 열지 않는다(숨은 컨테이너에서 open 금지)
    ensureStarted(terms.get(activeId));
  }
  function renderWs() {
    const key = JSON.stringify([wsList, activeId, lang]);
    if (key === wsKey) return;
    wsKey = key;
    const box = $('workspaces');
    const f = document.activeElement;
    const fr = f && box.contains(f) ? f.closest('.ws') : null;
    const refocus = fr ? { id: fr.dataset.id, x: f.classList.contains('ws-x') } : null;
    box.replaceChildren();
    for (const w of wsList) {
      const on = w.id === activeId; const k = stateKey(w.state);
      const row = el('div', 'ws' + (on ? ' active' : '')); row.dataset.id = w.id; row.setAttribute('role', 'listitem');
      const main = el('button', 'ws-main'); main.type = 'button';
      if (on) main.setAttribute('aria-current', 'true');
      main.setAttribute('aria-label', T('ws.row.aria', { title: w.title, path: w.path, state: T('agent.' + k) }));
      const c = el('span', 'col');
      const l1 = el('span', 'l1'); l1.append(el('span', 'n', w.title), el('span', 'st ' + k, T('agent.' + k)));
      c.append(l1, el('span', 's', w.path));
      main.append(el('span', 'dot ' + k), c);
      main.title = w.path;
      main.addEventListener('click', async () => { closeDetail(true); try { await window.maru.activateWorkspace(w.id); } catch (x) { /* 무시 */ } syncWs(); });
      const x = el('button', 'ws-x', '×'); x.type = 'button'; x.setAttribute('aria-label', T('ws.close.aria', { title: w.title }));
      x.addEventListener('click', async () => { try { await window.maru.closeWorkspace(w.id); } catch (e) { /* 무시 */ } syncWs(); });
      row.append(main, x); box.append(row);
    }
    if (refocus) {
      const r = [...box.children].find((n) => n.dataset.id === refocus.id);
      const t = r && r.querySelector(refocus.x ? '.ws-x' : '.ws-main');
      if (t) t.focus();
    }
    $('ws-add').disabled = wsList.length >= Lib.WS_MAX;
    $('term-empty').hidden = wsList.length > 0 || detailOpen;
    const a = wsList.find((w) => w.id === activeId);
    $('term-name').textContent = a ? a.title : T('app.title');
    $('term-cwd').textContent = a ? a.path : '';
    renderBusy(a ? a.state : 'none');
  }
  async function newWs() { try { await window.maru.newWorkspace(); } catch (x) { /* 무시 */ } syncWs(); }
  $('ws-add').addEventListener('click', newWs);
  $('term-empty-new').addEventListener('click', newWs);
  $('workspaces').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...$('workspaces').querySelectorAll('.ws-main')]; const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  });
  window.maru.onWorkspacesChanged(() => syncWs());
  // ⌘W: 열린 모달·메뉴·팝오버가 있으면 그것을 닫고, 아니면 활성 작업 공간을 닫는다(확인은 main)
  window.maru.onCloseRequest(async () => {
    const act = Lib.closeRequestAction({ overlayOpen: modalOpen() || menuOpen || updOpen || detailOpen, hasActive: !!activeId });
    if (act === 'overlay') {
      if (modalOpen()) { const top = modals[modals.length - 1]; if (top.closable()) top.close(); }
      else if (menuOpen) closeMenu(true);
      else if (updOpen) closeUpdate(true);
      else closeDetail(true);
    } else if (act === 'workspace') {
      try { await window.maru.closeWorkspace(activeId); } catch (x) { /* 무시 */ }
      syncWs();
    }
  });

  // ---- 문구 적용 ----
  function applyStatic() {
    document.documentElement.lang = lang;
    document.title = T('app.title');
    for (const n of document.querySelectorAll('[data-i18n]')) n.textContent = T(n.dataset.i18n);
    for (const n of document.querySelectorAll('[data-i18n-aria]')) n.setAttribute('aria-label', T(n.dataset.i18nAria));
    for (const n of document.querySelectorAll('[data-i18n-title]')) n.title = T(n.dataset.i18nTitle);
    updateUserChip();
  }

  // ---- 패널 ----
  const pad = (n) => String(n).padStart(2, '0');
  function tickClock() { const d = new Date(); $('clock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtAt(at) {
    const d = new Date();
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return at.startsWith(today) ? at.slice(11, 16) : at.slice(5, 10) + ' ' + at.slice(11, 16);
  }

  let noteTimer = null;
  function note(msg) {
    const n = $('quest-note'); n.textContent = msg;
    clearTimeout(noteTimer); noteTimer = setTimeout(() => { n.textContent = ''; }, 4000);
  }

  let lastPanels = null;
  function renderStatic(p) {
    lastPanels = p;
    $('root-missing').hidden = !p.rootMissing;
    $('lv').textContent = 'LV ' + p.level.level;
    $('growth-left').textContent = T('growth.left', { n: p.level.memories });
    $('growth-right').textContent = T('growth.right', { n: p.level.toNext });
    $('bar').style.width = Math.round(p.level.ratio * 100) + '%';
    $('batt').textContent = p.battery ? T('batt', { p: p.battery.percent }) : T('batt.none');
    $('disk').textContent = p.disk ? T('disk', { gb: p.disk.freeGB }) : T('disk.none');
    $('upd-dot').hidden = !(p.updateAvailable || updNotice);
    $('upgrade-btn').title = p.updateAvailable ? T('user.upgrade.aria') : '';

    const party = $('party'); party.replaceChildren();
    for (const m of p.party) {
      const row = el('div', 'party-row' + (m.lead ? ' lead' : ''));
      const l = el('span'); l.append(el('b', '', m.name || T('app.title')), document.createTextNode(' ' + T('role.' + m.roleKey)));
      row.append(l, el('span', 'm', m.model)); party.append(row);
    }

    // 일정(opt-in, 읽기 전용): 오늘 → 내일
    const cg = $('cal-group'); cg.replaceChildren();
    const evs = Array.isArray(p.calendar) ? p.calendar : [];
    cg.hidden = !evs.length;
    if (evs.length) {
      cg.append(el('div', 'tag-head', T('cal.title')));
      let divided = false;
      for (const ev of evs) {
        if (ev.day === 'tomorrow' && !divided) { divided = true; cg.append(el('div', 'cal-div', T('cal.tomorrow'))); }
        const r = el('div', 'cal-ev');
        r.append(el('span', 'cal-t', ev.allDay ? T('cal.allday') : ev.time), el('span', 'cal-n', ev.title));
        cg.append(r);
      }
    }

    const q = $('quests'); q.replaceChildren();
    if (!p.todos.length) q.append(el('div', 'empty', T('todo.empty')));
    let prevTag = null;
    p.todos.forEach((it, i) => {
      if (it.tag !== prevTag) { prevTag = it.tag; q.append(el('div', 'tag-head', it.tag === '추천' ? T('todo.tag.suggest') : it.tag)); }
      const canFill = !!it.prompt;
      const b = el(canFill ? 'button' : 'div', 'todo' + (canFill ? '' : ' manual'));
      if (canFill) b.type = 'button';
      const body = el('span', 'body'); body.append(el('span', 't', it.title));
      if (canFill) { const pe = el('span', 'p', it.prompt); pe.title = it.prompt; body.append(pe); }
      const imp = el('span', 'imp');
      if (Lib.todoStarred(it.importance)) { imp.textContent = '★'; imp.title = T('todo.imp'); imp.setAttribute('aria-label', imp.title); }
      b.append(imp, body);
      if (!canFill) b.append(el('span', 'own', T('todo.own')));
      if (canFill) b.addEventListener('click', async () => {
        closeDetail(false); // 상세가 열려 있으면 터미널로 돌아간 뒤 채운다
        let res = null;
        try { res = await window.maru.fillQuest(activeId || '', i, Lib.todoKey(it)); } catch (e) { /* 무시 */ }
        if (!res || !res.ok) note(T(Lib.fillNoticeKey(res && res.reason)));
        focusTerm();
      });
      q.append(b);
    });

    renderProjects(p.projects);
    if (detailOpen) fetchDetail(false);

    const sk = $('skills'); sk.replaceChildren();
    for (const n of p.skills) sk.append(el('span', 'chip', n));
    $('skills-count').textContent = T('skills.count', { n: p.skills.length, p: p.pendingSkillProposals });

    const br = $('briefing'); br.replaceChildren();
    if (!p.briefing.length) br.append(el('div', 'empty', T('brief.empty')));
    for (const e of p.briefing) {
      const row = el('div', 'brief'); row.append(el('span', 'at', fmtAt(e.at)), el('span', '', T('ev.' + e.code, { n: e.n }))); br.append(row);
    }
  }

  // ---- 프로젝트: 왼쪽 목록(카테고리 > 프로젝트)과 가운데 상세 ----
  // 모든 문구는 textContent 로만 넣는다. 키는 main 의 목록에서 온 값이고, 상태 변경·이어서 하기는 main 이 키를 다시 대조한다.
  let projView = { open: [], done: [], doneCount: 0 };
  let doneOpen = false; // 접힘 상태는 저장하지 않는다
  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  function projTitle(it) { return it.kind === 'unclassified' ? T('proj.unclassified') : it.title; }
  function projRow(it) {
    const b = el('button', 'proj' + (it.kind === 'unclassified' ? ' unc' : '') + (it.key === detailKey ? ' on' : '')); b.type = 'button'; b.dataset.key = it.key;
    const name = projTitle(it);
    let cnt;
    if (it.status === 'done') cnt = el('span', 'cnt', it.doneAt || '');
    else if (it.needsCheck) cnt = el('span', 'cnt check', T('proj.check'));
    else cnt = el('span', 'cnt', T('proj.todos', { n: it.openTodos }));
    b.append(el('span', 'pt', name), cnt);
    b.title = name;
    if (it.key === detailKey) b.setAttribute('aria-current', 'true');
    b.setAttribute('aria-label', T('proj.row.aria', { title: name, state: cnt.textContent }));
    b.addEventListener('click', () => openDetail(it.key));
    return b;
  }
  function fillGroups(box, groups) {
    for (const g of groups) { box.append(el('div', 'proj-cat', g.tag)); for (const it of g.items) box.append(projRow(it)); }
  }
  function renderProjects(pv) {
    projView = pv && Array.isArray(pv.open) && Array.isArray(pv.done) ? pv : { open: [], done: [], doneCount: 0 };
    const card = $('proj-card'); const f = document.activeElement;
    const refocus = f && card.contains(f) ? (f.dataset.key ? 'k:' + f.dataset.key : f.id === 'proj-done-toggle' ? 't' : null) : null;
    const box = $('projects'); box.replaceChildren();
    if (!projView.open.length) box.append(el('div', 'empty', T('proj.empty')));
    fillGroups(box, projView.open);
    const n = projView.doneCount | 0;
    const tg = $('proj-done-toggle'); tg.hidden = n === 0; tg.textContent = T('proj.done.toggle', { n });
    tg.setAttribute('aria-label', T('proj.done.toggle', { n }) + ' — ' + T('proj.done.aria'));
    tg.setAttribute('aria-expanded', String(doneOpen && n > 0));
    const done = $('projects-done'); done.replaceChildren(); done.hidden = !doneOpen || n === 0;
    if (!done.hidden) fillGroups(done, projView.done);
    if (refocus) {
      const t = refocus === 't' ? tg : [...card.querySelectorAll('.proj')].find((x) => 'k:' + x.dataset.key === refocus);
      if (t && !t.hidden) t.focus();
    }
  }
  $('proj-done-toggle').addEventListener('click', () => { doneOpen = !doneOpen; if (lastPanels) renderProjects(lastPanels.projects); $('proj-done-toggle').focus(); });

  function openDetail(key) {
    detailKey = key; detailOpen = true; detail = null; detailSig = '';
    $('terminal').hidden = true; $('term-empty').hidden = true; $('proj-detail').hidden = false;
    $('pd-note').textContent = '';
    if (lastPanels) renderProjects(lastPanels.projects);
    fetchDetail(true);
  }
  // 시험 전용: 첫 프로젝트(없으면 첫 '분류 안 됨')의 상세를 연다
  function openFirstProject() {
    const all = projView.open.flatMap((g) => g.items);
    const it = all.find((x) => x.kind === 'project') || all[0];
    if (it) openDetail(it.key);
  }
  function closeDetail(refocus) {
    if (!detailOpen) return;
    detailOpen = false; detailKey = null; detail = null; detailSig = ''; detailSeq++;
    $('proj-detail').hidden = true; $('terminal').hidden = false; $('term-empty').hidden = wsList.length > 0;
    if (lastPanels) renderProjects(lastPanels.projects);
    showActive(false); // 숨겨 둔 동안 바뀐 크기를 다시 맞추고 그린다(pty 는 그대로 살아 있다)
    if (refocus) focusTerm();
  }
  async function fetchDetail(first) {
    const my = ++detailSeq; const key = detailKey;
    let d = null;
    try { d = await window.maru.getProjectDetail(key); } catch (x) { d = null; }
    if (my !== detailSeq || !detailOpen || key !== detailKey) return;
    if (!d || d.key !== key) { closeDetail(true); return; } // 합쳐졌거나 사라진 프로젝트
    const sig = JSON.stringify(d);
    if (sig === detailSig && !first) return;
    detailSig = sig; detail = d; renderDetail(first);
  }
  function detailActions(d) {
    const acts = $('pd-actions'); acts.replaceChildren();
    if (d.kind !== 'project') return;
    const btn = (label, fn, cls, k) => { const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.dataset.k = k; b.addEventListener('click', fn); acts.append(b); return b; };
    btn(T('proj.act.continue'), doContinue, 'primary', 'continue');
    btn(T(d.status === 'done' ? 'proj.act.reopen' : 'proj.act.done'), () => setProjStatus(d.status === 'done' ? 'open' : 'done'), '', 'status');
    btn(T('proj.act.rename'), () => openProjDialog('rename'), '', 'rename');
    if (d.status === 'open') { const m = btn(T('proj.act.merge'), () => openProjDialog('merge'), '', 'merge'); if (!d.mergeTargets.length) m.title = T('proj.merge.none'); }
  }
  function renderDetail(focusTitle) {
    const d = detail; if (!d) return;
    const f = document.activeElement; const had = f && $('pd-actions').contains(f) ? f.dataset.k : null;
    $('proj-detail').setAttribute('aria-label', T('proj.detail.aria'));
    $('pd-tag').textContent = d.tag;
    $('pd-title').textContent = d.kind === 'unclassified' ? T('proj.unclassified') : d.title;
    const st = $('pd-status'); st.hidden = d.kind !== 'project';
    st.className = 'pill ' + (d.status === 'done' ? 'ok' : 'open'); st.textContent = T(d.status === 'done' ? 'proj.status.done' : 'proj.status.open', { date: d.doneAt || '' }).trim();
    $('pd-meta').textContent = d.lastDay ? T('proj.meta', { date: d.lastDay, n: d.records }) : T('proj.meta.none');
    const sg = $('pd-suggest'); sg.hidden = !(d.needsCheck && d.status === 'open');
    if (!sg.hidden) $('pd-suggest-text').textContent = T('proj.suggest', { days: Lib.daysBetween(todayStr(), d.lastDay) });
    $('pd-suggest-btn').hidden = d.kind !== 'project';
    const td = $('pd-todos'); td.replaceChildren();
    if (!d.todos.length) td.append(el('div', 'empty', T('proj.none')));
    for (const t of d.todos) {
      const r = el('div', 'pd-todo'); const imp = el('span', 'imp');
      if (Lib.todoStarred(t.importance)) { imp.textContent = '★'; imp.title = T('todo.imp'); imp.setAttribute('aria-label', imp.title); }
      r.append(imp, el('span', '', t.title)); td.append(r);
    }
    const lg = $('pd-log'); lg.replaceChildren();
    if (!d.log.length) lg.append(el('div', 'empty', T('proj.none')));
    for (const e of d.log) {
      const r = el('div', 'pd-row'); r.append(el('span', 'd', e.day), el('span', 'k k-' + e.kind, T('proj.kind.' + e.kind)), el('span', 'x', e.text)); lg.append(r);
    }
    const mm = $('pd-mem'); mm.replaceChildren();
    if (!d.memories.length) mm.append(el('span', 'empty', T('proj.none')));
    for (const m of d.memories) { const c = el('span', 'chip', m.name); if (m.description) c.title = m.description; mm.append(c); }
    detailActions(d);
    if (had) { const n = $('pd-actions').querySelector('[data-k="' + had + '"]'); if (n) n.focus(); }
    else if (focusTitle) $('pd-title').focus();
  }
  $('pd-close').addEventListener('click', () => closeDetail(true));
  $('pd-suggest-btn').addEventListener('click', () => setProjStatus('done'));
  function projErr(res) { return T(res && res.reason === 'save' ? 'proj.err.save' : res && res.reason === 'size' ? 'proj.err.size' : 'proj.err.invalid'); }
  async function setProjStatus(status) {
    if (!detail) return;
    let res = null; try { res = await window.maru.setProjectStatus(detail.key, status); } catch (x) { res = null; }
    $('pd-note').textContent = res && res.ok ? '' : projErr(res);
    await poll(); fetchDetail(false);
  }
  async function doContinue() {
    if (!detail) return;
    let res = null; try { res = await window.maru.continueProject(activeId || '', detail.key, detail.title); } catch (x) { res = null; }
    if (res && res.ok) { closeDetail(true); return; } // 입력줄에 채웠다(Enter 는 사용자가)
    $('pd-note').textContent = T(Lib.fillNoticeKey(res && res.reason));
  }

  // 이름 바꾸기 / 합치기 대화상자
  let pjMode = 'rename'; let pjPick = null; let pjBusy = false;
  function renderPjPick() {
    const seg = $('pj-pick'); seg.replaceChildren();
    const targets = detail ? detail.mergeTargets : [];
    targets.forEach((t, i) => {
      const on = pjPick === t.key;
      const b = el('button', 'seg-b' + (on ? ' on' : ''), t.title); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(on));
      b.tabIndex = on || (pjPick === null && i === 0) ? 0 : -1;
      b.addEventListener('click', () => { pjPick = t.key; renderPjPick(); [...seg.children][i].focus(); });
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const j = (i + (e.key === 'ArrowDown' ? 1 : -1) + targets.length) % targets.length;
        pjPick = targets[j].key; renderPjPick(); [...seg.children][j].focus();
      });
      seg.append(b);
    });
    $('pj-ok').disabled = pjMode === 'merge' && pjPick === null;
  }
  function openProjDialog(mode) {
    if (!detail || detail.kind !== 'project' || modalOpen()) return;
    pjMode = mode; pjPick = null; pjBusy = false;
    const rename = mode === 'rename';
    $('pj-title').textContent = T(rename ? 'proj.rename.title' : 'proj.merge.title');
    $('pj-name-wrap').hidden = !rename; $('pj-pick-wrap').hidden = rename;
    const none = !rename && !detail.mergeTargets.length;
    $('pj-hint').textContent = rename ? T('proj.rename.hint') : T(none ? 'proj.merge.none' : 'proj.merge.hint');
    $('pj-err').textContent = '';
    $('pj-ok').textContent = T(rename ? 'common.save' : 'proj.merge.ok'); $('pj-ok').disabled = none;
    if (rename) { $('pj-input').value = detail.title; } else renderPjPick();
    openModal($('dlg-proj'), rename ? $('pj-input') : ($('pj-pick').querySelector('.seg-b') || $('pj-cancel')), { closable: () => !pjBusy });
    if (rename) $('pj-input').select();
  }
  async function submitProjDialog() {
    if (pjBusy || !detail) return;
    let res = null;
    if (pjMode === 'rename') {
      const name = Lib.cleanProjectTitle($('pj-input').value);
      if (!name) { $('pj-err').textContent = T('proj.rename.err'); $('pj-input').focus(); return; }
      pjBusy = true; $('pj-ok').disabled = true;
      try { res = await window.maru.renameProject(detail.key, name); } catch (x) { res = null; }
    } else {
      if (pjPick === null) return;
      pjBusy = true; $('pj-ok').disabled = true;
      try { res = await window.maru.mergeProject(detail.key, pjPick); } catch (x) { res = null; }
    }
    pjBusy = false; $('pj-ok').disabled = false;
    if (!res || !res.ok) { $('pj-err').textContent = res && res.reason === 'title' ? T('proj.rename.err') : projErr(res); return; }
    if (pjMode === 'merge') { detailKey = pjPick; detail = null; detailSig = ''; }
    closeModal($('dlg-proj'));
    await poll(); fetchDetail(true);
  }
  $('pj-ok').addEventListener('click', submitProjDialog);
  $('pj-cancel').addEventListener('click', () => { if (!pjBusy) closeModal($('dlg-proj')); });
  $('pj-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submitProjDialog(); } });

  // ---- 상태 링 움직임(lib.js stepRing 으로 속도가 부드럽게 바뀐다) ----
  let ringMode = 'none'; let ringSt = Lib.ringInit(); let ringRaf = 0; let ringLast = 0;
  const reducedMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !!(reducedMq && reducedMq.matches);
  function paintRing() {
    const v = Lib.ringView(ringSt);
    $('ring1').setAttribute('transform', 'rotate(' + v.rot1.toFixed(2) + ' 110 110)');
    $('ring2').setAttribute('transform', 'rotate(' + v.rot2.toFixed(2) + ' 110 110)');
    $('ring1-arc').setAttribute('stroke-dasharray', v.arc.toFixed(1) + ' 40 30 40');
    $('core-dot').setAttribute('transform', 'translate(110 110) scale(' + v.dot.toFixed(3) + ') translate(-110 -110)');
    $('core').style.transform = 'translateY(' + v.ty.toFixed(2) + 'px) scale(' + v.scale.toFixed(4) + ')';
  }
  function ringFrame(now) {
    ringRaf = 0;
    if (document.hidden) return; // 숨겨진 동안 멈춘다. 다시 보이면 kickRing 이 이어서(점프 없이) 돈다
    const iv = Lib.ringFrameInterval(ringSt, ringMode);
    if (iv > 0 && ringLast && now - ringLast < iv - 2) { ringRaf = requestAnimationFrame(ringFrame); return; } // 조용할 때는 약 30fps
    const dt = ringLast ? now - ringLast : 0; ringLast = now;
    ringSt = Lib.stepRing(ringSt, dt, ringMode, false);
    paintRing();
    if (Lib.ringFrameInterval(ringSt, ringMode) < 0) return; // 완전히 가라앉았으면 멈춘다(상태가 바뀌면 kickRing 이 다시 돌림)
    ringRaf = requestAnimationFrame(ringFrame);
  }
  function kickRing() {
    if (reduced()) { cancelAnimationFrame(ringRaf); ringRaf = 0; ringSt = Lib.stepRing(ringSt, 0, ringMode, true); paintRing(); return; }
    if (!ringRaf && !document.hidden) { ringLast = 0; ringRaf = requestAnimationFrame(ringFrame); }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(ringRaf); ringRaf = 0; } else kickRing(); });
  if (reducedMq && reducedMq.addEventListener) reducedMq.addEventListener('change', () => { if (!reduced()) ringSt = Lib.ringInit(); kickRing(); });

  let lastAgent = 'none';
  function renderBusy(agent) {
    lastAgent = agent;
    const core = document.querySelector('.core');
    const k = stateKey(agent);
    core.classList.toggle('idle', agent !== 'busy' && agent !== 'waiting');
    core.classList.toggle('still', k === 'exited' || k === 'pending' || k === 'unavailable');
    ringMode = k; kickRing();
    core.classList.toggle('waiting', agent === 'waiting');
    $('status-main').textContent = T('agent.' + k);
    $('status-sub').textContent = T('agent.' + k + '.sub');
    $('core').setAttribute('aria-label', T('core.aria', { s: T('agent.' + k) }));
  }

  let lastKey = null;
  async function poll() {
    try {
      const p = await window.maru.getPanels();
      if (p) {
        const key = JSON.stringify(p);
        if (key !== lastKey) { lastKey = key; renderStatic(p); window.maru.notifyRendered(); }
      }
    } catch (e) { /* 다음 주기에 재시도 */ }
  }

  // ---- 언어 전환(즉시, 저장은 프로필이 있을 때만) ----
  function relabel() {
    applyStatic();
    if (lastPanels) renderStatic(lastPanels);
    wsKey = null; renderWs();
    if (detailOpen && detail) renderDetail(false);
    if (setRows) renderSettings();
    if (!$('pop-update').hidden) renderUpdate();
    renderLangSeg();
    if (!$('dlg-name').hidden) fillNameDialog();
  }
  async function setLang(l) {
    if (!I18N.isLang(l) || l === lang) return;
    lang = l;
    relabel();
    if (profile) {
      try { const r = await window.maru.setProfile({ lang: l }); if (r && r.ok) profile = r.profile; } catch (e) { /* UI 언어는 이미 바뀜 */ }
    }
  }

  // ---- 사용자 칩 ----
  function updateUserChip() {
    const name = profile ? profile.name : '';
    $('user-name').textContent = name;
    $('avatar-ch').textContent = name ? [...name][0].toUpperCase() : '·';
  }

  // ---- 사용자 메뉴(칩 위로 열림) ----
  let menuOpen = false;
  function placeAbove(pop, anchor, alignEl) {
    const r = anchor.getBoundingClientRect();
    const ar = (alignEl || anchor).getBoundingClientRect();
    pop.style.top = 'auto';
    const w = pop.offsetWidth;
    pop.style.left = Math.max(8, Math.min(ar.left, window.innerWidth - w - 8)) + 'px';
    pop.style.bottom = Math.max(8, window.innerHeight - r.top + 6) + 'px';
  }
  function menuItems() { return [...$('user-menu').querySelectorAll('[role^="menuitem"]:not([aria-disabled="true"])')]; }
  function buildMenu() {
    const m = $('user-menu'); m.replaceChildren();
    const item = (label, role, fn, checked) => {
      const b = el('button', 'mi', label); b.type = 'button'; b.setAttribute('role', role); b.tabIndex = -1;
      if (role === 'menuitemradio') { b.setAttribute('aria-checked', String(!!checked)); b.classList.toggle('on', !!checked); }
      b.addEventListener('click', () => { closeMenu(false); fn(); });
      return b;
    };
    m.append(item(T('menu.settings'), 'menuitem', openSettings));
    m.append(el('div', 'sep')); m.lastChild.setAttribute('role', 'separator');
    const g = el('div', 'grp'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', T('menu.language'));
    g.append(el('div', 'mlabel', T('menu.language')));
    g.append(item(T('lang.ko'), 'menuitemradio', () => setLang('ko'), lang === 'ko'), item(T('lang.en'), 'menuitemradio', () => setLang('en'), lang === 'en'));
    m.append(g);
    m.append(el('div', 'sep')); m.lastChild.setAttribute('role', 'separator');
    m.append(item(T('menu.rename'), 'menuitem', () => openNameDialog('rename')));
    m.append(el('div', 'sep')); m.lastChild.setAttribute('role', 'separator');
    const v = el('div', 'mi ver', T('menu.version', { v: version || '-' })); v.setAttribute('role', 'menuitem'); v.setAttribute('aria-disabled', 'true'); v.tabIndex = -1;
    m.append(v);
  }
  function openMenu() {
    if (modalOpen()) return;
    closeUpdate(false);
    buildMenu();
    const m = $('user-menu'); m.hidden = false;
    placeAbove(m, $('user-chip'));
    menuOpen = true; $('user-chip').setAttribute('aria-expanded', 'true');
    const items = menuItems(); const cur = items[0];
    if (cur) cur.focus();
  }
  function closeMenu(refocus) {
    if (!menuOpen) return;
    menuOpen = false; $('user-menu').hidden = true; $('user-chip').setAttribute('aria-expanded', 'false');
    if (refocus) $('user-chip').focus();
  }
  $('user-chip').addEventListener('click', () => { if (menuOpen) closeMenu(true); else openMenu(); });
  $('user-chip').addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); if (!menuOpen) openMenu(); } });
  $('user-menu').addEventListener('keydown', (e) => {
    const items = menuItems(); const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === 'Tab') { closeMenu(false); }
  });

  // ---- 이름 입력(첫 실행 / 이름 바꾸기) ----
  let nameMode = 'onboard';
  let nameBusy = false;
  let pickLang = 'ko';
  function renderLangSeg() {
    const seg = $('name-lang'); seg.replaceChildren();
    for (const l of I18N.LANGS) {
      const b = el('button', 'seg-b' + (pickLang === l ? ' on' : ''), T('lang.' + l));
      b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(pickLang === l)); b.tabIndex = pickLang === l ? 0 : -1;
      b.addEventListener('click', () => { pickLang = l; setLang(l); renderLangSeg(); });
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        pickLang = pickLang === 'ko' ? 'en' : 'ko'; setLang(pickLang); renderLangSeg();
        [...seg.children].find((n) => n.getAttribute('aria-checked') === 'true').focus();
      });
      seg.append(b);
    }
  }
  function fillNameDialog() {
    const onboard = nameMode === 'onboard';
    $('name-title').textContent = T(onboard ? 'ob.title' : 'rename.title');
    $('name-ok').textContent = T(onboard ? 'ob.confirm' : 'common.save');
  }
  function openNameDialog(mode) {
    nameMode = mode; nameBusy = false; pickLang = lang;
    const onboard = mode === 'onboard';
    $('name-cancel').hidden = onboard;
    $('name-lang-wrap').hidden = !onboard;
    $('name-input').value = onboard ? '' : (profile ? profile.name : '');
    $('name-err').textContent = '';
    fillNameDialog(); renderLangSeg();
    openModal($('dlg-name'), $('name-input'), { closable: () => !onboard && !nameBusy });
    $('name-input').select();
  }
  async function submitName() {
    if (nameBusy) return;
    const name = Lib.cleanName($('name-input').value);
    if (!name) { $('name-err').textContent = T('ob.err.name'); $('name-input').focus(); return; }
    nameBusy = true; $('name-ok').disabled = true;
    let res = null;
    try { res = await window.maru.setProfile(nameMode === 'onboard' ? { name, lang } : { name }); } catch (e) { res = null; }
    nameBusy = false; $('name-ok').disabled = false;
    if (!res || !res.ok) { $('name-err').textContent = T(res && res.reason === 'name' ? 'ob.err.name' : 'ob.err.save'); return; }
    profile = res.profile; lang = profile.lang;
    relabel();
    closeModal($('dlg-name'));
  }
  $('name-ok').addEventListener('click', submitName);
  $('name-cancel').addEventListener('click', () => { if (!nameBusy) closeModal($('dlg-name')); });
  $('name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submitName(); } // 한글 조합 중 Enter 는 확정용
  });

  // ---- 확인 대화상자(미리보기 → 확인 → 결과) ----
  // opts: { title, note, out, okLabel, cancelLabel, onConfirm: async () => ({ title, note, out }) }
  function askConfirm(opts) {
    return new Promise((resolve) => {
      const dlg = $('dlg-confirm'); let busy = false; let done = false;
      const show = (o) => {
        $('cf-title').textContent = o.title || ''; $('cf-note').textContent = o.note || '';
        $('cf-out').textContent = o.out || ''; $('cf-out').hidden = !o.out;
      };
      show(opts);
      $('cf-ok').hidden = !opts.onConfirm; $('cf-ok').disabled = false; $('cf-ok').textContent = opts.okLabel || T('common.confirm');
      $('cf-cancel').disabled = false; $('cf-cancel').textContent = opts.cancelLabel || T('common.cancel');
      const finish = () => { $('cf-ok').onclick = null; $('cf-cancel').onclick = null; closeModal(dlg); resolve(); };
      $('cf-cancel').onclick = () => { if (!busy) finish(); };
      $('cf-ok').onclick = async () => {
        if (busy || done) return;
        busy = true; $('cf-ok').disabled = true; $('cf-cancel').disabled = true;
        if (opts.runningLabel) $('cf-ok').textContent = opts.runningLabel;
        let r;
        try { r = await opts.onConfirm(); } catch (e) { r = { title: T('set.fail') }; }
        busy = false; done = true;
        if (r) show(r);
        $('cf-ok').hidden = true; $('cf-cancel').disabled = false; $('cf-cancel').textContent = T('common.close'); $('cf-cancel').focus();
      };
      openModal(dlg, opts.onConfirm ? $('cf-ok') : $('cf-cancel'), { closable: () => !busy, close: finish });
    });
  }

  // ---- 설정 시트 ----
  const ROW_IDS = ['auth', 'hooks', 'dream', 'acc', 'screen', 'auto', 'cal', 'tg', 'mem'];
  const PANES = { openAccessibility: 'accessibility', openScreen: 'screen', openAutomation: 'automation', openCalendars: 'calendars' };
  let setRows = null; let setLoading = false; const rowNotes = {};
  function openSettings() {
    if (modalOpen()) return;
    openModal($('dlg-settings'), $('set-close'), { close: () => { closeModal($('dlg-settings')); setRows = null; } });
    setRows = ROW_IDS.map((id) => ({ id, status: null }));
    renderSettings();
    loadSettings(false);
  }
  async function loadSettings(recheck) {
    if (setLoading) return;
    setLoading = true; $('set-recheck').disabled = true; renderSettings();
    let res = null;
    try { res = await window.maru.getSettings(recheck); } catch (e) { res = null; }
    setLoading = false; $('set-recheck').disabled = false;
    if ($('dlg-settings').hidden) return;
    if (res && Array.isArray(res.rows)) setRows = res.rows;
    renderSettings();
  }
  function renderSettings() {
    const box = $('set-rows');
    const hadFocus = box.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    box.replaceChildren();
    for (const r of setRows || []) {
      const row = el('div', 'srow'); row.setAttribute('role', 'listitem');
      const left = el('div', 'sl');
      left.append(el('div', 'sn', T('set.' + r.id + '.name')), el('div', 'sd', T('set.' + r.id + '.desc')));
      if (r.detail) {
        const p = { ...r.detail.params };
        if (r.detail.key === 'mem.ok') p.j = T('mem.journal.' + p.j);
        left.append(el('div', 'sx' + (r.status === 'need' ? ' sx-warn' : ''), T(r.detail.key, p)));
      } else left.append(el('div', 'sx', T('set.checking')));
      if (rowNotes[r.id]) { const n = el('div', 'sx note', rowNotes[r.id]); n.setAttribute('role', 'status'); left.append(n); }
      const right = el('div', 'sr');
      right.append(el('span', 'pill ' + (r.status || 'wait'), r.status ? T('pill.' + r.status) : '…'));
      if (r.toggle) {
        const lab = el('label', 'tog'); const cb = el('input'); cb.type = 'checkbox'; cb.setAttribute('role', 'switch'); cb.checked = r.toggle.on; cb.disabled = !r.toggle.available || setLoading; cb.dataset.k = 'tog';
        cb.addEventListener('change', async () => {
          cb.disabled = true;
          try { await window.maru.setCalendar(cb.checked); } catch (e) { /* 다시 읽기에서 반영 */ }
          setLoading = false; loadSettings(false);
        });
        lab.append(cb, el('span', '', T('cal.toggle'))); right.append(lab);
      }
      if (r.action) {
        const b = el('button', 'btn', T('act.' + r.action)); b.type = 'button'; b.dataset.k = r.id; b.disabled = setLoading;
        b.addEventListener('click', () => rowAction(r));
        right.append(b);
      }
      row.append(left, right); box.append(row);
    }
    if (hadFocus) { const n = box.querySelector('[data-k="' + hadFocus + '"]'); if (n && !n.disabled) n.focus(); }
  }
  async function rowAction(r) {
    if (r.action === 'copyLogin') {
      let ok = false; try { ok = await window.maru.copyLogin(); } catch (e) { ok = false; }
      rowNotes.auth = ok ? T('act.loginCopied') : T('set.fail'); renderSettings();
    } else if (PANES[r.action]) {
      try { await window.maru.openPane(PANES[r.action]); } catch (e) { /* 무시 */ }
    } else if (r.action === 'install') installFlow();
  }
  async function installFlow() {
    rowNotes.hooks = T('hooks.previewing'); renderSettings();
    let pv = null; try { pv = await window.maru.hooksPreview(); } catch (e) { pv = null; }
    rowNotes.hooks = ''; renderSettings();
    if (!pv || !pv.ok) {
      await askConfirm({ title: T('hooks.previewFail'), note: pv && pv.reason === 'noInstall' ? T('hooks.noInstall') : '', out: pv && pv.output, cancelLabel: T('common.close') });
      return;
    }
    const secs = pv.sections || [];
    await askConfirm({
      title: T('hooks.confirmTitle', { n: secs.length }), note: (secs.length ? secs.join(' · ') + '\n' : '') + T('hooks.confirmNote'), out: pv.output,
      okLabel: T('hooks.apply'), runningLabel: T('hooks.running'),
      onConfirm: async () => {
        const r = await window.maru.hooksInstall();
        if (r && ['expired', 'changed', 'cancelled'].includes(r.reason)) return { title: T('hooks.resultFail'), note: T('hooks.' + r.reason), out: '' };
        return { title: T(r && r.ok ? 'hooks.resultOk' : 'hooks.resultFail'), note: '', out: r && r.output };
      },
    });
    loadSettings(false);
  }
  $('set-close').addEventListener('click', () => { const m = modals.find((x) => x.el === $('dlg-settings')); if (m) m.close(); });
  $('set-recheck').addEventListener('click', () => loadSettings(true));

  // ---- 업그레이드 패널 ----
  let updNotice = null; let updOpen = false; let updView = null; let updPhase = 'idle'; let updMsg = ''; let updPct = 0;
  function renderUpdate() {
    $('upd-cur').textContent = T('upd.current', { v: (updView && updView.current) || version || '-' });
    const v = updView; let msg = T('upd.checking');
    if (updPhase === 'downloading') msg = updPct >= 100 ? T('upd.verifying') : T('upd.downloading', { p: updPct });
    else if (updMsg) msg = updMsg;
    else if (v) {
      if (v.status === 'unconfigured') msg = T('upd.unconfigured');
      else if (v.status === 'none') msg = T('upd.none');
      else if (v.status === 'available') msg = T('upd.available', { v: v.latest || '' });
      else msg = T('upd.error') + (v.message ? ' · ' + v.message : '');
    }
    const nb = $('upd-notice'); nb.hidden = !updNotice;
    if (updNotice) nb.textContent = T('upd.finish.' + updNotice.status, { v: updNotice.version || '' }) + (updNotice.message ? ' · ' + updNotice.message : '');
    $('upd-msg').textContent = msg;
    const showNotes = v && v.status === 'available' && v.notes && updPhase === 'idle';
    $('upd-notes').hidden = !showNotes; $('upd-notes').textContent = showNotes ? v.notes : '';
    $('upd-bar').hidden = updPhase !== 'downloading'; $('upd-bar-fill').style.width = updPct + '%';
    const acts = $('upd-actions'); acts.replaceChildren();
    const btn = (label, fn, cls) => { const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.addEventListener('click', fn); acts.append(b); return b; };
    if (updPhase === 'downloading') return;
    if (v && v.status === 'available') btn(T('upd.download'), startDownload, 'primary');
    if (v && v.repoBehind) btn(T('upd.pull'), doPull);
    btn(T('upd.recheck'), () => doCheck());
  }
  async function doCheck() {
    updView = null; updMsg = ''; renderUpdate();
    try { updView = await window.maru.updateCheck(); } catch (e) { updView = { status: 'error', current: version }; }
    renderUpdate();
  }
  async function startDownload() {
    updPhase = 'downloading'; updPct = 0; updMsg = ''; renderUpdate();
    let r = null; try { r = await window.maru.updateDownload(); } catch (e) { r = null; }
    updPhase = 'idle';
    if (!r || !r.ok) { updMsg = T('upd.downloadFail') + (r && r.message ? ' · ' + r.message : ''); renderUpdate(); return; }
    closeUpdate(false);
    await askConfirm({
      title: T('upd.installTitle'), note: T('upd.installWarn') + '\n' + T('upd.permWarn'), okLabel: T('upd.install'),
      onConfirm: async () => {
        const x = await window.maru.updateInstall();
        return x && x.ok ? { title: T('upd.install'), note: '', out: '' } : { title: T('upd.installFail'), note: x && x.message ? x.message : '', out: '' };
      },
    });
  }
  async function doPull() {
    let r = null; try { r = await window.maru.updatePull(); } catch (e) { r = null; }
    updMsg = T('upd.pullDone', { m: (r && r.message) || (r && r.ok ? 'OK' : T('set.fail')) });
    renderUpdate();
    try { updView = await window.maru.updateCheck(); } catch (e) { /* 유지 */ }
    renderUpdate();
  }
  function openUpdate() {
    if (modalOpen()) return;
    closeMenu(false);
    updOpen = true; updMsg = ''; $('pop-update').hidden = false;
    $('upgrade-btn').setAttribute('aria-expanded', 'true');
    renderUpdate(); placeAbove($('pop-update'), $('upgrade-btn'), $('user-chip'));
    $('pop-update').tabIndex = -1; $('pop-update').focus();
    doCheck().then(() => placeAbove($('pop-update'), $('upgrade-btn'), $('user-chip')));
  }
  function closeUpdate(refocus) {
    if (!updOpen) return;
    updOpen = false; updNotice = null; $('pop-update').hidden = true; $('upgrade-btn').setAttribute('aria-expanded', 'false');
    if (refocus) $('upgrade-btn').focus();
  }
  $('upgrade-btn').addEventListener('click', () => { if (updOpen) closeUpdate(true); else openUpdate(); });
  window.maru.onUpdateProgress((p) => { updPct = p; if (updOpen && updPhase === 'downloading') renderUpdate(); });

  // ---- 전역 키·바깥 클릭 ----
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && modalOpen()) { trapTab(e); return; }
    if (e.key !== 'Escape') return;
    if (modalOpen()) {
      const top = modals[modals.length - 1];
      e.preventDefault(); e.stopPropagation();
      if (top.closable()) top.close();
    } else if (menuOpen) { e.preventDefault(); closeMenu(true); }
    else if (updOpen) { e.preventDefault(); closeUpdate(true); }
    else if (detailOpen) { e.preventDefault(); closeDetail(true); } // 프로젝트 상세 -> 터미널 복귀
  }, true);
  document.addEventListener('mousedown', (e) => {
    const t = e.target;
    if (menuOpen && !$('user-menu').contains(t) && !$('user-chip').contains(t)) closeMenu(false);
    if (updOpen && !$('pop-update').contains(t) && !$('upgrade-btn').contains(t)) closeUpdate(false);
  });
  window.addEventListener('blur', () => { closeMenu(false); });
  window.maru.onOpenSettings(() => openSettings());

  // ---- 시작 ----
  async function boot() {
    let init = null;
    try { init = await window.maru.getProfile(); } catch (e) { init = null; }
    if (init) {
      version = init.version || '';
      profile = init.profile || null;
      lang = I18N.isLang(profile && profile.lang) ? profile.lang : (I18N.isLang(init.defaultLang) ? init.defaultLang : 'ko');
    }
    applyStatic();
    renderBusy('none');
    tickClock(); setInterval(tickClock, 15000);
    if (!profile) openNameDialog('onboard');
    else if (init && init.uiOpen === 'menu') openMenu();
    else if (init && init.uiOpen === 'settings') openSettings();
    else if (init && init.uiOpen === 'update') openUpdate();
    window.maru.updateNotice().then((n) => { if (n) { updNotice = n; $('upd-dot').hidden = false; } }).catch(() => {});
    syncWs().then(poll).then(() => { if (init && init.uiOpen === 'project') openFirstProject(); }); // 시험 전용(MARU_APP_UI=project): 화면 확인용으로 상세를 연 채 둔다
    setInterval(poll, 1000);
    setInterval(syncWs, 1000); // 상태 파일은 이벤트가 없으므로 주기적으로 읽는다
  }
  boot();
})();
