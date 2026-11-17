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
    $('app').inert = modals.length > 0 || su.open;
    $('setup').inert = modals.length > 0;
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
    if (detailOpen) { (detailMode === 'inbox' ? $('id-title') : detailMode === 'memory' ? $('mv-title') : $('pd-title')).focus(); return; } // 상세가 터미널 자리를 차지하는 동안은 상세에 포커스를 둔다
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
  let memView = null; // 기억 보기(memview.js). 가운데 영역을 차지하는 세 번째 상세
  let detailMode = 'project'; // 'project' | 'inbox': 가운데 상세가 무엇인지(둘 다 detailOpen 으로 터미널을 가린다)
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
      const alt = term.buffer.active.type === 'alternate'; // vim 등 alternate screen 에서는 Cmd+←/→ 를 그대로 둔다. 단 Claude Code(fullscreen 렌더러도 alternate screen)는 예외
      if (e.type === 'keydown' && e.key === 'Escape' && e.isTrusted && !e.isComposing && e.keyCode !== 229 && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.repeat) window.maru.ptyEsc(id); // 중단 감지용 알림만(키는 그대로 pty 로 간다)
      const cc = !!(wsList.find((x) => x.id === id) || {}).cc;
      const seq = Lib.keyToSeq(e, alt, cc);
      if (seq === null) return !(Lib.isNewlineKey(e) || Lib.isLineNavKey(e, alt, cc)); // Shift+Enter 의 keypress 가 Enter(전송)로 새지 않게, Cmd+←/→ 의 keypress·keyup 도 같이 삼킨다
      if (e.type === 'keydown') { e.preventDefault(); window.maru.ptyWrite(id, seq); }
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
    const nums = numberMap();
    for (const w of wsList) {
      const on = w.id === activeId; const k = stateKey(w.state);
      const row = el('div', 'ws' + (on ? ' active' : '')); row.dataset.id = w.id; row.setAttribute('role', 'listitem');
      const main = el('button', 'ws-main'); main.type = 'button';
      if (on) main.setAttribute('aria-current', 'true');
      main.setAttribute('aria-label', T('ws.row.aria', { title: w.title, path: w.path, state: T('agent.' + k) }));
      const c = el('span', 'col'); const num = nums.get('workspace:' + w.id);
      const l1 = el('span', 'l1'); l1.append(el('span', 'n', w.title), el('span', 'st ' + k, T('agent.' + k)));
      const l2 = el('span', 'l2'); l2.append(el('span', 's', w.path)); if (num) l2.append(kbdHint(num));
      c.append(l1, l2);
      if (num) main.setAttribute('aria-keyshortcuts', 'Meta+' + num);
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
    if (projHintWs !== wsList.length) renderProjects(projView); // 작업 공간 수가 바뀌면 프로젝트 줄의 번호도 바뀐다
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
  // 스쿼드 칸: 맨 위 "기본 팀"(마루 + scout/worker/expert) 아래에 스쿼드별 묶음(총괄 + 팀원). 서브에이전트가 돌면 agent_type 으로 줄을 찾아 움직인다.
  // 목록에 없는 종류(sq-… 포함)는 기본 팀 맨 아래 임시 줄. 마루 줄은 세션이 busy 일 때. (subs·squads 는 main 이 이미 검증했지만 형식을 다시 확인한다)
  const SQUAD_SLUG = /^[a-z0-9][a-z0-9-]{0,19}$/;
  const squadUser = new Map(); // slug -> 사용자가 직접 정한 펼침(true)·접힘(false). 이 앱을 켜 둔 동안만 존중한다
  function partyRow(label, suffix, model, n, cls, multi) {
    const row = el('div', 'party-row' + (cls ? ' ' + cls : '') + (n ? ' working' : ''));
    const l = el('span', 'pl'); l.append(el('span', 'pd'), el('b', '', label));
    if (suffix) l.append(document.createTextNode(' ' + suffix));
    const r = el('span', 'pr');
    if (n) r.append(el('span', 'pw', n > 1 && multi ? T('squad.working.n', { n }) : T('squad.working')));
    if (model) r.append(el('span', 'm', model));
    row.append(l, r);
    return row;
  }
  function renderParty() {
    const p = lastPanels; const party = $('party');
    if (!p || !Array.isArray(p.party)) return;
    const squads = (Array.isArray(p.squads) ? p.squads : []).filter((q) => q && typeof q.slug === 'string' && SQUAD_SLUG.test(q.slug) && typeof q.name === 'string' && Array.isArray(q.rows));
    const { counts, extra } = Lib.matchSubs(p.subs, [...p.party.map((m) => m.name), ...squads.flatMap((q) => q.rows.map((r) => r.agent))]);
    const base = p.party.map((m) => ({ m, n: m.lead ? (lastAgent === 'busy' ? 1 : 0) : (counts.get(m.name) || 0) }));
    for (const x of extra) base.push({ m: { name: x.type, roleKey: null, model: '' }, n: x.count });
    const groups = squads.map((q) => {
      const rows = q.rows.map((r) => ({ r, n: counts.get(r.agent) || 0 }));
      const active = rows.some((x) => x.n > 0);
      return { q, rows, active, open: Lib.squadOpen(squadUser.get(q.slug), active) };
    });
    const sig = JSON.stringify([base, groups.map((g) => [g.q, g.rows.map((x) => x.n), g.active, g.open]), lang]);
    if (sig === partySig) return;
    partySig = sig;
    const f = document.activeElement; const refocus = f && party.contains(f) && f.dataset.squad ? f.dataset.squad : null;
    party.replaceChildren();
    if (groups.length) party.append(el('div', 'sq-base', T('squad.base')));
    for (const { m, n } of base) party.append(partyRow(m.name || T('app.title'), m.roleKey ? T('role.' + m.roleKey) : '', m.model, n, m.lead ? 'lead' : '', !m.lead));
    for (const g of groups) {
      const grp = el('div', 'sq-group' + (g.active ? ' active' : '')); grp.dataset.slug = g.q.slug;
      const h = el('button', 'sq-head'); h.type = 'button'; h.dataset.squad = g.q.slug;
      h.setAttribute('aria-expanded', String(g.open)); h.setAttribute('aria-controls', 'sq-body-' + g.q.slug);
      h.setAttribute('aria-label', T('squad.head.aria', { name: g.q.name, n: Math.max(0, g.rows.length - 1) }) + (g.q.personal ? ' · ' + T('squad.personal.aria') : '') + (g.active ? ' · ' + T('squad.head.active') : ''));
      h.append(el('span', 'sq-caret', g.open ? '▾' : '▸'), el('span', 'sq-name', g.q.name));
      if (g.q.personal) h.append(el('span', 'sq-tag', T('squad.personal')));
      if (g.active) h.append(el('span', 'sq-dot'));
      h.addEventListener('click', () => { squadUser.set(g.q.slug, !g.open); partySig = ''; renderParty(); });
      grp.append(h);
      if (g.open) {
        const body = el('div', 'sq-body stack gap10'); body.id = 'sq-body-' + g.q.slug;
        for (const { r, n } of g.rows) body.append(partyRow(r.lead ? T('role.squadLead') : String(r.role || ''), '', typeof r.model === 'string' ? r.model : '', n, r.lead ? 'sq-lead' : '', true));
        grp.append(body);
      }
      party.append(grp);
    }
    if (refocus) { const t = [...party.querySelectorAll('.sq-head')].find((x) => x.dataset.squad === refocus); if (t) t.focus(); }
  }
  let partySig = '';
  // ---- 할 일 완료/안 함: 카드(또는 상세 줄) 옆의 별도 단추 두 개. 본문 클릭(프롬프트 채우기)과 겹치지 않는다 ----
  function todoActs(title, fn) {
    const acts = el('span', 'todo-acts');
    for (const kind of ['done', 'skip']) {
      const b = el('button', 'todo-act ' + kind, kind === 'done' ? '✓' : '×'); b.type = 'button'; b.dataset.act = kind;
      b.title = T('todo.' + kind); b.setAttribute('aria-label', T('todo.' + kind + '.aria', { title }));
      b.addEventListener('click', () => fn(kind));
      acts.append(b);
    }
    return acts;
  }
  const markTimers = new Map(); // 상자별 타이머(두 상자가 하나를 나눠 쓰면 먼저 뜬 쪽의 되돌리기 안내가 남는다)
  const todoErr = (res) => T(res && res.reason === 'unsupported' ? 'todo.err.unsupported' : res && res.reason === 'save' ? 'todo.err.save' : 'todo.err.stale');
  function clearMarkNote(box) {
    clearTimeout(markTimers.get(box)); markTimers.delete(box);
    const had = box.contains(document.activeElement);
    box.replaceChildren();
    if (had) focusTerm();
  }
  // 표시 직후의 한 줄 안내 "완료로 표시했습니다 · 되돌리기"(6초). 되돌리기는 main 이 방금 쓴 그 줄만 파일에서 뺀다
  function markNote(box, kind, id) {
    for (const b of [...markTimers.keys()]) if (b !== box) clearMarkNote(b); // 다른 상자의 안내는 먼저 거둔다
    clearTimeout(markTimers.get(box)); clearTimeout(noteTimer); clearTimeout(projNoteTimer);
    const undo = el('button', 'note-undo', T('todo.undo')); undo.type = 'button';
    undo.addEventListener('click', async () => {
      let res = null; try { res = await window.maru.undoTodoMark(id); } catch (x) { res = null; }
      clearMarkNote(box);
      if (!res || !res.ok) box.textContent = T('todo.err.undo');
      await poll();
    });
    box.replaceChildren(el('span', '', T('todo.marked.' + kind) + ' · '), undo);
    markTimers.set(box, setTimeout(() => clearMarkNote(box), 6000));
  }
  async function markTodo(idx, shown, kind, box, isDetail) {
    let res = null; try { res = await window.maru.markTodo(idx, shown, kind); } catch (x) { res = null; }
    if (!res || !res.ok) { clearMarkNote(box); clearTimeout(noteTimer); box.textContent = todoErr(res); if (!isDetail) noteTimer = setTimeout(() => { box.textContent = ''; }, 4000); await poll(); return; }
    await poll(); // 즉시 목록에서 사라진다
    markNote(box, kind, res.id);
  }
  function renderStatic(p) {
    lastPanels = p;
    $('root-missing').hidden = !p.rootMissing || su.open;
    $('lv').textContent = 'LV ' + p.level.level;
    $('growth-left').textContent = T('growth.left', { n: p.level.memories });
    $('growth-right').textContent = T('growth.right', { n: p.level.toNext });
    $('bar').style.width = Math.round(p.level.ratio * 100) + '%';
    $('batt').textContent = p.battery ? T('batt', { p: p.battery.percent }) : T('batt.none');
    $('disk').textContent = p.disk ? T('disk', { gb: p.disk.freeGB }) : T('disk.none');
    $('upd-dot').hidden = !(p.updateAvailable || updNotice);
    $('upgrade-btn').title = p.updateAvailable ? T('user.upgrade.aria') : '';

    renderParty();

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

    const q = $('quests');
    const qf = document.activeElement; const fr = qf && q.contains(qf) ? qf.closest('.todo-row') : null; const refocusTodo = fr ? Number(fr.dataset.i) : null; const refocusKey = fr ? fr.dataset.k : null; const refocusAct = fr && qf.dataset.act ? qf.dataset.act : null;
    q.replaceChildren();
    if (!p.todos.length) q.append(el('div', 'empty', T('todo.empty')));
    let prevTag = null;
    p.todos.forEach((it, i) => {
      if (it.tag !== prevTag) { prevTag = it.tag; q.append(el('div', 'tag-head', it.tag === '추천' ? T('todo.tag.suggest') : it.tag)); }
      const canFill = !!it.prompt;
      const rowEl = el('div', 'todo-row'); rowEl.dataset.i = String(i); rowEl.dataset.k = Lib.todoKey(it);
      const b = el(canFill ? 'button' : 'div', 'todo todo-main' + (canFill ? '' : ' manual'));
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
      rowEl.append(b);
      if (Lib.todoMarkable(it)) rowEl.append(todoActs(it.title, (kind) => markTodo(i, Lib.todoKey(it), kind, $('quest-note'), false)));
      q.append(rowEl);
    });
    if (refocusTodo !== null) { // 눌러서 사라진 항목이면 그 자리에 온 다음 항목의 본문(없으면 첫 단추)에 포커스를 둔다(연달아 Enter 로 다음 항목이 표시되지 않게)
      const rows = [...q.querySelectorAll('.todo-row')];
      const r = rows.find((x) => Number(x.dataset.i) === refocusTodo) || rows[rows.length - 1];
      const same = r && r.dataset.k === refocusKey; // 같은 항목이 그대로면 누르던 단추에, 아니면(눌러서 사라짐) 다음 항목의 본문에
      const t = r && ((same && refocusAct && r.querySelector('[data-act="' + refocusAct + '"]')) || (same && r.querySelector('button.todo-main')) || r.querySelector('button.todo-main') || r.querySelector('.todo-act'));
      if (t) t.focus();
    }

    renderProjects(p.projects);
    if (detailOpen && detailMode === 'project') fetchDetail(false);
    renderInbox(p.inbox);
    if (detailOpen && detailMode === 'inbox') refreshInboxDetail();

    const sk = $('skills'); sk.replaceChildren();
    for (const n of p.skills) sk.append(el('span', 'chip', n));
    $('skills-count').textContent = T('skills.count', { n: p.skills.length, p: p.pendingSkillProposals });
  }

  // ---- 알림과 승인함 ----
  // 제안의 이름·설명·본문과 로그 문구는 믿지 않는다: 전부 textContent 로만 넣는다. 항목은 {kind, slug} 로만 가리키고 main 이 다시 대조한다.
  let notifsOpen = false; let notifSeenBase = ''; let inboxNoteTimer = null; let inboxBusy = false;
  let inboxDet = null; let inboxDetSeq = 0; let inboxReloading = false;
  function inboxNote(msg, ms) {
    const n = $('inbox-note'); n.textContent = msg;
    clearTimeout(inboxNoteTimer); inboxNoteTimer = setTimeout(() => { n.textContent = ''; }, ms || 6000);
  }
  function agoText(at) {
    const r = Lib.relativeAgo(at);
    if (!r) return fmtAt(at);
    return r.unit === 'now' ? T('inbox.ago.now') : T('inbox.ago.' + r.unit, { n: r.n });
  }
  function setNotifsOpen(on) {
    notifsOpen = on;
    if (on && lastPanels) { notifSeenBase = lastPanels.inbox.notifications.filter((e) => e.fresh).map((e) => e.at).sort()[0] || ''; markSeenNow(); }
    if (lastPanels) renderInbox(lastPanels.inbox);
  }
  let seenSent = '';
  async function markSeenNow() {
    const p = lastPanels && lastPanels.inbox; if (!p || !p.unseen) return;
    const newest = p.notifications.reduce((m, e) => (e.at > m ? e.at : m), '');
    if (newest === seenSent) return; seenSent = newest;
    let ok = false;
    try { const r = await window.maru.inboxMarkSeen(); ok = !!(r && r.ok); } catch (x) { ok = false; }
    if (!ok) { seenSent = ''; inboxNote(T('inbox.err.save')); } // 저장하지 못했으면 다음에 다시 시도한다
    poll();
  }
  $('inbox-toggle').addEventListener('click', () => setNotifsOpen(!notifsOpen));
  const inboxStateKey = (st) => 'inbox.state.' + (['ok', 'risk', 'invalid', 'unknown'].includes(st) ? st : 'unknown');
  function approvalRow(a) {
    const row = el('div', 'apv'); row.dataset.kind = a.kind; row.dataset.slug = a.slug;
    const top = el('div', 'apv-top'); top.append(el('span', 'apv-kind', T('inbox.kind.' + (a.kind === 'squad' ? 'squad' : 'skill'))), el('span', 'apv-name', a.name));
    row.append(top);
    if (a.description) row.append(el('div', 'apv-desc', a.description));
    const meta = el('div', 'apv-meta');
    if (a.kind === 'squad') {
      meta.append(el('span', '', T('inbox.members', { n: a.members })));
      const cls = a.state === 'risk' ? 'risk' : a.state === 'ok' ? '' : 'bad';
      meta.append(el('span', cls, T(inboxStateKey(a.state))));
      if (a.builtin) meta.append(el('span', 'risk', T('inbox.builtin')));
    } else if (a.name !== a.slug) meta.append(el('span', '', a.slug));
    row.append(meta);
    const acts = el('div', 'apv-acts');
    const btn = (k, cls, fn, disabled) => {
      const b = el('button', 'btn' + (cls ? ' ' + cls : ''), T('inbox.act.' + k)); b.type = 'button'; b.dataset.act = k; b.disabled = !!disabled;
      b.setAttribute('aria-label', T('inbox.act.aria', { act: T('inbox.act.' + k), name: a.name })); b.addEventListener('click', fn); acts.append(b);
    };
    btn('view', '', () => openInboxDetail(a.kind, a.slug));
    // 위험 신호·내장 이름 충돌이 있으면 설치 버튼을 주된 색으로 두지 않는다
    if (a.kind === 'squad') btn('install', a.state === 'risk' || a.builtin ? '' : 'primary', () => inboxInstall(a.slug, a.digest), a.state === 'invalid' || a.state === 'unknown' || !a.digest);
    else btn('request', 'primary', () => inboxRequestSkill(a.slug), a.invalid);
    btn('reject', 'ghost', () => inboxReject(a.kind, a.slug));
    row.append(acts);
    return row;
  }
  function renderInbox(ib) {
    if (!ib) return;
    const total = ib.approvals.length + ib.unseen; // 머리말 배지: 승인 대기 + 새 알림(승인 대기 개수는 아래 구역 제목에 따로)
    const bd = $('inbox-badge'); bd.hidden = total === 0; bd.textContent = String(total); bd.setAttribute('aria-label', T('inbox.badge.aria', { n: total }));
    $('inbox-appr-count').textContent = ib.approvals.length ? String(ib.approvals.length) : '';
    const box = $('inbox-approvals');
    const focused = document.activeElement && box.contains(document.activeElement) ? [document.activeElement.closest('.apv').dataset.kind + ':' + document.activeElement.closest('.apv').dataset.slug, document.activeElement.dataset.act] : null;
    box.replaceChildren();
    if (!ib.approvals.length) box.append(el('div', 'empty', T('inbox.approvals.empty')));
    for (const a of ib.approvals) box.append(approvalRow(a));
    if (focused) { const r = [...box.querySelectorAll('.apv')].find((x) => x.dataset.kind + ':' + x.dataset.slug === focused[0]); const b = r && r.querySelector('[data-act="' + focused[1] + '"]:not(:disabled)'); if (b) b.focus(); }
    const tg = $('inbox-toggle'); tg.setAttribute('aria-expanded', String(notifsOpen));
    $('inbox-toggle-t').textContent = T('inbox.sec.notifs');
    $('inbox-toggle-n').textContent = ib.unseen ? T('inbox.new.n', { n: ib.unseen }) : (ib.notifications.length ? String(ib.notifications.length) : '');
    tg.setAttribute('aria-label', T('inbox.notifs.toggle.aria', { n: ib.notifications.length, state: T(notifsOpen ? 'inbox.notifs.open' : 'inbox.notifs.closed') }) + (ib.unseen ? ', ' + T('inbox.new.n', { n: ib.unseen }) : ''));
    const nb = $('inbox-notifs'); nb.hidden = !notifsOpen; nb.replaceChildren();
    if (!notifsOpen) return;
    if (!ib.notifications.length) nb.append(el('div', 'empty', T('inbox.notifs.empty')));
    for (const e of ib.notifications) {
      const fresh = e.fresh || (notifSeenBase && e.at >= notifSeenBase); // 펼친 직후에는 방금 새것이던 줄을 표시해 둔다(접으면 사라진다)
      const row = el('div', 'brief' + (fresh ? ' fresh' : ''));
      const dot = el('span', 'dot' + (fresh ? '' : ' off')); dot.setAttribute('aria-hidden', 'true');
      const at = el('span', 'at', agoText(e.at)); at.title = e.at;
      row.append(dot, at, el('span', '', T('ev.' + e.code, { n: e.n })));
      if (fresh) row.setAttribute('aria-label', T('inbox.new') + ': ' + at.textContent + ' ' + T('ev.' + e.code, { n: e.n }));
      nb.append(row);
    }
    if (ib.unseen) markSeenNow(); // 펼쳐 둔 동안 새로 온 알림도 본 것으로
  }
  // 결과 문구: 사유 -> 안내(문장은 i18n 에서만, 제안에서 온 문자열은 textContent 로 한 줄)
  function inboxResultText(res, slug) {
    const r = res && res.reason;
    if (r === 'risky') return T('inbox.err.risky', { cmd: 'maru squad install data/squad-proposals/' + slug + ' --ack-warnings' }) + (res.risks && res.risks.length ? '  ' + res.risks.join(' / ') : '');
    if (r === 'rejected') return T('inbox.err.rejected', { detail: res.detail || '' });
    if (r === 'check-failed') return T('inbox.err.check');
    if (r === 'install-failed') return T('inbox.err.install');
    if (['exists', 'changed', 'builtin', 'trash', 'save', 'busy', 'not-maru'].includes(r)) return T('inbox.err.' + r);
    if (['stale', 'no-prompt', 'unsafe-start', 'not-ready', 'no-term', 'inactive'].includes(r)) return T(Lib.fillNoticeKey(r));
    return T('inbox.err.invalid');
  }
  async function inboxRun(fn, okText, slug) {
    if (inboxBusy) return; inboxBusy = true;
    let res = null; try { res = await fn(); } catch (x) { res = null; }
    inboxBusy = false;
    const note = detailOpen && detailMode === 'inbox' ? $('id-note') : $('inbox-note');
    let msg = '';
    if (res && res.ok) msg = okText(res); else if (!(res && res.reason === 'cancel')) msg = inboxResultText(res, slug);
    note.textContent = msg; if (note.id === 'inbox-note') inboxNote(msg, 12000);
    await poll();
    if (res && res.ok && detailOpen && detailMode === 'inbox') closeDetail(true);
    else if (res && res.reason === 'invalid' && detailOpen && detailMode === 'inbox') closeDetail(true);
    else if (res && res.reason === 'changed' && detailOpen && detailMode === 'inbox' && inboxDet) await reloadInboxDetail(); // 본 내용이 바뀌었다: 새 내용을 다시 보여 준다
  }
  // digest: 지금 화면(행 또는 상세)에 보이는 검증 결과의 것. main 이 새로 돌린 검사와 같을 때만 설치 확인으로 간다.
  const inboxInstall = (slug, digest) => inboxRun(() => window.maru.inboxInstallSquad(slug, digest || ''), (r) => T(r.removed === false ? 'inbox.ok.installKeep' : 'inbox.ok.install', { name: r.name || slug }), slug);
  const inboxReject = (kind, slug) => inboxRun(() => window.maru.inboxReject(kind, slug), () => T('inbox.ok.reject'), slug);
  const inboxRequestSkill = (slug) => inboxRun(() => window.maru.inboxRequestSkill(activeId || '', slug), () => T('inbox.ok.request'), slug);

  // 상세(읽기 전용): 터미널 자리에 보인다. 본문은 <pre> 에 textContent 로만.
  async function openInboxDetail(kind, slug) {
    detailMode = 'inbox'; detailOpen = true; detailKey = null; detail = null; detailSig = ''; detailSeq++;
    inboxDet = { kind, slug, loading: true }; const my = ++inboxDetSeq;
    $('terminal').hidden = true; $('term-empty').hidden = true; $('proj-detail').hidden = true; $('inbox-detail').hidden = false; if (memView) memView.hide();
    $('id-note').textContent = '';
    if (lastPanels) renderProjects(lastPanels.projects);
    renderInboxDetail(true);
    let d = null; try { d = await window.maru.inboxDetail(kind, slug); } catch (x) { d = null; }
    if (my !== inboxDetSeq || !detailOpen || detailMode !== 'inbox') return;
    if (!d || d.kind !== kind || d.slug !== slug) { closeDetail(true); inboxNote(T('inbox.err.invalid')); return; }
    inboxDet = d; renderInboxDetail(true);
  }
  async function reloadInboxDetail() { // 열어 둔 상세를 새로 받아 다시 그린다(알림 문구는 그대로 둔다)
    if (!inboxDet) return;
    const { kind, slug } = inboxDet; const my = ++inboxDetSeq;
    let d = null; try { d = await window.maru.inboxDetail(kind, slug); } catch (x) { d = null; }
    if (my !== inboxDetSeq || !detailOpen || detailMode !== 'inbox') return;
    if (!d || d.kind !== kind || d.slug !== slug) { closeDetail(true); return; }
    inboxDet = d; renderInboxDetail(false);
  }
  async function refreshInboxDetail() { // 목록이 바뀔 때: 열어 둔 제안이 사라졌으면 닫고, 검증 내용(digest)이 달라졌으면 다시 받는다
    const ib = lastPanels && lastPanels.inbox; if (!ib || !inboxDet || inboxDet.loading) return;
    const row = ib.approvals.find((a) => a.kind === inboxDet.kind && a.slug === inboxDet.slug);
    if (!row) { closeDetail(true); return; }
    if (row.digest && inboxDet.check && inboxDet.check.digest !== row.digest && !inboxReloading) { inboxReloading = true; try { await reloadInboxDetail(); } finally { inboxReloading = false; } }
  }
  function renderInboxDetail(focusTitle) {
    const d = inboxDet; if (!d) return;
    const f = document.activeElement; const had = f && $('id-actions').contains(f) ? f.dataset.k : null;
    const ib = lastPanels && lastPanels.inbox; const row = ib && ib.approvals.find((a) => a.kind === d.kind && a.slug === d.slug);
    $('inbox-detail').setAttribute('aria-label', T('inbox.detail.aria'));
    $('id-kind').textContent = T('inbox.kind.' + (d.kind === 'squad' ? 'squad' : 'skill'));
    $('id-title').textContent = d.name || d.slug;
    $('id-desc').textContent = d.description || '';
    const st = $('id-state'); const cs = d.check ? d.check.state : null; st.hidden = !cs; st.className = 'pill' + (cs === 'ok' ? ' ok' : cs === 'risk' ? ' need' : ' unknown'); if (cs) st.textContent = T(inboxStateKey(cs));
    const acts = $('id-actions'); acts.replaceChildren();
    const btn = (k, cls, fn, disabled) => { const b = el('button', 'btn' + (cls ? ' ' + cls : ''), T('inbox.act.' + k)); b.type = 'button'; b.dataset.k = k; b.disabled = !!disabled; b.addEventListener('click', fn); acts.append(b); };
    if (d.kind === 'squad') btn('install', cs === 'risk' || (d.check && d.check.existsBuiltin) ? '' : 'primary', () => inboxInstall(d.slug, d.check ? d.check.digest : ''), !d.check || cs === 'invalid' || cs === 'unknown' || !d.check.digest);
    else btn('request', 'primary', () => inboxRequestSkill(d.slug), !!(row && row.invalid));
    btn('reject', 'ghost', () => inboxReject(d.kind, d.slug), !!d.loading);
    const body = $('id-body'); body.replaceChildren();
    if (!d.loading) {
      if (d.check) {
        body.append(el('h3', 'pd-h', T('inbox.sec.check')));
        const c = d.check;
        if (c.reason) body.append(el('div', 'pd-meta', c.reason));
        if (c.summary) body.append(el('div', 'pd-meta', T('inbox.check.summary', { n: c.summary.members, models: c.summary.models.join(', '), tools: c.summary.tools.join(', ') })));
        if (c.existsPersonal) body.append(el('div', 'pd-note', T('inbox.check.exists')));
        if (c.existsBuiltin) body.append(el('div', 'pd-note', T('inbox.check.builtin')));
        for (const [key, list, cls] of [['inbox.sec.risks', c.risks, ' risk'], ['inbox.sec.warns', c.warns, '']]) {
          if (!list.length) continue;
          body.append(el('h3', 'pd-h', T(key)));
          const ul = el('ul', 'id-list' + cls); for (const x of list) ul.append(el('li', '', x)); body.append(ul);
        }
      }
      if (row && row.invalid) body.append(el('div', 'pd-note', T('inbox.invalid.skill')));
      for (const s of d.sections) {
        body.append(el('h3', 'pd-h', s.name));
        if (s.text) { const pre = el('pre', 'id-pre', s.text); pre.tabIndex = 0; body.append(pre); }
        if (s.truncated) body.append(el('div', 'hint', T(s.limit === 'total' ? 'inbox.truncated.total' : 'inbox.truncated')));
      }
      body.append(el('h3', 'pd-h', T('inbox.sec.files')));
      const ul = el('ul', 'id-list'); for (const x of d.files) ul.append(el('li', '', x.name + ' (' + x.size + ' B)')); body.append(ul);
      if (d.skipped) body.append(el('div', 'hint', T('inbox.skipped', { n: d.skipped })));
    }
    if (had) { const n = acts.querySelector('[data-k="' + had + '"]:not(:disabled)'); if (n) n.focus(); } else if (focusTitle) $('id-title').focus();
  }
  $('id-close').addEventListener('click', () => closeDetail(true));

  // ---- 프로젝트: 왼쪽 목록(카테고리 > 프로젝트)과 가운데 상세 ----
  // 모든 문구는 textContent 로만 넣는다. 키는 main 의 목록에서 온 값이고, 상태 변경·이어서 하기는 main 이 키를 다시 대조한다.
  let projView = { open: [], done: [], doneCount: 0, collapsed: [] };
  let doneOpen = false; // "완료" 목록 펼침은 저장하지 않는다(카테고리 접힘은 main 이 data/project-ui.json 에 저장)
  let dragState = null; let pendingPv = null; let projHintWs = -1; let projNoteTimer = null;
  const DRAG_TYPE = 'application/x-maru-reorder'; // 파일 drop('Files')과 섞이지 않게 자체 타입만 쓴다
  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  function projTitle(it) { return it.kind === 'unclassified' ? T('proj.unclassified') : it.title; }
  // ⌘숫자 힌트: main 메뉴와 같은 Lib.numberTargets 로 센다(작업 공간 먼저, 이어서 접히지 않은 진행 중 프로젝트 줄). 'kind:id' -> 번호
  function numberMap() {
    const m = new Map();
    Lib.numberTargets(wsList.map((w) => w.id), Lib.visibleProjectKeys(projView.open, projView.collapsed)).forEach((t, i) => m.set(t.kind + ':' + t.id, i + 1));
    return m;
  }
  function kbdHint(n) { const k = el('span', 'kbd', '⌘' + n); k.setAttribute('aria-hidden', 'true'); return k; }
  function projNote(msg) {
    const n = $('proj-note'); n.textContent = msg;
    clearTimeout(projNoteTimer); projNoteTimer = setTimeout(() => { n.textContent = ''; }, 4000);
  }
  function projRow(it, num, canDrag) {
    const b = el('button', 'proj' + (it.kind === 'unclassified' ? ' unc' : '') + (it.key === detailKey ? ' on' : '')); b.type = 'button'; b.dataset.key = it.key; b.dataset.tag = it.tag;
    const name = projTitle(it);
    let cnt;
    if (it.status === 'done') cnt = el('span', 'cnt', it.doneAt || '');
    else if (it.needsCheck) cnt = el('span', 'cnt check', T('proj.check'));
    else cnt = el('span', 'cnt', T('proj.todos', { n: it.openTodos }));
    const pr = el('span', 'pr'); pr.append(cnt); if (num) pr.append(kbdHint(num));
    b.append(el('span', 'pt', name), pr);
    b.title = canDrag && it.kind === 'project' ? name + '\n' + T('proj.row.tip') : name;
    if (it.key === detailKey) b.setAttribute('aria-current', 'true');
    b.setAttribute('aria-label', T('proj.row.aria', { title: name, state: cnt.textContent }));
    if (num) b.setAttribute('aria-keyshortcuts', 'Meta+' + num);
    if (canDrag && it.kind === 'project') { b.draggable = true; b.dataset.drag = 'proj'; } // "분류 안 됨" 줄은 맨 아래 고정
    b.addEventListener('click', () => openDetail(it.key));
    return b;
  }
  // 카테고리 소제목 = 접기·펼치기 버튼(aria-expanded). 접히면 (줄 수)를 붙인다
  function catHead(g, sec, closed) {
    const b = el('button', 'proj-cat'); b.type = 'button'; b.dataset.cat = g.tag; b.dataset.sec = sec;
    b.setAttribute('aria-expanded', String(!closed));
    b.setAttribute('aria-label', T('proj.cat.aria', { tag: g.tag, n: g.items.length }));
    b.append(el('span', 'ct', g.tag));
    if (closed) b.append(el('span', 'cn', '(' + g.items.length + ')'));
    if (sec === 'open') { b.draggable = true; b.dataset.drag = 'cat'; b.title = T('proj.cat.tip'); }
    b.addEventListener('click', () => toggleCat(g.tag, !closed));
    return b;
  }
  async function toggleCat(tag, closed) {
    let res = null; try { res = await window.maru.setCategoryCollapsed(tag, closed); } catch (x) { res = null; }
    if (!res || !res.ok) projNote(projErr(res));
    await poll();
  }
  function fillGroups(box, groups, sec, nums) {
    const closedSet = new Set(Array.isArray(projView.collapsed) ? projView.collapsed : []);
    for (const g of groups) {
      const closed = closedSet.has(g.tag);
      const grp = el('div', 'proj-group'); grp.dataset.tag = g.tag;
      grp.append(catHead(g, sec, closed));
      if (!closed) for (const it of g.items) grp.append(projRow(it, sec === 'open' ? nums.get('project:' + it.key) : 0, sec === 'open'));
      box.append(grp);
    }
  }
  function renderProjects(pv) {
    if (dragState) { pendingPv = pv; return; } // 끄는 동안 DOM 을 바꾸면 dragend 가 오지 않을 수 있다. 끝난 뒤 그린다
    pendingPv = null;
    projView = pv && Array.isArray(pv.open) && Array.isArray(pv.done) ? pv : { open: [], done: [], doneCount: 0, collapsed: [] };
    projHintWs = wsList.length;
    const card = $('proj-card'); const f = document.activeElement;
    const refocus = f && card.contains(f) ? (f.dataset.cat ? 'c:' + f.dataset.sec + ':' + f.dataset.cat : f.dataset.key ? 'k:' + f.dataset.key : f.id === 'proj-done-toggle' ? 't' : null) : null;
    const nums = numberMap();
    const box = $('projects'); box.replaceChildren();
    if (!projView.open.length) box.append(el('div', 'empty', T('proj.empty')));
    fillGroups(box, projView.open, 'open', nums);
    const n = projView.doneCount | 0;
    const tg = $('proj-done-toggle'); tg.hidden = n === 0; tg.textContent = T('proj.done.toggle', { n });
    tg.setAttribute('aria-label', T('proj.done.toggle', { n }) + ' — ' + T('proj.done.aria'));
    tg.setAttribute('aria-expanded', String(doneOpen && n > 0));
    const done = $('projects-done'); done.replaceChildren(); done.hidden = !doneOpen || n === 0;
    if (!done.hidden) fillGroups(done, projView.done, 'done', nums);
    if (refocus) {
      let t = null;
      if (refocus === 't') t = tg;
      else if (refocus.startsWith('c:')) t = [...card.querySelectorAll('.proj-cat')].find((x) => 'c:' + x.dataset.sec + ':' + x.dataset.cat === refocus);
      else t = [...card.querySelectorAll('.proj')].find((x) => 'k:' + x.dataset.key === refocus);
      if (t && !t.hidden) t.focus();
    }
  }
  $('proj-done-toggle').addEventListener('click', () => { doneOpen = !doneOpen; if (lastPanels) renderProjects(lastPanels.projects); $('proj-done-toggle').focus(); });

  // ---- 순서 바꾸기: 끌어서 놓기(같은 종류끼리만) + ⌥↑/⌥↓. 검증은 main 이 한다 ----
  async function doReorder(kind, id, before) {
    let res = null; try { res = await window.maru.reorderProject(kind, id, before); } catch (x) { res = null; }
    if (!res || !res.ok) { projNote(res && res.reason === 'invalid' ? T('proj.err.move') : projErr(res)); await poll(); return; }
    await poll();
    let pos = 0; let total = 0; let title = id;
    if (kind === 'cat') { total = projView.open.length; pos = projView.open.findIndex((g) => g.tag === id) + 1; }
    else {
      const g = projView.open.find((x) => x.items.some((it) => it.key === id));
      const ps = g ? g.items.filter((it) => it.kind === 'project') : [];
      total = ps.length; pos = ps.findIndex((it) => it.key === id) + 1; title = (ps[pos - 1] && ps[pos - 1].title) || id;
    }
    if (pos > 0) projNote(T('proj.moved', { title, pos, total }));
  }
  const clearDrop = () => { for (const n of $('projects').querySelectorAll('.drop-before, .drop-after')) n.classList.remove('drop-before', 'drop-after'); };
  // 끄는 중인 것을 놓을 자리: { el, after, beforeId }. 같은 종류 밖이면 null
  function dropInfo(e) {
    if (!dragState || !e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], DRAG_TYPE) < 0) return null;
    const t = e.target && e.target.closest ? e.target : null; if (!t) return null;
    if (dragState.kind === 'cat') {
      const g = t.closest('.proj-group'); if (!g || !$('projects').contains(g) || g.dataset.tag === dragState.id) return null;
      const r = g.getBoundingClientRect(); const after = e.clientY >= r.top + r.height / 2;
      let beforeId = g.dataset.tag;
      if (after) { let s = g.nextElementSibling; while (s && s.dataset.tag === dragState.id) s = s.nextElementSibling; beforeId = s ? s.dataset.tag : null; }
      return { el: g, after, beforeId };
    }
    const row = t.closest('.proj'); if (!row || !$('projects').contains(row) || row.dataset.tag !== dragState.tag || row.dataset.key === dragState.id) return null; // 다른 카테고리로는 못 옮긴다
    if (row.classList.contains('unc')) return { el: row, after: false, beforeId: null }; // "분류 안 됨" 위 = 프로젝트 줄 맨 끝
    const r = row.getBoundingClientRect(); const after = e.clientY >= r.top + r.height / 2;
    let beforeId = row.dataset.key;
    if (after) { let s = row.nextElementSibling; while (s && s.dataset.key === dragState.id) s = s.nextElementSibling; beforeId = s && !s.classList.contains('unc') ? s.dataset.key : null; }
    return { el: row, after, beforeId };
  }
  const projBox = $('projects');
  projBox.addEventListener('dragstart', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-drag]') : null;
    if (!t || !e.dataTransfer) return;
    dragState = t.dataset.drag === 'cat' ? { kind: 'cat', id: t.dataset.cat, tag: t.dataset.cat } : { kind: 'proj', id: t.dataset.key, tag: t.dataset.tag };
    e.dataTransfer.setData(DRAG_TYPE, dragState.kind + ':' + dragState.id); e.dataTransfer.effectAllowed = 'move';
    t.classList.add('dragging');
  });
  projBox.addEventListener('dragover', (e) => {
    const d = dropInfo(e);
    clearDrop();
    if (!d) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    d.el.classList.add(d.after ? 'drop-after' : 'drop-before');
  });
  projBox.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !projBox.contains(e.relatedTarget)) clearDrop(); });
  projBox.addEventListener('drop', (e) => {
    const d = dropInfo(e);
    clearDrop();
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    const s = dragState; dragState = null;
    for (const n of projBox.querySelectorAll('.dragging')) n.classList.remove('dragging');
    doReorder(s.kind, s.id, d.beforeId).then(() => { if (pendingPv) renderProjects(pendingPv); });
  });
  document.addEventListener('dragend', () => {
    dragState = null; clearDrop();
    for (const n of projBox.querySelectorAll('.dragging')) n.classList.remove('dragging');
    if (pendingPv) renderProjects(pendingPv);
  });
  // 키보드 대안: 포커스된 카테고리·프로젝트 줄에서 ⌥↑/⌥↓ 로 한 칸 이동("분류 안 됨" 줄은 고정)
  projBox.addEventListener('keydown', (e) => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    const t = e.target && e.target.closest ? e.target.closest('[data-drag]') : null;
    if (!t || !projBox.contains(t)) return;
    e.preventDefault();
    let ids; let id; let kind;
    if (t.dataset.drag === 'cat') { kind = 'cat'; id = t.dataset.cat; ids = projView.open.map((g) => g.tag); }
    else {
      kind = 'proj'; id = t.dataset.key;
      const g = projView.open.find((x) => x.items.some((it) => it.key === id));
      ids = g ? g.items.filter((it) => it.kind === 'project').map((it) => it.key) : [];
    }
    const i = ids.indexOf(id); if (i < 0) return;
    const up = e.key === 'ArrowUp';
    if (up ? i === 0 : i === ids.length - 1) return;
    const before = up ? ids[i - 1] : (ids[i + 2] === undefined ? null : ids[i + 2]);
    doReorder(kind, id, before);
  });

  function openDetail(key) {
    detailMode = 'project'; inboxDet = null; inboxDetSeq++; $('inbox-detail').hidden = true; if (memView) memView.hide();
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
    detailOpen = false; detailKey = null; detail = null; detailSig = ''; detailSeq++; inboxDet = null; inboxDetSeq++;
    $('proj-detail').hidden = true; $('inbox-detail').hidden = true; if (memView) memView.hide(); $('terminal').hidden = false; $('term-empty').hidden = wsList.length > 0;
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
      r.append(imp, el('span', 'pd-todo-t', t.title));
      if (t.markable === true && Number.isInteger(t.idx) && typeof t.shown === 'string') r.append(todoActs(t.title, (kind) => markTodo(t.idx, t.shown, kind, $('pd-note'), true)));
      td.append(r);
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
  function projErr(res) { return T(res && res.reason === 'save' ? 'proj.err.save' : res && res.reason === 'size' ? 'proj.err.size' : res && res.reason === 'busy' ? 'proj.err.busy' : res && res.reason === 'rollback' ? 'proj.err.rollback' : 'proj.err.invalid'); }
  async function setProjStatus(status) {
    if (!detail) return;
    let res = null; try { res = await window.maru.setProjectStatus(detail.key, status); } catch (x) { res = null; }
    $('pd-note').textContent = res && (res.ok || res.reason === 'cancel') ? '' : projErr(res); // 취소는 오류가 아니다
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
    lastAgent = agent; renderParty();
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
    if (detailOpen && detailMode === 'project' && detail) renderDetail(false);
    if (detailOpen && detailMode === 'inbox' && inboxDet) renderInboxDetail(false);
    if (memView) memView.relabel();
    if (setRows) renderSettings();
    if (su.open) renderSetup(false);
    if (homeNotice) $('home-warn').textContent = T('home.warn.' + homeNotice);
    if (!$('pop-update').hidden) renderUpdate();
    renderLangSeg();
    if (!$('dlg-name').hidden) fillNameDialog();
  }
  async function setLang(l) {
    if (!I18N.isLang(l) || l === lang) return;
    lang = l;
    relabel();
    if (profile) {
      try {
        const r = await window.maru.setProfile({ lang: l });
        if (r && r.ok) { profile = r.profile; if (r.claudeMd) flashNote(T(r.claudeMd === 'synced' ? 'lang.claudeMdNote' : 'lang.claudeMdFail')); } // 관리형 홈이면 CLAUDE.md 를 다시 썼다(새 세션부터)
      } catch (e) { /* UI 언어는 이미 바뀜 */ }
    }
  }

  // 한 줄 알림(8초 뒤 사라짐): textContent 만 쓴다
  let noteTimer2 = null;
  function flashNote(text) {
    const n = $('lang-note'); n.textContent = text; n.hidden = !text;
    clearTimeout(noteTimer2); if (text) noteTimer2 = setTimeout(() => { n.textContent = ''; n.hidden = true; }, 8000);
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
    if (profile) m.append(item(T('menu.firstMeeting'), 'menuitem', startMeet));
    if (suUnfinished) m.append(item(T('menu.finishSetup'), 'menuitem', () => suOpen('connect', false)));
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
    if (modalOpen() || su.open) return; // 첫 설정 덮개 위에는 설정 창을 열지 않는다
    openModal($('dlg-settings'), $('set-close'), { close: () => { closeModal($('dlg-settings')); setRows = null; } });
    setRows = (homeManaged ? ['home', ...ROW_IDS] : ROW_IDS).map((id) => ({ id, status: null }));
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
    await installDialogs((t) => { rowNotes.hooks = t; renderSettings(); });
    loadSettings(false);
  }
  // 미리보기 -> 확인 -> 실행(설정과 첫 설정이 함께 쓴다). 설치가 성공하면 true.
  async function installDialogs(setNote) {
    setNote(T('hooks.previewing'));
    let pv = null; try { pv = await window.maru.hooksPreview(); } catch (e) { pv = null; }
    setNote('');
    if (!pv || !pv.ok) {
      await askConfirm({ title: T('hooks.previewFail'), note: pv && pv.reason === 'noInstall' ? T('hooks.noInstall') : '', out: pv && pv.output, cancelLabel: T('common.close') });
      return false;
    }
    const secs = pv.sections || [];
    let okRun = false;
    await askConfirm({
      title: T('hooks.confirmTitle', { n: secs.length }), note: (secs.length ? secs.join(' · ') + '\n' : '') + T('hooks.confirmNote'), out: pv.output,
      okLabel: T('hooks.apply'), runningLabel: T('hooks.running'),
      onConfirm: async () => {
        const r = await window.maru.hooksInstall();
        if (r && ['expired', 'changed', 'cancelled'].includes(r.reason)) return { title: T('hooks.resultFail'), note: T('hooks.' + r.reason), out: '' };
        okRun = !!(r && r.ok);
        return { title: T(r && r.ok ? 'hooks.resultOk' : 'hooks.resultFail'), note: '', out: r && r.output };
      },
    });
    return okRun;
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

  // ---- 파일 끌어다 놓기: 터미널 영역에만. 경로는 main 이 검증해 bracketed paste 로 넣는다(Enter 없음) ----
  const dropZone = document.querySelector('.term-wrap');
  const hasFiles = (e) => !!e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0;
  // 창 어디서든 파일 drop 이 페이지 이동을 일으키지 않게(터미널 밖은 무시). 텍스트 drag 는 건드리지 않는다.
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); if (!dropZone.contains(e.target)) e.dataTransfer.dropEffect = 'none'; } });
  window.addEventListener('drop', (e) => { if (hasFiles(e)) e.preventDefault(); });
  const canDrop = () => !!activeId && !modalOpen() && !detailOpen;
  dropZone.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const ok = canDrop();
    e.dataTransfer.dropEffect = ok ? 'copy' : 'none';
    dropZone.classList.toggle('drop', ok);
  });
  dropZone.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drop'); });
  dropZone.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation();
    dropZone.classList.remove('drop');
    const files = Array.prototype.slice.call(e.dataTransfer.files || []);
    if (!files.length) return;
    if (!canDrop()) { note(T('drop.busy-ui')); return; }
    let res = null;
    try { res = await window.maru.dropFiles(activeId, files); } catch (x) { /* 무시 */ }
    if (!res || !res.ok) note(T(Lib.dropNoticeKey(res && res.reason)));
    focusTerm();
  });
  document.addEventListener('dragend', () => dropZone.classList.remove('drop'));

  // ---- ⌘숫자(main 메뉴 accelerator 가 번호를 대상으로 바꿔 보낸다) ----
  // 작업 공간은 main 이 이미 전환했고 여기서는 열려 있던 프로젝트 상세만 닫는다. 프로젝트는 지금 목록에 있는 키만 열고, 모달(설정·온보딩 등)이 열려 있으면 무시한다.
  window.maru.onGoto((kind, id) => {
    if (kind === 'workspace') { if (!modalOpen()) closeDetail(true); return; }
    if (kind !== 'project' || modalOpen()) return;
    if (!projView.open.some((g) => g.items.some((it) => it.key === id))) return;
    closeMenu(false); closeUpdate(false);
    if (detailOpen && detailMode === 'project' && detailKey === id) return; // 이미 열려 있으면 그대로
    openDetail(id);
  });

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
    else if (detailOpen) {
      e.preventDefault();
      // 기억 보기에서 검색창에 글자가 있으면 Esc 는 검색만 지우고, 아니면 화면을 닫는다
      if (detailMode === 'memory' && memView && document.activeElement === $('mv-q') && memView.clearSearch()) return;
      closeDetail(true); // 프로젝트 상세 -> 터미널 복귀
    }
  }, true);
  document.addEventListener('mousedown', (e) => {
    const t = e.target;
    if (menuOpen && !$('user-menu').contains(t) && !$('user-chip').contains(t)) closeMenu(false);
    if (updOpen && !$('pop-update').contains(t) && !$('upgrade-btn').contains(t)) closeUpdate(false);
  });
  window.addEventListener('blur', () => { closeMenu(false); });
  window.maru.onOpenSettings(() => openSettings());
  // ⌘숫자 힌트는 ⌘ 를 누르고 있는 동안에만 보인다(평소에는 이름이 전체 폭을 쓴다)
  const setMod = (on) => document.body.classList.toggle('mod', on);
  document.addEventListener('keydown', (e) => { if (e.key === 'Meta' || e.metaKey) setMod(true); }, true);
  document.addEventListener('keyup', (e) => { if (!e.metaKey) setMod(false); }, true);
  // 네이티브 창·앱 전환 뒤에는 keyup 을 못 받을 수 있다: 포인터가 움직이거나 눌릴 때 ⌘ 가 눌려 있지 않으면 힌트를 끈다
  for (const ev of ['pointermove', 'mousedown']) document.addEventListener(ev, (e) => { if (!e.metaKey) setMod(false); }, true);
  window.addEventListener('blur', () => setMod(false));
  document.addEventListener('visibilitychange', () => { if (document.hidden) setMod(false); });

  // ---- 기억 보기: 터미널 자리를 차지하는 읽기 전용 화면(목록·그래프) ----
  memView = window.MaruMemView.create({ T, $, el, Lib, onClose: () => closeDetail(true) });
  function openMemory(initialMode) {
    if (detailOpen && detailMode === 'memory') return;
    detailMode = 'memory'; inboxDet = null; inboxDetSeq++; detailKey = null; detail = null; detailSig = ''; detailSeq++; detailOpen = true;
    $('terminal').hidden = true; $('term-empty').hidden = true; $('proj-detail').hidden = true; $('inbox-detail').hidden = true;
    if (lastPanels) renderProjects(lastPanels.projects);
    memView.show(initialMode).then(() => $('mv-title').focus());
  }
  $('mem-open').addEventListener('click', () => openMemory('list'));

  // ---- 첫 설정(덮개) ----
  const SU_STEPS = ['lang', 'prereq', 'home', 'connect', 'done'];
  const su = { blocked: null, open: false, step: 'lang', name: '', prereq: null, checking: false, busy: false, err: '', later: false, fake: false };
  let suUnfinished = false;
  let homeManaged = false; let homeNotice = null;
  function suOpen(step, fake, blocked) {
    su.open = true; su.step = step; su.err = ''; su.busy = false; su.later = false; su.fake = !!fake; su.blocked = blocked || null;
    if (!su.name && profile) su.name = profile.name;
    $('setup').hidden = false; $('root-missing').hidden = true; $('meet-banner').hidden = true;
    syncModalState();
    renderSetup(true);
    if (step === 'prereq') suCheck();
  }
  function suClose() { su.open = false; $('setup').hidden = true; syncModalState(); focusTerm(); refreshMeet(); }
  function suGo(step) { su.step = step; su.err = ''; renderSetup(true); if (step === 'prereq') suCheck(); }
  async function suCheck() {
    su.checking = true; su.prereq = null; su.err = ''; renderSetup(false);
    let r = null; try { r = await window.maru.setupPrereqs(); } catch (e) { r = null; }
    su.checking = false; su.prereq = r && Array.isArray(r.list) ? r : null;
    if (!su.prereq) su.err = T('su.prereq.failed');
    if (su.step === 'prereq') renderSetup(false);
  }
  function suSeg() {
    const seg = el('div', 'seg'); seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', T('ob.lang'));
    for (const l of I18N.LANGS) {
      const b = el('button', 'seg-b' + (lang === l ? ' on' : ''), T('lang.' + l)); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(lang === l));
      b.addEventListener('click', () => { setLang(l); });
      seg.append(b);
    }
    return seg;
  }
  function suBtn(label, cls, fn, disabled) { const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.disabled = !!disabled; b.addEventListener('click', fn); return b; }
  function renderSetup(focusFirst) {
    const cur = SU_STEPS.indexOf(su.step);
    const ol = $('su-steps'); ol.replaceChildren();
    SU_STEPS.forEach((k, i) => {
      const st = i < cur ? 'done' : i === cur ? 'current' : 'pending';
      const li = el('li', st); if (st === 'current') li.setAttribute('aria-current', 'step');
      li.append(el('span', '', (i + 1) + '. ' + T('su.step.' + k)), el('span', 'st', T('su.state.' + st)));
      ol.append(li);
    });
    const body = $('su-body'); body.replaceChildren();
    const row = el('div', 'btn-row');
    const err = () => { const e = el('div', 'su-err', su.err); e.setAttribute('role', 'alert'); return e; };
    if (su.step === 'lang') {
      body.append(el('h2', '', T('su.step.lang')), el('p', '', T('su.lang.hint')), suSeg());
      const lab = el('label', 'field'); lab.append(el('span', 'lbl', T('ob.name.label')));
      const inp = el('input'); inp.type = 'text'; inp.maxLength = 40; inp.autocomplete = 'off'; inp.spellcheck = false; inp.value = su.name; inp.id = 'su-name';
      inp.addEventListener('input', () => { su.name = inp.value; });
      lab.append(inp); body.append(lab, el('div', 'hint', T('ob.name.hint')), err());
      const next = () => { const n = Lib.cleanName(su.name); if (!n) { su.err = T('su.err.name'); renderSetup(false); $('su-name').focus(); return; } su.name = n; suGo('prereq'); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); next(); } });
      row.append(suBtn(T('su.next'), 'primary', next));
    } else if (su.step === 'prereq') {
      body.append(el('h2', '', T('su.step.prereq')), el('p', '', T('su.prereq.intro')));
      const list = el('div', 'su-list');
      if (su.checking) list.append(el('p', '', T('su.prereq.checking')));
      for (const x of (su.prereq && su.prereq.list) || []) {
        const r = el('div', 'su-row'); const rt = el('div', 'rt');
        rt.append(el('span', '', T('prereq.name.' + x.id) + (x.detail ? ' ' + x.detail : '') + (x.required ? '' : ' (' + T('prereq.optional') + ')')), el('span', 'pill ' + (x.status === 'ok' ? 'ok' : x.status === 'unknown' ? 'unknown' : 'need'), T('prereq.status.' + x.status)));
        r.append(rt);
        if (x.how) r.append(el('div', 'how', T(x.how)));
        list.append(r);
      }
      body.append(list);
      if (su.prereq && su.prereq.list.some((x) => x.id === 'auth' && x.status !== 'ok')) body.append(el('div', 'hint', T('su.prereq.authNote')));
      if (su.prereq && !su.prereq.ready) body.append(el('div', 'hint', T('su.prereq.blocked')));
      body.append(err());
      row.append(suBtn(T('su.back'), 'ghost', () => suGo('lang')), suBtn(T('su.prereq.recheck'), '', suCheck, su.checking), suBtn(T('su.next'), 'primary', () => suGo('home'), su.checking || !(su.prereq && su.prereq.ready)));
    } else if (su.step === 'home') {
      body.append(el('h2', '', T('su.home.title')));
      const ul = el('ul'); for (const k of ['su.home.l1', 'su.home.l2', 'su.home.l3', 'su.home.l4']) ul.append(el('li', '', T(k)));
      body.append(ul);
      if (su.busy) { const w = el('p', '', T('su.home.working')); w.setAttribute('role', 'status'); body.append(w); }
      body.append(err());
      if (su.blocked) body.insertBefore(el('div', 'su-err', T('su.err.' + su.blocked)), row);
      row.append(suBtn(T('su.back'), 'ghost', () => suGo('prereq'), su.busy), suBtn(T('su.home.create'), 'primary', suCreateHome, su.busy || !!su.blocked));
    } else if (su.step === 'connect') {
      body.append(el('h2', '', T('su.connect.title')), el('p', '', T('su.connect.intro')), el('p', 'hint', T('su.connect.laterNote')), err());
      row.append(suBtn(T('su.connect.later'), 'ghost', suLater, su.busy), suBtn(T('su.connect.preview'), 'primary', suConnect, su.busy));
    } else {
      body.append(el('h2', '', T('su.done.title')), el('p', '', T('su.done.textMeet')));
      if (su.later) body.append(el('p', 'hint', T('su.done.later')));
      row.append(suBtn(T('su.done.skip'), 'ghost', () => suFinish(false)), suBtn(T('su.done.meet'), 'primary', () => suFinish(true)));
    }
    body.append(row);
    if (focusFirst) { const f = body.querySelector('input, .btn.primary'); if (f) f.focus(); }
  }
  async function suCreateHome() {
    if (su.busy || su.fake) return;
    su.busy = true; su.err = ''; renderSetup(false);
    let r = null; try { r = await window.maru.setupCreateHome(su.name, lang); } catch (e) { r = null; }
    if (r && r.ok) return; // 앱이 곧 다시 시작된다(홈이 생기면 첫 설정은 연결 단계부터 이어진다)
    su.busy = false;
    const reason = r && r.reason;
    su.err = reason === 'cancelled' ? '' : T(['exists', 'invalid', 'save', 'not-managed', 'home-symlink', 'home-owner', 'home-mode', 'payload-missing', 'prereq'].includes(reason) ? 'su.err.' + reason : reason === 'name' ? 'su.err.name' : 'su.err.other');
    renderSetup(false);
  }
  async function suConnect() {
    if (su.busy || su.fake) return;
    su.busy = true; renderSetup(false);
    let ok = false; try { ok = await installDialogs(() => {}); } catch (e) { ok = false; }
    su.busy = false;
    if (ok) { suUnfinished = false; suGo('done'); } else { su.err = ''; renderSetup(false); }
  }
  async function suLater() {
    if (su.fake) return;
    try { await window.maru.setupConnectLater(); } catch (e) { /* 다음 실행에서 다시 보인다 */ }
    su.later = true; suGo('done'); su.later = true; renderSetup(false);
  }
  async function suFinish(meet) {
    if (su.fake) return;
    try { await window.maru.setupFinish(); } catch (e) { /* 무시 */ }
    suClose();
    if (meet) startMeet();
  }

  // ---- 첫 만남 배너·시작 ----
  async function refreshMeet() {
    let r = null; try { r = await window.maru.meetGet(); } catch (e) { r = null; }
    $('meet-banner').hidden = !(r && r.show) || su.open;
  }
  async function startMeet() {
    if (!activeId || modalOpen()) return;
    let r = null; try { r = await window.maru.meetStart(activeId); } catch (e) { r = null; }
    if (r && r.ok) { flashNote(T('meet.note.ok')); refreshMeet(); return; }
    const reason = r && r.reason;
    if (reason === 'cancel') return;
    flashNote(T(reason === 'not-maru' ? 'meet.note.not-maru' : reason === 'not-ready' || reason === 'no-term' ? 'meet.note.not-ready' : 'meet.note.fail'));
  }
  $('meet-start').addEventListener('click', startMeet);
  $('meet-dismiss').addEventListener('click', async () => { try { await window.maru.meetDismiss(); } catch (e) { /* 무시 */ } $('meet-banner').hidden = true; });
  window.maru.onMeet(() => { if (profile && !su.open) startMeet(); });

  // ---- 시작 ----
  async function boot() {
    let init = null;
    try { init = await window.maru.getProfile(); } catch (e) { init = null; }
    if (init) {
      version = init.version || '';
      profile = init.profile || null;
      homeManaged = init.managed === true;
      homeNotice = init.homeNotice === 'failed' || init.homeNotice === 'newer' ? init.homeNotice : null;
      lang = I18N.isLang(profile && profile.lang) ? profile.lang : (I18N.isLang(init.defaultLang) ? init.defaultLang : 'ko');
    }
    applyStatic();
    if (homeNotice) { $('home-warn').textContent = T('home.warn.' + homeNotice); $('home-warn').hidden = false; }
    renderBusy('none');
    tickClock(); setInterval(tickClock, 15000);
    let sg = null; try { sg = await window.maru.setupGet(); } catch (e) { sg = null; }
    suUnfinished = !!(sg && sg.unfinished);
    if (sg && sg.needed) suOpen(sg.fake ? sg.step : sg.stage === 'connect' ? 'connect' : 'lang', sg.fake, sg.blocked);
    else if (!profile) openNameDialog('onboard');
    else if (init && init.uiOpen === 'menu') openMenu();
    else if (init && init.uiOpen === 'settings') openSettings();
    else if (init && init.uiOpen === 'update') openUpdate();
    window.maru.updateNotice().then((n) => { if (n) { updNotice = n; $('upd-dot').hidden = false; } }).catch(() => {});
    syncWs().then(poll).then(() => { if (init && init.uiOpen === 'project') openFirstProject(); if (init && (init.uiOpen === 'memory' || init.uiOpen === 'memgraph')) openMemory(init.uiOpen === 'memgraph' ? 'graph' : 'list'); if (init && init.uiOpen === 'inbox') { setNotifsOpen(true); $('inbox').scrollIntoView({ block: 'end' }); } }); // 시험 전용(MARU_APP_UI=project): 화면 확인용으로 상세를 연 채 둔다
    setInterval(poll, 1000);
    refreshMeet(); setInterval(refreshMeet, 30000);
    setInterval(() => { if (lastPanels) renderInbox(lastPanels.inbox); }, 30000); // 상대 시각(N분 전)을 갱신
    setInterval(syncWs, 1000); // 상태 파일은 이벤트가 없으므로 주기적으로 읽는다
  }
  boot();
})();
