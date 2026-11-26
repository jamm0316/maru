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
    closeMenu(false); closeUpdate(false); closeWsMenu(false);
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
    if (modalOpen() || wsEdit) return; // 이름을 고치는 동안에는 터미널이 포커스를 가져가지 않는다(가져가면 입력칸이 포커스를 잃어 확정돼 버린다)
    if (detailOpen) { (detailMode === 'inbox' ? $('id-title') : detailMode === 'memory' ? $('mv-title') : detailMode === 'day' ? $('dv-title') : $('pd-title')).focus(); return; } // 상세가 터미널 자리를 차지하는 동안은 상세에 포커스를 둔다
    if (readTermFolded) { readTa.focus(); return; } // 읽기 화면에서 터미널이 띠로 접혀 있으면 xterm 입력칸이 보이지 않는다: 입력창이 키 입력을 받는다
    const e = terms.get(activeId); if (e && e.opened) e.term.focus();
  }
  // Tab 순환(모달 안에서만)
  function trapTab(e) {
    const top = modals[modals.length - 1];
    if (!top) return;
    const f = [...top.el.querySelectorAll('button, input, textarea, [tabindex]:not([tabindex="-1"]), pre[tabindex]')].filter((n) => !n.disabled && !n.hidden && n.offsetParent !== null);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0]; const last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !top.el.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !top.el.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }

  // ---- 터미널: 작업 공간마다 xterm 하나를 살려 두고 활성만 보인다 ----
  // WebGL 은 활성 터미널에만 붙이고, 숨길 때 dispose 한다(컨텍스트 수 제한 회피). 비활성 터미널은 DOM 렌더러 없이도 버퍼만 유지한다.
  let memView = null; // 기억 보기(memview.js). 가운데 영역을 차지하는 세 번째 상세
  let detailMode = 'project'; // 'project' | 'inbox' | 'memory' | 'day': 가운데 상세가 무엇인지(모두 detailOpen 으로 터미널을 가린다)
  let detailOpen = false; let detailKey = null; let detail = null; let detailSig = ''; let detailSeq = 0; // 프로젝트 상세(아래 '프로젝트' 절). 열려 있으면 터미널은 숨기기만 한다
  const terms = new Map(); // id -> { id, term, fit, host, gl, opened, started, starting }
  let activeId = null; let stepReady = true; let foldBusy = false;
  let arrowEpoch = 0; // 클릭·끌어 놓기가 있으면 올린다: 추천 넣기·파일 놓기처럼 키 입력을 거치지 않고 입력란이 바뀔 수 있어, 그 뒤에는 화살표로 바꾸지 않는다
  for (const ev of ['mousedown', 'drop']) document.addEventListener(ev, () => { arrowEpoch++; }, true);
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
    // 한글처럼 조합 중인 글자가 있을 때 Shift+Enter 를 누르면 줄바꿈이 조합 글자보다 먼저 나가 순서가 뒤집힌다.
    // 조합 중이면 줄바꿈을 미뤄 두었다가, 조합이 끝나 글자가 pty 로 나간 직후에 보낸다(글자가 안 오면 짧은 대기 뒤에 보낸다).
    // endedAt: 조합이 끝났지만 그 글자가 아직 pty 로 나가지 않은 동안의 시각(xterm 은 조합 글자를 한 박자 늦게 보낸다). 글자가 나가면 0.
    let composing = false; let pendNl = null; let pendTimer = null; let nlAt = 0; let endedAt = 0;
    const justEnded = () => endedAt !== 0 && Date.now() - endedAt < 200;
    const flushNl = () => { if (pendNl === null) return; const s = pendNl; pendNl = null; clearTimeout(pendTimer); nlAt = Date.now(); if (!modalOpen()) window.maru.ptyWrite(id, s); };
    // imeBusy: xterm 이 숨은 입력칸 값을 읽으려고 걸어 둔 타이머(setTimeout 0)가 아직 돌지 않았다. 그 타이머보다 먼저 건 타이머 안에서 다시 타이머를 걸면 xterm 것이 돈 뒤에 풀린다(시간에 기대지 않는다)
    let imeBusy = false; let imeSeq = 0;
    const imeSettle = () => { const n = ++imeSeq; imeBusy = true; setTimeout(() => setTimeout(() => { if (imeSeq === n) imeBusy = false; }, 0), 0); };
    host.addEventListener('compositionstart', () => { composing = true; endedAt = 0; }, true);
    host.addEventListener('compositionend', () => { composing = false; endedAt = Date.now(); imeSettle(); if (pendNl !== null) { clearTimeout(pendTimer); pendTimer = setTimeout(flushNl, 60); } }, true);
    let navAt = 0; let navDrawn = true; // Cmd+↑/↓ 로 ↑/↓ 를 보낸 시각, 그 뒤 화면이 다시 그려졌는지
    term.onWriteParsed(() => { navDrawn = true; });
    let arrowSt = null; let arrowAt = 0; // 화살표 바꾸기 상태(직전에 친 글자, 방금 바꾼 것), 그 상태를 만든 때의 arrowEpoch
    term.attachCustomKeyEventHandler((e) => {
      if (modalOpen()) return false;
      // 숨은 입력칸에 쌓인 입력기 글자를 비운다(쌓여 있으면 xterm 이 이미 보낸 글을 통째로 다시 보낼 수 있다). xterm 이 입력칸 값을 읽기 전인 이 자리에서 해야 한다
      if (term.textarea && term.textarea.value !== '' && Lib.imeCanReset({ type: e.type, composing, isComposing: e.isComposing, settling: imeBusy, pending: pendNl !== null })) term.textarea.value = '';
      if (e.type === 'keydown' && e.keyCode === 229 && !composing && !e.isComposing) imeSettle(); // 조합 없이 바로 들어오는 글자: xterm 이 이 키 뒤에 입력칸을 읽는다
      if (e.type === 'keydown' && (e.metaKey || e.ctrlKey || e.altKey || (e.key.length !== 1 && e.key !== 'Backspace' && e.key !== 'Shift'))) arrowSt = null; // 커서를 옮기거나 지우는 키 뒤에는 화살표로 바꾸지 않는다(직전 글자가 더는 커서 앞에 없을 수 있다)
      if (Lib.isShiftEnter(e)) {
        if (composing || e.isComposing || e.keyCode === 229 || pendNl !== null || justEnded()) {
          if (e.type === 'keydown' && pendNl === null && !e.repeat) { pendNl = '\x1b\r'; pendTimer = setTimeout(flushNl, composing ? 300 : 60); }
          // 조합이 이미 끝난 뒤의 일반 Enter 는 기본 동작(입력란에 줄바꿈 삽입)을 막는다. 아직 조합 중이면 막지 않는다: 입력기가 조합을 확정해야 글자가 나온다
          if (!composing && !e.isComposing && e.keyCode !== 229) e.preventDefault();
          return false;
        }
        if (e.type === 'keydown' && Date.now() - nlAt < 50) { e.preventDefault(); return false; } // 확정 직후 같은 키가 한 번 더 오는 입력기: 줄바꿈 두 번 방지
      }
      const alt = term.buffer.active.type === 'alternate'; // vim 등 alternate screen 에서는 Cmd+←/→ 를 그대로 둔다. 단 Claude Code(fullscreen 렌더러도 alternate screen)는 예외
      if (e.type === 'keydown' && e.key === 'Escape' && e.isTrusted && !e.isComposing && e.keyCode !== 229 && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.repeat) window.maru.ptyEsc(id); // 중단 감지용 알림만(키는 그대로 pty 로 간다)
      const cc = !!(wsList.find((x) => x.id === id) || {}).cc;
      if (Lib.isStepKey(e) || Lib.isFoldKey(e)) return false; // Cmd+Shift+↑/↓ 는 전역 핸들러가 처리한다(터미널로 보내지 않는다)
      if (Lib.isBufNavKey(e, alt, cc)) { // Cmd+↑/↓: 입력란 전체의 맨 앞/끝. keypress·keyup 도 같이 삼킨다
        if (e.type === 'keydown') {
          e.preventDefault();
          if (e.repeat) return false;
          const up = e.key === 'ArrowUp'; let rows = 0;
          // 방금 보낸 이동이 화면에 반영되기 전에는 줄 수를 다시 세지 않는다(낡은 화면으로 세면 ↑ 가 남아 이전 입력 이력으로 넘어간다)
          const settled = navAt === 0 || (navDrawn && Date.now() - navAt >= 150);
          if (cc && settled) { // Claude Code 화면에서만 줄 수를 센다(셸은 줄 안에서만 움직인다)
            const b = term.buffer.active; const lines = [];
            for (let i = 0; i < term.rows; i++) { const ln = b.getLine(b.baseY + i); lines.push(ln ? ln.translateToString(true) : ''); }
            rows = Lib.promptEdgeRows(lines, b.cursorY, up);
          }
          if (rows > 0) { navAt = Date.now(); navDrawn = false; }
          window.maru.ptyWrite(id, Lib.bufNavSeq(up, rows, !!(term.modes && term.modes.applicationCursorKeysMode)));
        }
        return false;
      }
      const seq = Lib.keyToSeq(e, alt, cc);
      if (seq === null) return !(Lib.isNewlineKey(e) || Lib.isLineNavKey(e, alt, cc)); // Shift+Enter 의 keypress 가 Enter(전송)로 새지 않게, Cmd+←/→ 의 keypress·keyup 도 같이 삼킨다
      if (e.type === 'keydown') { e.preventDefault(); window.maru.ptyWrite(id, seq); }
      return false;
    });
    term.onData((d) => {
      const send = (s) => { if (s && !modalOpen()) window.maru.ptyWrite(id, s); };
      if (pendNl !== null && !composing) {
        // 조합에서 나온 글자면 글자 → 줄바꿈 순서로(입력란에 끼어든 줄바꿈 문자는 뗀다). 조합과 무관한 입력이면 미뤄 둔 줄바꿈을 먼저 보낸다
        if (justEnded()) { endedAt = 0; send(d.replace(/[\r\n]+$/, '')); flushNl(); } else { flushNl(); send(d); }
        return;
      }
      if (!composing) endedAt = 0;
      // Claude Code 입력란에서 직접 친 -> <- <-> 를 화살표로 바꾼다(붙여넣기·조합 글자는 한 글자가 아니라 그대로 간다)
      if ((wsList.find((x) => x.id === id) || {}).cc && !composing) { if (arrowAt !== arrowEpoch) { arrowSt = null; arrowAt = arrowEpoch; } const a = Lib.arrowInput(arrowSt, d); arrowSt = a.st; send(a.out); return; }
      arrowSt = null;
      send(d);
    });
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

  let colDragging = false; let dragFitTimer = null; // 패널 너비를 끄는 동안에는 pty 크기 맞춤을 120ms 에 한 번으로 묶는다(놓을 때 반드시 한 번 더 맞춘다)
  function doFit() {
    if (colDragging) { if (!dragFitTimer) dragFitTimer = setTimeout(() => { dragFitTimer = null; if (colDragging) doFitNow(); }, 120); return; }
    doFitNow();
  }
  function doFitNow() {
    const e = terms.get(activeId);
    if (detailOpen || !e || !e.opened || e.host.hidden || readTermFolded) return; // 상세가 터미널을 가리는 동안과 읽기 화면에서 띠로 접힌 동안은 맞추지 않는다(크기 0 으로 pty 를 줄이지 않게)
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
  // 첫 메시지 길: main 이 요청하면 앞서 받은 출력이 모두 해석된 뒤(write 의 콜백) 보이는 화면을 읽어 돌려준다. 판정은 main 이 한다
  window.maru.onReadSnapReq((id, nonce) => {
    const e = terms.get(id);
    if (!e || !e.term) { window.maru.readSnap(id, nonce, { lines: [], plain: [], cursorX: 0, cursorY: 0, rows: 0, cols: 0 }); return; }
    const term = e.term;
    term.write('', () => {
      try {
        const b = term.buffer.active; const lines = []; const plain = []; let cell;
        for (let i = 0; i < term.rows; i++) {
          const ln = b.getLine(b.baseY + i); const s = ln ? ln.translateToString(true) : ''; lines.push(s);
          if (!ln || Math.abs(i - b.cursorY) > 40) { plain.push(s); continue; } // 커서 줄 위아래 40줄만 칸마다 본다. 나머지는 lines 와 같은 글
          // plain: 흐린 글자(SGR 2) 칸을 공백으로 바꾼 같은 줄. 넓은 글자는 뒤 칸(폭 0)을 건너뛴다. 줄 끝 공백은 지운다
          let out = '';
          for (let x = 0; x < ln.length; x++) {
            cell = ln.getCell(x, cell); if (!cell) break;
            const w = cell.getWidth(); if (w === 0) continue;
            out += cell.isDim() ? ' '.repeat(w) : (cell.getChars() || ' ');
          }
          plain.push(out.replace(/ +$/, ''));
        }
        window.maru.readSnap(id, nonce, { lines, plain, cursorX: b.cursorX, cursorY: b.cursorY, rows: term.rows, cols: term.cols });
      } catch (x) { window.maru.readSnap(id, nonce, null); }
    });
  });
  window.maru.onPtyExit((id, code) => {
    const e = terms.get(id);
    if (e) e.term.write('\r\n\x1b[38;5;208m' + T(code === 127 ? 'term.noclaude' : 'term.exit', { code }) + '\x1b[0m\r\n');
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

  // ---- 좌우 패널 너비 조절(손잡이) ----
  // colsUser: 사용자가 정한 너비({left,right}) 또는 null(= 기본 CSS 그대로). 창이 줄면 화면에 적용하는 값만 줄이고 이 값은 유지한다.
  let colsUser = null; let colsStore = false;
  const colsEl = $('cols'); const colHandles = { left: $('col-l'), right: $('col-r') };
  const colsApplied = () => (colsUser ? Lib.clampPanelWidths(colsUser, window.innerWidth) : { ...Lib.PANEL_DEFAULT });
  // 손잡이는 position:fixed 로 열 사이 간격 가운데에 놓는다(.cols 를 기준 상자로 만들면 그 안의 절대 배치 요소 위치가 달라진다)
  const colSideEls = { left: colsEl.querySelector('.left'), right: colsEl.querySelector('.right-col') };
  function placeColHandles() {
    const c = colsEl.getBoundingClientRect(); const l = colSideEls.left.getBoundingClientRect(); const r = colSideEls.right.getBoundingClientRect();
    for (const [side, x] of [['left', l.right + 4], ['right', r.left - 12]]) {
      const st = colHandles[side].style; st.left = x + 'px'; st.top = (c.top + 16) + 'px'; st.height = Math.max(0, c.height - 32) + 'px';
    }
  }
  new ResizeObserver(placeColHandles).observe(colsEl); new ResizeObserver(placeColHandles).observe(colSideEls.left); new ResizeObserver(placeColHandles).observe(colSideEls.right);
  function applyCols() {
    const w = colsApplied();
    if (colsUser) { colsEl.style.setProperty('--left-w', w.left + 'px'); colsEl.style.setProperty('--right-w', w.right + 'px'); }
    else { colsEl.style.removeProperty('--left-w'); colsEl.style.removeProperty('--right-w'); }
    placeColHandles();
    for (const side of ['left', 'right']) {
      const rg = Lib.panelRange(side, side === 'left' ? w.right : w.left, window.innerWidth); const h = colHandles[side];
      h.setAttribute('aria-valuemin', String(rg.min)); h.setAttribute('aria-valuemax', String(rg.max)); h.setAttribute('aria-valuenow', String(w[side]));
    }
    if (readCurOn) applyReadLayout(); // 읽기 화면이 켜져 있으면 왼쪽 열 너비가 바뀌어도 읽기 영역이 360px 아래로 줄지 않게 터미널 폭 제한과 손잡이 aria 값을 다시 맞춘다
  }
  function saveCols() {
    if (!colsStore) return;
    try {
      const d = Lib.PANEL_DEFAULT;
      if (!colsUser || (colsUser.left === d.left && colsUser.right === d.right)) { colsUser = null; localStorage.removeItem(Lib.PANEL_STORE_KEY); applyCols(); }
      else localStorage.setItem(Lib.PANEL_STORE_KEY, JSON.stringify({ left: colsUser.left, right: colsUser.right }));
    } catch (x) { /* 저장 실패해도 이번 실행에서는 그대로 동작 */ }
  }
  function setColWidth(side, px, persist, raw) { // px 는 범위 안으로 줄여서 적용한다. raw(기본값으로 되돌리기): 창이 좁아 지금은 줄여 보이더라도 정한 값 그대로 둔다
    const cur = colsApplied(); const rg = Lib.panelRange(side, side === 'left' ? cur.right : cur.left, window.innerWidth);
    const v = raw ? px : Math.max(rg.min, Math.min(rg.max, Math.round(px)));
    colsUser = { ...(colsUser || Lib.PANEL_DEFAULT) }; colsUser[side] = v; // 반대쪽은 사용자가 정해 둔 값을 그대로 둔다(창이 좁아 줄여 보이는 값으로 덮어쓰지 않는다)
    applyCols(); if (persist) saveCols();
  }
  function initCols(init) {
    let dev = null; if (init && init.cols && typeof init.cols === 'object') dev = init.cols;
    colsStore = !!(init && init.colsStore === true);
    if (dev) { colsUser = { left: dev.left, right: dev.right }; for (const k of ['left', 'right']) colHandles[k].classList.add('active'); } // 시험 전용(MARU_APP_COLS): 손잡이 선을 켜 둔다(위치 확인용)
    else if (colsStore) { try { colsUser = Lib.parsePanelWidths(localStorage.getItem(Lib.PANEL_STORE_KEY)); } catch (x) { colsUser = null; } } // 스모크·가짜 화면(colsStore 거짓)에서는 읽지도 쓰지도 않는다
    applyCols();
  }
  let colDrag = null; // { side, id, x0, w0, user0 }
  function endColDrag(commit) {
    if (!colDrag) return;
    const d = colDrag; colDrag = null; colDragging = false;
    document.body.classList.remove('col-drag'); colHandles[d.side].classList.remove('active');
    document.removeEventListener('keydown', colDragKey, true);
    try { if (colHandles[d.side].hasPointerCapture(d.id)) colHandles[d.side].releasePointerCapture(d.id); } catch (x) { /* 무시 */ }
    if (!commit) { colsUser = d.user0; applyCols(); } else saveCols();
    clearTimeout(dragFitTimer); dragFitTimer = null;
    requestAnimationFrame(doFit); doFit(); // 놓은 뒤 최종 크기로 한 번 맞춘다(레이아웃 반영 뒤 한 번 더)
    readFoldPass(); // 끄는 동안 건너뛴 읽기 화면 질문 접힘 재기를 끝난 뒤 한 번 돈다
    if (document.activeElement === colHandles[d.side]) { colHandles[d.side].blur(); focusTerm(); } // 마우스로 끌고 난 뒤 손잡이에 포커스가 남으면 이어서 친 글자가 터미널로 가지 않는다
  }
  function colDragKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); endColDrag(false); } }
  for (const side of ['left', 'right']) {
    const h = colHandles[side];
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || colDrag || modalOpen()) return;
      e.preventDefault();
      const cur = colsApplied();
      colDrag = { side, id: e.pointerId, x0: e.clientX, w0: cur[side], user0: colsUser ? { ...colsUser } : null };
      colDragging = true; document.body.classList.add('col-drag'); h.classList.add('active');
      try { h.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
      document.addEventListener('keydown', colDragKey, true);
    });
    h.addEventListener('pointermove', (e) => {
      if (!colDrag || colDrag.id !== e.pointerId) return;
      const dx = e.clientX - colDrag.x0;
      setColWidth(side, colDrag.w0 + (side === 'left' ? dx : -dx), false);
    });
    h.addEventListener('pointerup', (e) => { if (colDrag && colDrag.id === e.pointerId) endColDrag(true); });
    h.addEventListener('pointercancel', (e) => { if (colDrag && colDrag.id === e.pointerId) endColDrag(false); });
    h.addEventListener('lostpointercapture', (e) => { if (colDrag && colDrag.id === e.pointerId) endColDrag(true); });
    const toDefault = () => { if (!modalOpen()) setColWidth(side, Lib.PANEL_DEFAULT[side], true, true); };
    h.addEventListener('dblclick', (e) => { e.preventDefault(); toDefault(); });
    h.addEventListener('keydown', (e) => {
      if (modalOpen() || colDrag || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
      const d = Lib.panelKeyDelta(side, e.key, e.shiftKey);
      if (d === null) return;
      e.preventDefault(); e.stopPropagation();
      const cur = colsApplied(); const rg = Lib.panelRange(side, side === 'left' ? cur.right : cur.left, window.innerWidth);
      if (d === 'default') toDefault(); else setColWidth(side, d === 'min' ? rg.min : d === 'max' ? rg.max : cur[side] + d, true);
    });
  }
  window.addEventListener('resize', applyCols);

  // ---- 읽기 화면: 가운데 읽기 영역 + 오른쪽 고정 폭 터미널(접으면 34px 띠). 켜짐·터미널 폭·접힘은 작업 공간별로 기억한다 ----
  // 켜지면 #cols 에 read-on(오른쪽 카드 열·손잡이 숨김), 터미널 카드에 read-term(고정 폭)·rail(띠). 상세 화면이 열린 동안에는 읽기 배치를 적용하지 않는다.
  let readTermFolded = false; // 읽기 배치에서 터미널이 띠로 접힌 상태(doFitNow 가 이 동안 맞추지 않는다)
  let readStore = {}; // { 작업 공간 id: { on, w, rail } }. localStorage(Lib.READ_STORE_KEY)에는 colsStore 와 같은 조건에서만 쓴다(아니면 이번 실행 메모리에만)
  let readDevDefault = null; let readDevWait = false; // 시험 전용(MARU_APP_UI=read|readrail|readwait): 저장값이 없는 작업 공간의 기본 상태 / 답 기다림 표시 흉내
  let readTermOver = false; // 좁은 창에서 터미널이 읽기 영역을 덮고 있는가(저장하지 않는다)
  let readCurId = null; let readCurOn = false; let readSig = '';
  let readKey = ''; let readSeq = 0; let readFetching = false; let readLoaded = false; let readItems = []; let readMore = false; let readForceBottom = true;
  const readExpanded = new Set(); // 펼쳐 둔 긴 질문(at:글 해시)
  let readSaved = null; // 읽기 영역을 숨기기 직전의 스크롤({ id, near, top }). 다시 보일 때 되돌린다(숨은 동안은 스크롤 값이 0 이 된다)
  let readResizing = false; let readResizeTimer = null; // 창 크기를 바꾸는 동안은 질문 접힘 재기를 건너뛴다
  let readDevSend = false; // 시험 전용(MARU_APP_UI=read|readrail): 입력창이 보낼 수 있는 상태로 보인다(main 도 실제로 쓰지 않는다)
  const readDrafts = new Map(); // 작업 공간 id -> 쓰던 글(렌더러 메모리에만 둔다)
  let readSending = false; let readSendId = null; let readNoteKey = ''; // 보내는 중 / 마지막 보내기 거부 이유(i18n 키 끝 조각)
  let readSide = false; // 터미널이 접혀 오른쪽 카드 열이 같이 보이는 중
  let readSurfHold = false; // 입력창으로 보내기에 성공한 뒤 다음 기록 갱신(readRender)이 올 때까지 화면 블록 단추를 끈다
  let readLastFill = ''; let readFillAt = 0; let readFillHeld = false; let readEnterDown = false; // 단추로 채운 글·시각·채울 때 Enter 가 눌려 있었나·지금 Enter 가 눌려 있나
  let readDevTop = false; // 시험 전용(MARU_APP_UI=readsurftop): 마지막 화면 블록의 위쪽이 보이게 스크롤한다
  const readHash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }; // 질문 글의 짧은 해시(펼침 상태 키용)
  const termWrap = document.querySelector('.term-wrap');
  const readEl = $('read'); const readBody = $('read-body'); const readList = $('read-list'); const readStatusEl = $('read-status'); const readHandle = $('read-h');
  const readTa = $('read-ta'); const readSendBtn = $('read-send'); const readInputBox = $('read-input'); const readInputNote = $('read-input-note');
  const readSt = (id) => readStore[id] || readDevDefault || Lib.readDefault(); // 저장된 상태가 없는 작업 공간은 읽기 화면을 켜고 터미널은 접힌 띠로 시작한다
  const readSurfSeen = new Set(); // 이미 센 화면 블록 답변(작업 공간 id:답변 시각). 같은 답변을 다시 그려도 한 번만 센다
  const readEffW = (st) => Lib.readTermWidth(st.w, window.innerWidth, colsApplied().left);
  function readSave() {
    if (!colsStore) return;
    try {
      if (wsList.length) { const ids = new Set(wsList.map((w) => w.id)); const keep = {}; for (const k of Object.keys(readStore)) if (ids.has(k)) keep[k] = readStore[k]; readStore = keep; } // 닫힌 작업 공간의 값은 지운다
      localStorage.setItem(Lib.READ_STORE_KEY, JSON.stringify(readStore));
    } catch (x) { /* 저장 실패해도 이번 실행에서는 그대로 동작 */ }
  }
  function readSet(patch, persist) {
    if (!activeId) return;
    readStore = Lib.readStoreSet(readStore, activeId, { ...readSt(activeId), ...patch });
    applyReadLayout(); if (persist) readSave();
  }
  function readReset() { readSeq++; readKey = ''; readItems = []; readMore = false; readLoaded = false; readExpanded.clear(); readForceBottom = true; readSaved = null; readSurfHold = false; readList.replaceChildren(); }
  const readNearBottom = () => readBody.scrollHeight - readBody.scrollTop - readBody.clientHeight <= 80;
  const readUx = () => { if (readDevWait) return 'waiting'; const w = wsList.find((x) => x.id === activeId); return w ? (w.ux || w.state) : ''; };
  function renderReadStatus() { // 작업 중·답 기다림 표시(읽기 영역 맨 아래 줄)와 접힌 띠의 점·테두리
    const ux = readCurOn ? readUx() : ''; const wait = ux === 'waiting'; const busy = ux === 'busy';
    const txt = wait ? T('read.wait') : busy ? T('read.busy') : '';
    const near = readNearBottom(); const was = readStatusEl.hidden;
    readStatusEl.classList.toggle('wait', wait);
    if (readStatusEl.textContent !== txt) readStatusEl.textContent = txt;
    readStatusEl.hidden = txt === '';
    if (was !== readStatusEl.hidden && near && !readEl.hidden) readBody.scrollTop = readBody.scrollHeight; // 맨 아래를 보고 있었으면 새 줄까지 따라간다
    $('read-rail-dot').className = 'read-rail-dot' + (wait ? ' wait' : busy ? ' busy' : '');
    const stripAlert = readTermFolded && (readNoteKey === 'first-screen' || readNoteKey === 'first-unsent'); // 첫 메시지 길이 거부했다: 접힌 터미널 안에 확인 창이 있을 수 있다
    termWrap.classList.toggle('read-wait', wait || stripAlert); // 접힌 띠의 테두리를 주황으로(펼치지는 않는다)
    renderReadInput();
  }
  function placeReadHandle() {
    if (readHandle.hidden) return;
    const c = colsEl.getBoundingClientRect(); const t = termWrap.getBoundingClientRect(); const st = readSt(activeId);
    readHandle.style.left = (t.left - 12) + 'px'; readHandle.style.top = (c.top + 16) + 'px'; readHandle.style.height = Math.max(0, c.height - 32) + 'px';
    readHandle.setAttribute('aria-valuemin', String(Lib.READ_TERM_MIN)); readHandle.setAttribute('aria-valuemax', String(Lib.readTermMax(window.innerWidth, colsApplied().left))); readHandle.setAttribute('aria-valuenow', String(readEffW(st)));
  }
  new ResizeObserver(() => { placeReadHandle(); readFoldPass(); }).observe(colsEl); new ResizeObserver(placeReadHandle).observe(termWrap); new ResizeObserver(() => { readFoldPass(); readFitTa(); }).observe(readEl);
  function readAnchor() { // 읽기 영역 스크롤 위치 기억: 맨 아래 근처면 그것만, 아니면 맨 위에 보이는 항목과 그 위치
    if (readNearBottom()) return { near: true };
    const top = readBody.getBoundingClientRect().top; const ch = readList.children;
    for (let i = 0; i < ch.length; i++) { const r = ch[i].getBoundingClientRect(); if (r.bottom > top + 1) return { near: false, idx: i, off: r.top - top }; }
    return { near: false, idx: -1, off: 0, st: readBody.scrollTop };
  }
  function readAnchorRestore(a) {
    if (!a || readEl.hidden) return;
    if (a.near) { readBody.scrollTop = readBody.scrollHeight; return; }
    const c = a.idx >= 0 ? readList.children[a.idx] : null; if (!c) { if (typeof a.st === 'number') readBody.scrollTop = a.st; return; }
    readBody.scrollTop += c.getBoundingClientRect().top - readBody.getBoundingClientRect().top - a.off;
  }
  function applyReadLayout() { // 멱등: 켜짐·상세·창 폭·터미널 접힘이 바뀔 때마다 부른다
    const id = activeId; const st = id ? readSt(id) : null; const wantOn = !!st && st.on === true;
    const idChanged = id !== readCurId; const wasFolded = readTermFolded;
    if (idChanged || wantOn !== readCurOn) { if (idChanged) readDraftSwap(readCurId, id); readCurId = id; readCurOn = wantOn; readTermOver = false; readReset(); if (wantOn) readTick(); } //작업 공간이 바뀌었거나 켜고 꺼졌다: 받아 둔 것을 비우고 새로 받는다
    const on = wantOn && !detailOpen; const narrow = Lib.readIsNarrow(window.innerWidth);
    if (!on || !narrow) readTermOver = false;
    const over = on && readTermOver; const railed = on && !over && (narrow || st.rail === true); const eff = on ? readEffW(st) : 0;
    const ap = colsApplied(); const side = railed && Lib.readSideShown(window.innerWidth, ap.left, ap.right); // 접힌 띠일 때만, 읽기 영역이 360px 이상 남을 때만 오른쪽 카드 열을 같이 보인다
    const anchor = !readEl.hidden && !readResizing && (railed !== wasFolded || side !== readSide) ? readAnchor() : null; // 접고 펼 때 읽기 영역 폭이 바뀐다: 보던 자리를 기억해 둔다
    readTermFolded = railed; readSide = side;
    colsEl.classList.toggle('read-on', on); colsEl.classList.toggle('read-side', side);    if (on) colsEl.style.setProperty('--read-tw', eff + 'px'); else colsEl.style.removeProperty('--read-tw');
    termWrap.classList.toggle('read-term', on && !over); termWrap.classList.toggle('rail', railed);
    if (anchor && on && !over) { readAnchorRestore(anchor); requestAnimationFrame(() => readAnchorRestore(anchor)); } // 레이아웃을 바로 다시 재서 한 번, 다음 프레임(크기 관찰자 처리 뒤)에 한 번 되돌린다
    const hide = !on || over; const wasHidden = readEl.hidden;
    if (hide && !wasHidden) readSaved = { id, near: readNearBottom(), top: readBody.scrollTop }; // 숨기면 스크롤 값이 0 이 된다: 숨기기 직전에 기억한다
    readEl.hidden = hide; $('read-rail').hidden = !railed;
    if (!hide && wasHidden) readRestoreScroll();
    const tg = $('read-toggle'); tg.hidden = !id || detailOpen; tg.setAttribute('aria-pressed', String(wantOn));
    $('read-fold').hidden = !(on && !narrow && !railed); $('read-back').hidden = !over;
    readHandle.hidden = !(on && !railed && !over);
    placeReadHandle(); renderReadStatus();
    if (railed && (!wasFolded || idChanged)) { // 터미널이 띠로 접혔다(접을 때·좁은 창·접힌 작업 공간으로 전환·저장된 접힘으로 켤 때): 키 입력이 갈 곳을 입력창으로 옮긴다
      const a = document.activeElement;
      if (idChanged || !a || a === document.body || termWrap.contains(a)) focusTerm(); // 접힌 상태의 focusTerm 은 입력창에 포커스를 준다. 다른 입력칸에서 치는 중이면 뺏지 않는다
    }
    const sig = [on, railed, over, eff, narrow, side].join();
    if (sig !== readSig) { readSig = sig; requestAnimationFrame(() => { placeReadHandle(); doFit(); readFoldPass(); }); } // 터미널 크기가 바뀌었다: xterm 을 다시 맞춘다(접힌 동안은 doFitNow 가 막는다)
  }
  window.addEventListener('resize', () => {
    readResizing = true; clearTimeout(readResizeTimer); readResizeTimer = setTimeout(() => { readResizing = false; readFoldPass(); }, 150); // 크기를 바꾸는 동안은 질문 접힘을 재지 않고 멈춘 뒤 한 번만 잰다
    applyReadLayout();
  });
  function readRestoreScroll() { // 숨었다가 다시 보일 때: 맨 아래를 보고 있었으면 맨 아래로, 아니면 가능한 한 원래 위치로
    const s = readSaved; readSaved = null;
    readFoldPass(); readFitTa(); // 접힘 단추와 입력창 높이를 먼저 맞춘 뒤 스크롤한다(높이가 바뀌므로)
    if (readForceBottom && readLoaded) { readBody.scrollTop = readBody.scrollHeight; readForceBottom = false; return; } // 숨은 동안 처음 받은 대화
    if (s && s.id === readCurId) readBody.scrollTop = s.near ? readBody.scrollHeight : s.top;
  }
  // ---- 읽기 화면 그리기: 모두 textContent 로만. 모르는 블록·조각은 글로 그리거나 건너뛴다 ----
  function readInl(parent, inl) {
    if (!Array.isArray(inl)) return;
    for (const p of inl) {
      if (!p || typeof p.v !== 'string') continue;
      if (p.s === 'b') parent.append(el('strong', '', p.v));
      else if (p.s === 'c') parent.append(el('code', 'read-c', p.v));
      else parent.append(document.createTextNode(p.v));
    }
  }
  function readListEl(b, depth) {
    const ord = b.t === 'ol'; const l = el(ord ? 'ol' : 'ul', 'read-ul');
    if (ord && Number.isInteger(b.start) && b.start >= 0 && b.start < 1e6) l.start = b.start;
    for (const it of Array.isArray(b.items) ? b.items : []) {
      if (!it || typeof it !== 'object') continue;
      const li = el('li'); readInl(li, it.inl);
      if (depth < 1 && it.sub && typeof it.sub === 'object' && Array.isArray(it.sub.items)) li.append(readListEl({ t: it.sub.t === 'ol' ? 'ol' : 'ul', start: it.sub.start, items: it.sub.items }, depth + 1)); // 하위 목록은 한 단계
      l.append(li);
    }
    return l;
  }
  function readTable(b) {
    const wrap = el('div', 'read-tw'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', T('read.table.aria')); // 가로로 넘치면 이 상자만 가로 스크롤
    const tb = el('table', 'read-table'); const al = Lib.readTableAligns(b);
    const cell = (tag, c, k) => { const e = el(tag, al[k] === 'right' ? 'read-al-r' : al[k] === 'center' ? 'read-al-c' : ''); readInl(e, c); return e; };
    const head = Array.isArray(b.head) ? b.head : [];
    const thead = el('thead'); const hr = el('tr');
    head.forEach((c, k) => { const th = cell('th', c, k); th.scope = 'col'; hr.append(th); }); thead.append(hr); tb.append(thead);
    const tbody = el('tbody');
    for (const r of Array.isArray(b.rows) ? b.rows : []) {
      if (!Array.isArray(r)) continue;
      const tr = el('tr'); for (let k = 0; k < head.length; k++) tr.append(cell('td', r[k], k)); tbody.append(tr);
    }
    tb.append(tbody); wrap.append(tb);
    return wrap;
  }
  function readCode(b) {
    const lang = typeof b.lang === 'string' ? b.lang.trim().slice(0, 40) : '';
    const w = el('div', 'read-code' + (lang ? ' has-lang' : ''));
    if (lang) { const l = el('span', 'read-code-lang', lang); l.setAttribute('aria-hidden', 'true'); w.append(l); }
    const pre = el('pre'); pre.tabIndex = 0; pre.setAttribute('role', 'group'); pre.setAttribute('aria-label', T('read.code.aria') + (lang ? ' ' + lang : ''));
    pre.append(el('code', '', typeof b.text === 'string' ? b.text : '')); w.append(pre);
    return w;
  }
  // ---- 화면 블록(에이전트가 만든 화면): 점선 상자 안에 정해진 부품만 그린다. 글은 모두 textContent, 막대 폭만 계산한 숫자 퍼센트 ----
  function readSurfFill(btn, text) { // 단추: 입력창에 글을 넣고 포커스만 준다. 보내는 함수와 보내기 IPC 는 부르지 않는다
    if (btn.disabled || btn.dataset.last !== '1' || modalOpen() || readSending || !activeId || activeId !== readCurId || readEl.hidden || readLock() !== '') return;
    const c = Lib.readCleanSend(text); if (!c.ok || c.text !== text) return; // 입력창이 보낼 때와 같은 정리를 한 번 더 거친다. 비거나, 정리한 글이 단추의 글과 다르면 채우지 않는다(보이는 글과 채우는 글이 같아야 한다)
    if (readTa.value.trim() !== '') {
      if (readTa.value === readLastFill) { readTa.focus(); return; } // 방금 채운 글 그대로다: "채웠습니다" 안내를 "채우지 않았습니다"로 덮지 않는다
      readNoteKey = 'fillno'; renderReadInput(); return; // 쓰던 글을 지우지 않는다
    }
    readTa.value = c.text; readLastFill = c.text; readNoteKey = 'fillok'; readFillAt = Date.now(); readFillHeld = readEnterDown; readFitTa(); renderReadInput(); // Enter 로 단추를 눌렀다면 그 Enter 의 keyup 이 올 때까지 입력창 Enter 는 보내지 않는다
    readTa.focus(); const n = readTa.value.length; try { readTa.setSelectionRange(n, n); } catch (x) { /* 무시 */ }
    window.maru.readMark('fill');
  }
  function readSurfBtn(text, cls, last) {
    const b = el('button', 'read-sb ' + cls, text); b.type = 'button'; b.dataset.last = last ? '1' : '0'; b.disabled = true; // 켜짐 여부는 readSurfRefresh 가 맞춘다
    b.addEventListener('click', () => readSurfFill(b, text));
    return b;
  }
  function readSurfRefresh() { // 마지막 답변의 단추만, 입력창이 글을 받을 수 있을 때만 누를 수 있다
    const ok = readCurOn && !readEl.hidden && !readSending && !readSurfHold && readLock() === '';
    for (const b of readList.querySelectorAll('.read-sb')) { const d = !(ok && b.dataset.last === '1'); if (b.disabled !== d) b.disabled = d; }
  }
  function readSurfPart(box, p, last) {
    if (!p || typeof p !== 'object') return;
    const items = Array.isArray(p.items) ? p.items : [];
    if (p.t === 'stats') {
      const g = el('div', 'read-surf-stats'); g.style.setProperty('--n', String(Math.min(4, Math.max(1, items.length))));
      for (const s of items) { const c = el('div', 'read-surf-stat'); c.append(el('span', 'read-surf-stat-l', String(s.label)), el('span', 'read-surf-stat-v', String(s.value))); if (s.note) c.append(el('span', 'read-surf-stat-n', String(s.note))); g.append(c); }
      box.append(g);
    } else if (p.t === 'bars') {
      const g = el('div', 'read-surf-bars');
      for (const s of items) {
        const pct = Number.isFinite(s.value) && Number.isFinite(s.max) && s.max > 0 ? Math.round(Math.min(1, Math.max(0, s.value / s.max)) * 1000) / 10 : 0;
        const r = el('div', 'read-surf-bar'); const tr = el('div', 'read-surf-bar-t'); const f = el('span', 'read-surf-bar-f'); f.style.width = pct + '%'; tr.append(f); tr.setAttribute('aria-hidden', 'true');
        r.append(el('span', 'read-surf-bar-l', String(s.label)), tr, el('span', 'read-surf-bar-x', String(s.text))); g.append(r);
      }
      box.append(g);
    } else if (p.t === 'kv') {
      const d = el('dl', 'read-surf-kv'); for (const s of items) d.append(el('dt', '', String(s.k)), el('dd', '', String(s.v))); box.append(d);
    } else if (p.t === 'note') {
      box.append(el('p', 'read-surf-note' + (p.kind === 'warn' ? ' sw' : ''), String(p.text)));
    } else if (p.t === 'table') {
      const w = el('div', 'read-surf-tb'); if (p.title) w.append(el('p', 'read-surf-tt', String(p.title)));
      w.append(readTable(p)); if (p.cut === true) w.append(el('p', 'read-note', T('read.cut'))); box.append(w); // 1부의 표 그리기 함수를 다시 쓴다
    } else if (p.t === 'choice') {
      const w = el('div', 'read-surf-ch'); w.append(el('p', 'read-surf-q', String(p.q)));
      const o = el('div', 'read-surf-opts'); for (const s of Array.isArray(p.options) ? p.options : []) if (typeof s === 'string' && s) o.append(readSurfBtn(s, 'opt', last));
      w.append(o); box.append(w);
    } else if (p.t === 'text') box.append(el('p', '', String(p.text)));
  }
  function readSurface(host, b, ctx) {
    const box = el('div', 'read-surf'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', T('read.surf.aria'));
    box.append(el('p', 'read-surf-src', T('read.surf.src'))); // 출처 표지: 항상 보인다
    if (typeof b.title === 'string' && b.title) box.append(el('h3', 'read-surf-title', b.title));
    for (const p of Array.isArray(b.parts) ? b.parts : []) { try { readSurfPart(box, p, ctx.last); } catch (x) { /* 이 부품만 건너뛴다 */ } }
    const nx = (Array.isArray(b.next) ? b.next : []).filter((s) => typeof s === 'string' && s);
    if (nx.length) { const r = el('div', 'read-surf-next'); r.append(el('span', 'read-surf-next-l', T('read.surf.next'))); for (const s of nx) r.append(readSurfBtn(s, 'nx', ctx.last)); box.append(r); }
    if (b.truncated === true) box.append(el('p', 'read-note', T('read.trunc')));
    host.append(box);
    if (ctx.last && ctx.key && !readSurfSeen.has(ctx.key)) { if (readSurfSeen.size > 500) readSurfSeen.clear(); readSurfSeen.add(ctx.key); window.maru.readMark('surf'); } // 그린 횟수(답변마다 한 번, 내용은 보내지 않는다)
  }
  function readBlock(host, b, ctx) {
    if (!b || typeof b !== 'object') return;
    const t = b.t;
    if (t === 'surface') { readSurface(host, b, ctx || { last: false, key: '' }); return; }
    if (t === 'h') { const lv = b.level === 1 || b.level === 2 ? b.level : 3; const h = el('h' + (lv + 2), 'read-h read-h' + lv); readInl(h, b.inl); host.append(h); }
    else if (t === 'ul' || t === 'ol') host.append(readListEl(b, 0));
    else if (t === 'quote') { const q = el('blockquote', 'read-quote'); readInl(q, b.inl); host.append(q); }
    else if (t === 'hr') host.append(el('hr', 'read-hr'));
    else if (t === 'table') host.append(readTable(b));
    else if (t === 'code') host.append(readCode(b));
    else if (Array.isArray(b.inl)) { const p = el('p'); readInl(p, b.inl); host.append(p); } // 문단과 모르는 종류
    else return;
    if (b.cut === true) host.append(el('p', 'read-note', T('read.cut')));
  }
  function readItemEl(it, idx) {
    if (!it || typeof it !== 'object') return null;
    if (it.role === 'user') {
      const wrap = el('div', 'read-item q'); const text = typeof it.text === 'string' ? it.text : '';
      if (text) {
        const q = el('div', 'read-q'); const k = String(it.at) + ':' + readHash(text); const open = readExpanded.has(k);
        const tx = el('div', 'read-q-t' + (open ? '' : ' fold'), text);
        const btn = el('button', 'read-q-more', T(open ? 'read.less' : 'read.more')); btn.type = 'button'; btn.hidden = true; btn.setAttribute('aria-expanded', String(open)); // 6줄을 넘을 때만 readFoldPass 가 보인다
        btn.addEventListener('click', () => {
          if (readExpanded.has(k)) readExpanded.delete(k); else readExpanded.add(k);
          const o = readExpanded.has(k); tx.classList.toggle('fold', !o); btn.textContent = T(o ? 'read.less' : 'read.more'); btn.setAttribute('aria-expanded', String(o));
        });
        q.append(tx, btn); wrap.append(q);
      }
      if (it.lost === true) wrap.append(el('p', 'read-note', T('read.lost')));
      if (it.cut === true) wrap.append(el('p', 'read-note', T('read.cut')));
      return wrap;
    }
    if (it.role === 'assistant') {
      const wrap = el('div', 'read-item'); const box = el('div', 'read-a');
      const ctx = { last: idx === readItems.length - 1, key: readCurId + ':' + String(it.at) }; // 단추는 대화의 마지막 항목인 답변에서만 누를 수 있다
      for (const b of Array.isArray(it.blocks) ? it.blocks : []) { try { readBlock(box, b, ctx); } catch (x) { /* 이 블록만 건너뛴다 */ } }
      if (it.lost === true) box.append(el('p', 'read-note', T('read.lost')));
      if (it.cut === true) box.append(el('p', 'read-note', T('read.cut')));
      if (it.truncated === true) box.append(el('p', 'read-note', T('read.trunc')));
      wrap.append(box); return wrap;
    }
    return null;
  }
  function readFoldPass() { // 접힌 질문이 6줄을 넘치는지 재어 "더 보기"를 보인다. 읽기 영역이 숨어 있으면(크기 0)·손잡이를 끌거나 창 크기를 바꾸는 동안은 건너뛴다(끝난 뒤 한 번 돈다)
    if (readEl.hidden || colDragging || readDrag || readResizing) return;
    const todo = []; // 먼저 모두 재고(읽기) 나중에 한꺼번에 쓴다(질문마다 레이아웃을 다시 계산하지 않게)
    for (const q of readList.querySelectorAll('.read-q')) {
      const tx = q.firstElementChild; const btn = q.lastElementChild; if (!tx || !btn || tx === btn) continue;
      if (!tx.classList.contains('fold')) { todo.push([btn, true]); continue; }
      if (tx.clientHeight === 0) continue;
      todo.push([btn, tx.scrollHeight > tx.clientHeight + 1]);
    }
    for (const [btn, show] of todo) if (btn.hidden === show) btn.hidden = !show;
  }
  function readRender() {
    const hidden = readEl.hidden; // 숨은 동안은 크기가 0 이라 스크롤을 셈하지 않는다(다시 보일 때 readRestoreScroll 이 위치를 되돌린다)
    const near = hidden ? false : readNearBottom(); const top = hidden ? 0 : readBody.scrollTop; const force = readForceBottom;
    const frag = document.createDocumentFragment();
    if (readMore) frag.append(el('p', 'read-old', T('read.old')));
    if (!readItems.length && readLoaded) { // 대화가 비었다: 세션의 첫 메시지는 입력창으로 보낼 수 없다(1부 규칙). 앱 자체 안내와 터미널을 펴는 단추
      const f = el('div', 'read-first'); f.append(el('p', 'read-empty', T('read.empty')), el('p', '', T('read.first')));
      const fb = el('button', 'read-first-b', T('read.first.btn')); fb.type = 'button'; fb.addEventListener('click', () => { if (modalOpen()) return; if (readTermFolded) readExpandTerm(); else focusTerm(); });
      f.append(fb); frag.append(f);
    }
    readItems.forEach((it, idx) => { try { const n = readItemEl(it, idx); if (n) frag.append(n); } catch (x) { /* 이 항목만 건너뛴다 */ } });
    readList.replaceChildren(frag);
    readSurfHold = false; readSurfRefresh(); // 새 기록이 왔다: 보내기 뒤에 끈 단추를 다시 켠다(마지막 답변의 것만)
    if (hidden) return;
    readFoldPass();
    readBody.scrollTop = near || force ? readBody.scrollHeight : top; // 맨 아래 근처(80px)를 보고 있었으면 새 맨 아래로, 위로 올려 읽는 중이면 그 자리를 지킨다
    readForceBottom = false;
    if (readDevTop) { const ss = readList.querySelectorAll('.read-surf'); const s = ss[ss.length - 1]; if (s) readBody.scrollTop += s.getBoundingClientRect().top - readBody.getBoundingClientRect().top - 8; } // 시험 전용: 마지막 화면 블록의 위쪽(표지·제목·수치 카드)이 보이게
  }
  async function readTick() { // 1초 poll 에서 부른다. 켜진 활성 작업 공간에 대해서만 받는다
    try {
      renderReadStatus();
      if (!activeId || readCurId !== activeId || !readCurOn || readFetching || detailOpen) return; // 상세 화면이 열려 읽기 배치가 풀린 동안은 받지 않는다
      const id = activeId; const my = readSeq; readFetching = true;
      let res = null;
      try { res = await window.maru.talkGet(id, readKey); } catch (x) { res = null; } finally { readFetching = false; }
      if (my !== readSeq || id !== activeId || !readCurOn) return; // 그 사이 작업 공간이 바뀌었거나 꺼졌다
      if (!res || typeof res !== 'object' || typeof res.key !== 'string' || res.same === true || !Array.isArray(res.items)) return;
      if (readLoaded && res.key === '' && readKey === '' && !res.items.length && !readItems.length) return; // 빈 대화가 그대로면 다시 그리지 않는다(첫 메시지 안내의 단추가 매초 바뀌지 않게)
      readKey = res.key; readItems = res.items; readMore = res.more === true; readLoaded = true;
      readRender();
    } catch (x) { /* 읽기 화면 오류가 앱을 멈추지 않게 한다 */ }
  }
  $('read-toggle').addEventListener('click', () => { if (modalOpen() || !activeId) return; const on = readSt(activeId).on !== true; readSet({ on }, true); if (on) window.maru.readMark('on'); if (!on) focusTerm(); });
  $('read-close').addEventListener('click', () => { if (modalOpen() || !activeId) return; readSet({ on: false }, true); focusTerm(); });
  $('read-fold').addEventListener('click', () => { if (modalOpen()) return; readSet({ rail: true }, true); focusTerm(); }); // 접히면 포커스는 입력창으로 간다(applyReadLayout 도 옮기지만 단추에 남은 포커스를 확실히 걷는다)
  function readExpandTerm() {
    if (Lib.readIsNarrow(window.innerWidth)) { readTermOver = true; applyReadLayout(); } else readSet({ rail: false }, true); // 좁은 창에서는 저장 없이 읽기 영역을 덮는다
    doFit(); focusTerm();
  }
  $('read-rail').addEventListener('click', () => { if (modalOpen()) return; readExpandTerm(); });
  $('read-back').addEventListener('click', () => { readTermOver = false; applyReadLayout(); focusTerm(); }); // 다시 접힌 터미널 대신 입력창에 포커스가 간다
  // 읽기 영역과 터미널 사이 손잡이: 끌기(Esc 로 취소)·키보드·더블클릭(기본 폭). 폭은 놓을 때 저장한다
  let readDrag = null; // { id, x0, w0, w00 }
  function readSetW(px, persist) { readSet({ w: Lib.readTermWidth(px, window.innerWidth, colsApplied().left) }, persist); }
  function endReadDrag(commit) {
    if (!readDrag) return;
    const d = readDrag; readDrag = null; colDragging = false;
    document.body.classList.remove('col-drag'); readHandle.classList.remove('active');
    document.removeEventListener('keydown', readDragKey, true);
    try { if (readHandle.hasPointerCapture(d.id)) readHandle.releasePointerCapture(d.id); } catch (x) { /* 무시 */ }
    if (!commit) readSet({ w: d.w00 }, false); else readSave();
    clearTimeout(dragFitTimer); dragFitTimer = null;
    requestAnimationFrame(doFit); doFit(); readFoldPass(); // 끄는 동안 건너뛴 질문 접힘 재기를 끝난 뒤 한 번 돈다
    if (document.activeElement === readHandle) { readHandle.blur(); focusTerm(); }
  }
  function readDragKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); endReadDrag(false); } }
  readHandle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || readDrag || modalOpen() || !activeId) return;
    e.preventDefault();
    const st = readSt(activeId); readDrag = { id: e.pointerId, x0: e.clientX, w0: readEffW(st), w00: st.w };
    colDragging = true; document.body.classList.add('col-drag'); readHandle.classList.add('active');
    try { readHandle.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
    document.addEventListener('keydown', readDragKey, true);
  });
  readHandle.addEventListener('pointermove', (e) => { if (readDrag && readDrag.id === e.pointerId) readSetW(readDrag.w0 - (e.clientX - readDrag.x0), false); });
  readHandle.addEventListener('pointerup', (e) => { if (readDrag && readDrag.id === e.pointerId) endReadDrag(true); });
  readHandle.addEventListener('pointercancel', (e) => { if (readDrag && readDrag.id === e.pointerId) endReadDrag(false); });
  readHandle.addEventListener('lostpointercapture', (e) => { if (readDrag && readDrag.id === e.pointerId) endReadDrag(true); });
  readHandle.addEventListener('dblclick', (e) => { e.preventDefault(); if (!modalOpen()) readSetW(Lib.READ_TERM_DEFAULT, true); });
  readHandle.addEventListener('keydown', (e) => {
    if (modalOpen() || readDrag || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || !activeId) return;
    const d = Lib.panelKeyDelta('right', e.key, e.shiftKey); if (d === null) return; // 오른쪽 열 손잡이와 같은 키: ← 가 터미널을 넓힌다
    e.preventDefault(); e.stopPropagation();
    const cur = readEffW(readSt(activeId));
    readSetW(d === 'default' ? Lib.READ_TERM_DEFAULT : d === 'min' ? Lib.READ_TERM_MIN : d === 'max' ? Lib.readTermMax(window.innerWidth, colsApplied().left) : cur + d, true);
  });
  // ---- 읽기 화면 입력창: 쉬는 중일 때만 보낼 수 있다(main 이 다시 검사한다). 잠겨 있어도 글은 쓸 수 있다 ----
  function readLock() { // '' (보낼 수 있다) | 'busy' | 'wait' | 'draft' | 'settling' | 'notclaude' | 'first' | 'touched' | 'failed' | 'shell'. 미리 보이는 이유일 뿐이고 최종 판단은 main(read:send)이다
    if (readDevWait) return 'wait';
    if (readDevSend) return '';
    const w = wsList.find((x) => x.id === activeId); if (!w) return 'shell';
    const ux = w.ux || w.state;
    if (ux === 'waiting') return 'wait';
    if (ux === 'busy') return 'busy';
    if (typeof w.sr !== 'string') return 'shell'; // main 이 판정을 보내지 않았다: 잠근다
    const sr = w.sr; // main 의 L.readCanSend 결과(''=통과)
    return sr === '' ? '' : sr === 'busy' ? 'busy' : sr === 'waiting' ? 'wait' : sr === 'draft' || sr === 'settling' || sr === 'notclaude' || sr === 'first' || sr === 'touched' || sr === 'failed' ? sr : 'shell';
  }
  function readFitTa() { // 내용에 따라 1줄에서 8줄까지 늘어난다. 숨어 있으면(크기 0) 건너뛴다
    if (readEl.hidden) return;
    readTa.style.height = 'auto';
    const lh = parseFloat(getComputedStyle(readTa).lineHeight) || 21; const max = Math.round(lh * 8 + 10);
    const h = readTa.scrollHeight; if (h > 0) readTa.style.height = Math.min(h, max) + 'px';
  }
  function renderReadInput() {
    const lock = readLock(); const wait = lock === 'wait';
    const noteKey = (readNoteKey === 'first-screen' || readNoteKey === 'first-unsent') && lock !== 'wait' ? readNoteKey : lock || readNoteKey; // 잠긴 이유가 보내기 거부 이유보다 먼저다. 단 첫 메시지 길의 거부는 더 알려 주므로(터미널 확인) 일반 잠금 문구(first·draft)보다 앞선다
    const txt = noteKey ? T('read.input.' + noteKey) : '';
    readInputBox.classList.toggle('wait', wait); readInputNote.classList.toggle('wait', wait);
    if (readInputNote.textContent !== txt) readInputNote.textContent = txt;
    readInputNote.hidden = txt === '';
    readSendBtn.disabled = readSending || lock !== '' || readTa.value.trim() === ''; // 보내는 중에는 잠가 두 번 보내지 않게 한다
    const ro = readSending && readSendId === readCurId; if (readTa.readOnly !== ro) readTa.readOnly = ro; // 보내는 동안 그 글이 든 입력창은 읽기 전용: 보낸 글과 그 사이에 쓴 글이 섞이지 않는다
    const ph = T('read.input.ph'); if (readTa.placeholder !== ph) readTa.placeholder = ph;
    readSurfRefresh();
  }
  function readDraftSwap(from, to) { // 작업 공간을 바꿀 때 쓰던 글을 맡기고 새 작업 공간의 글을 꺼낸다(디스크에는 쓰지 않는다)
    if (from) { if (readTa.value !== '') readDrafts.set(from, readTa.value); else readDrafts.delete(from); }
    const ids = new Set(wsList.map((x) => x.id)); for (const k of [...readDrafts.keys()]) if (!ids.has(k)) readDrafts.delete(k); // 닫힌 작업 공간의 글은 버린다
    readTa.value = to && readDrafts.has(to) ? readDrafts.get(to) : ''; readNoteKey = ''; readLastFill = ''; readFitTa();
  }
  async function readSendNow() {
    if (readSending || !activeId || modalOpen()) return;
    if (activeId !== readCurId) { applyReadLayout(); return; } // 입력창의 글은 readCurId 작업 공간의 것이다. 다르면 보내지 않고 입력창을 지금 작업 공간에 맞춘 뒤 멈춘다
    const id = activeId; const raw = readTa.value;
    if (raw.trim() === '') return;
    if (readLock() !== '') { renderReadInput(); return; }
    readSending = true; readSendId = id; readNoteKey = ''; renderReadInput();
    let res = null;
    try { res = await window.maru.readSend(id, raw); } catch (x) { res = null; }
    readSending = false; readSendId = null;
    if (res && res.ok === true) {
      readSurfHold = true; readLastFill = ''; // 다음 기록 갱신(readRender)이 올 때까지 화면 블록 단추를 끈다: 방금 보낸 답이 아직 지난 답변 위에 있다
      if (id === activeId) { if (readTa.value === raw) { readTa.value = ''; readFitTa(); } } else if (readDrafts.get(id) === raw) readDrafts.delete(id); // 보내는 사이 작업 공간을 바꿨으면 맡겨 둔 글을 지운다
    } else if (id === activeId) {
      const r = res && typeof res.reason === 'string' ? res.reason : '';
      readNoteKey = r === 'busy' ? 'busy' : r === 'waiting' ? 'wait' : r === 'draft' || r === 'settling' || r === 'notclaude' || r === 'first' || r === 'touched' || r === 'failed' || r === 'first-screen' || r === 'first-unsent' ? r : r === 'shell' || r === 'nosession' ? 'shell' : r === 'toolong' || r === 'empty' || r === 'rate' ? r : 'invalid'; // 글은 그대로 둔다(first-screen·first-unsent 도: 띠 강조는 renderReadStatus 가 한다)
    }
    renderReadStatus(); // 안에서 renderReadInput 도 부른다
    if (id === activeId && !readEl.hidden) readTa.focus();
  }
  let readComposing = false; let readComposeEnd = 0;
  readTa.addEventListener('compositionstart', () => { readComposing = true; });
  readTa.addEventListener('compositionend', () => { readComposing = false; readComposeEnd = Date.now(); });
  readTa.addEventListener('input', () => { readNoteKey = ''; readFitTa(); renderReadInput(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter') readEnterDown = true; }, true); // 지금 Enter 가 눌려 있나(단추를 Enter 로 눌러 채웠는지 알기 위해)
  document.addEventListener('keyup', (e) => { if (e.key === 'Enter') { readEnterDown = false; readFillHeld = false; } }, true);
  window.addEventListener('blur', () => { readEnterDown = false; readFillHeld = false; }); // 창을 떠나면 keyup 을 못 받을 수 있다
  readTa.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return; // Shift+Enter 는 줄바꿈(기본 동작)
    if (e.isComposing || e.keyCode === 229 || readComposing || Date.now() - readComposeEnd < 50) return; // 한글 등 조합 중의 Enter 는 조합 확정용이다(터미널 입력과 같은 판단)
    if (e.repeat) { e.preventDefault(); return; } // 길게 눌러 반복되는 Enter 는 보내지 않는다
    if (readFillHeld || Date.now() - readFillAt < 500) { e.preventDefault(); return; } // 단추로 채운 직후 500ms, 그리고 채울 때 눌려 있던 Enter 를 뗄 때까지는 조용히 무시한다
    e.preventDefault();
    readSendNow();
  });
  readSendBtn.addEventListener('click', () => { readSendNow(); });
  function initRead(init) {
    if (colsStore) { try { readStore = Lib.readParseStore(localStorage.getItem(Lib.READ_STORE_KEY)); } catch (x) { readStore = {}; } } // 스모크·가짜 화면(colsStore 거짓)에서는 읽지도 쓰지도 않는다
    const m = init && typeof init.uiOpen === 'string' ? init.uiOpen : '';
    if (m === 'read' || m === 'readrail' || m === 'readwait' || m === 'readsurf' || m === 'readsurftop' || m === 'readempty') readDevDefault = { on: true, w: Lib.READ_TERM_DEFAULT, rail: m !== 'read' && m !== 'readsurf' && m !== 'readsurftop' }; // 시험 전용: 저장값이 없는 작업 공간은 켜진 채로
    else if (!colsStore) readDevDefault = { on: false, w: Lib.READ_TERM_DEFAULT, rail: false }; // 스모크·다른 가짜 화면은 새 기본값(읽기 화면 켜짐)을 따르지 않고 예전 화면 그대로 둔다
    readDevWait = m === 'readwait'; readDevSend = m === 'read' || m === 'readrail' || m === 'readsurf' || m === 'readsurftop' || m === 'readempty'; readDevTop = m === 'readsurftop';
    applyReadLayout();
  }

  // ---- 작업 공간 목록 ----
  let wsSeq = 0; let wsKey = null; const shownWsNotes = new Set();
  const stateKey = (s) => (['busy', 'idle', 'waiting', 'exited', 'pending', 'unavailable', 'unknown', 'turnEnded'].includes(s) ? s : 'none');
  let wsCollapsedIds = []; // 접어 둔 부모 작업 공간의 고정 id(main 이 화면 상태 파일에 저장)
  async function syncWs() {
    const my = ++wsSeq;
    let r = null;
    try { r = await window.maru.getWorkspaces(); } catch (x) { r = null; }
    if (!r || !Array.isArray(r.list) || my !== wsSeq) return; // 더 새 요청이 있으면 버린다
    const prev = activeId;
    const ids = new Set(r.list.map((w) => w.id));
    for (const w of r.list) { // 앱을 다시 켜며 이어 열었거나(또는 새로 시작한) 탭: 활성이 됐을 때 한 번만 알린다(백그라운드 탭은 처음 보일 때)
      if (!['resumed', 'moved', 'old', 'other', 'failed'].includes(w.note) || w.id !== r.active || shownWsNotes.has(w.id + w.note)) continue;
      shownWsNotes.add(w.id + w.note);
      if (w.prev === true && w.note !== 'resumed') { // 옛 세션을 되돌릴 수 있다: 명시적 단추(main 이 다시 검증한다)
        const box = $('quest-note');
        openNote(box, [el('span', '', T('ws.note.' + w.note)), document.createTextNode(' · '), noteButton(T('ws.note.openPrev'), async () => {
          let res = null; try { res = await window.maru.resumePrevious(w.id); } catch (x) { res = null; }
          if (res && res.ok) box.replaceChildren();
          else if (!res || res.reason !== 'cancel') openNote(box, [el('span', '', T(Lib.openNoticeKey(res && res.reason)))], 6000);
        })], 15000);
      } else flashNote(T('ws.note.' + w.note));
    }
    const fresh = [];
    for (const w of r.list) if (!terms.has(w.id)) { const e = createTerm(w.id); fresh.push(e); if (w.bp) e.term.write('\x1b[?2004h'); } // 화면 복구로 다시 붙을 때 붙여넣기 모드를 되살린다
    for (const e of [...terms.values()]) if (!ids.has(e.id)) disposeTerm(e);
    wsList = r.list; activeId = ids.has(r.active) ? r.active : null;
    if (activeId !== readCurId) applyReadLayout(); // renderWs 가 일찍 끝나는 경로(조합 중·끄는 중)에서도 입력창의 글을 맡기고 새 작업 공간의 글로 바꾼다
    wsCollapsedIds = Array.isArray(r.collapsed) ? r.collapsed.filter((x) => typeof x === 'string') : [];
    syncConsent(r.consent);
    renderWs(); sbParentGone();
    if (activeId !== prev || fresh.some((e) => e.id === activeId)) { closeDetail(false); showActive(true); } // 상세가 터미널을 가린 채로는 xterm 을 열지 않는다(숨은 컨테이너에서 open 금지)
    ensureStarted(terms.get(activeId));
    for (const w of r.list) if (w.auto === true && w.id !== activeId) ensureStarted(terms.get(w.id)); // 마루가 연 하위 세션은 보이지 않아도 시작한다(Enter 없이 맡긴 일이 시작되도록)
  }
  const fmtClock = (t) => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  function childNoteText(n) {
    if (!n) return '';
    if (n.kind === 'opened') return T('child.note.opened', { title: String(n.title || '') });
    if (n.kind === 'paste') return T('child.note.paste', { title: String(n.title || '') });
    if (n.kind === 'cancel') return T('child.note.cancel');
    if (n.kind === 'subskip') return T('child.note.subskip', { title: String(n.title || '') });
    if (n.kind === 'prefill') return T('child.note.prefill');
    return T('child.note.refused', { reason: T(Lib.childReasonKey(n.reason), { n: Lib.CHILD_MAX }) });
  }

  // ---- 작업 공간 이름 변경(인라인 편집) ----
  // wsEdit: 편집 중인 행 하나. input = 지금 그려진 입력칸, busy = 목록을 다시 그리는 중(blur 를 확정으로 치지 않는다), composing = 한글 조합 중
  let wsEdit = null;
  function makeWsInput(w, restore) {
    const inp = el('input', 'ws-edit'); inp.type = 'text'; inp.maxLength = Lib.WS_TITLE_MAX; inp.spellcheck = false; inp.autocomplete = 'off';
    inp.setAttribute('aria-label', T('ws.rename.aria'));
    inp.value = restore ? restore.value : w.title;
    wsEdit.composing = false;
    for (const ev of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'contextmenu']) inp.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === 'contextmenu') e.preventDefault(); });
    inp.addEventListener('compositionstart', () => { if (wsEdit && wsEdit.input === inp) wsEdit.composing = true; });
    inp.addEventListener('compositionend', () => { if (wsEdit && wsEdit.input === inp) wsEdit.composing = false; });
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 페이지의 전역 키 처리로 새지 않게(앱 메뉴의 ⌘ 단축키는 그대로 동작한다)
      if (e.isComposing || e.keyCode === 229) return; // 조합 중의 Enter·Esc 는 입력기 몫
      if (e.key === 'Enter') { e.preventDefault(); endWsEdit(true, true); }
      else if (e.key === 'Escape') { e.preventDefault(); endWsEdit(false, true); }
    });
    inp.addEventListener('keyup', (e) => e.stopPropagation());
    inp.addEventListener('blur', () => {
      if (!(wsEdit && wsEdit.input === inp && !wsEdit.busy && inp.isConnected)) return;
      if (!wsPtrDown) { endWsEdit(true, false); return; }
      // 다른 곳을 눌러서 포커스를 잃었다: 지금 목록을 다시 그리면 눌린 단추가 사라져 그 클릭이 없어진다. 클릭이 끝난 뒤에 확정한다
      const ed = wsEdit; document.addEventListener('mouseup', () => setTimeout(() => { if (wsEdit === ed) endWsEdit(true, false); }, 0), { once: true, capture: true });
    });
    return inp;
  }
  let wsPtrDown = false; // 마우스 단추가 눌려 있는 동안(입력칸의 blur 가 클릭 도중에 온 것인지 가린다)
  document.addEventListener('mousedown', () => { wsPtrDown = true; }, true);
  document.addEventListener('mouseup', () => { wsPtrDown = false; }, true);
  window.addEventListener('blur', () => { wsPtrDown = false; });
  function startWsEdit(id) {
    const w = wsList.find((n) => n.id === id);
    if (!w || modalOpen() || wsEdit) return;
    closeWsMenu(false);
    wsEdit = { id, orig: w.title, input: null, busy: false, composing: false, ending: false };
    wsKey = null; renderWs();
    if (wsEdit && wsEdit.input) { wsEdit.input.focus(); wsEdit.input.select(); }
  }
  // 확정(commit) 또는 취소. refocus: 키보드로 끝냈을 때 그 행의 버튼으로 포커스를 돌려 준다(바깥을 눌러 끝났으면 건드리지 않는다)
  async function endWsEdit(commit, refocus) {
    const ed = wsEdit;
    if (!ed || ed.ending) return;
    ed.ending = true;
    const value = ed.input ? ed.input.value : ed.orig;
    wsEdit = null; wsKey = null; renderWs();
    const focusRow = () => { const r = [...$('workspaces').children].find((n) => n.dataset.id === ed.id); const t = r && r.querySelector('.ws-main'); if (t) t.focus(); else focusTerm(); };
    if (refocus) focusRow();
    if (commit && value !== ed.orig) {
      let res = null; try { res = await window.maru.renameWorkspace(ed.id, value); } catch (x) { res = null; }
      if (!res || !res.ok) flashNote(T(res && res.reason === 'title' ? 'ws.rename.err' : 'ws.rename.fail'));
    }
    wsKey = null; await syncWs();
  }
  // ---- 작업 공간 우클릭 메뉴(앱 안 DOM 메뉴): 이름 변경 / 제거 ----
  let wsMenu = null; // { id, el, x, y }
  function closeWsMenu(refocus) {
    if (!wsMenu) return;
    const m = wsMenu; wsMenu = null;
    m.el.remove();
    if (refocus) { // 열기 전에 포커스가 있던 곳으로(터미널에서 우클릭했으면 터미널로). 그 요소가 다시 그려져 사라졌으면 그 행으로
      if (m.prev && m.prev.isConnected && m.prev !== document.body) { m.prev.focus(); return; }
      const r = [...$('workspaces').children].find((n) => n.dataset.id === m.id); const t = r && r.querySelector('.ws-main'); if (t) t.focus(); else focusTerm();
    }
  }
  function openWsMenu(id, x, y) {
    const w = wsList.find((n) => n.id === id);
    if (!w || modalOpen() || (wsEdit && wsEdit.id === id)) return;
    closeWsMenu(false); closeMenu(false); closeUpdate(false); closeReports(false);
    const prev = document.activeElement;
    const menu = el('div', 'pop menu ws-menu'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', T('ws.menu.aria', { title: w.title }));
    const mk = (cls, label, fn) => { const b = el('button', 'mi', label); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.dataset.k = cls; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b; };
    menu.append(
      mk('rename', T('ws.menu.rename'), () => startWsEdit(id)),
      mk('remove', T('ws.menu.remove'), async () => {
        closeWsMenu(false);
        let r = null; try { r = await window.maru.closeWorkspace(id); } catch (e) { r = null; }
        await syncWs();
        if (!r || !r.ok) { const row = [...$('workspaces').children].find((n) => n.dataset.id === id); const t = row && row.querySelector('.ws-main'); if (t) t.focus(); } // 취소했으면 원래 행으로
      }),
    );
    menu.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll('[role=menuitem]')]; const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
      else if (e.key === 'Tab') { e.preventDefault(); closeWsMenu(true); }
    });
    document.body.append(menu);
    const r = menu.getBoundingClientRect(); const M = 8;
    menu.style.left = Math.max(M, Math.min(x, window.innerWidth - r.width - M)) + 'px';
    menu.style.top = Math.max(M, Math.min(y, window.innerHeight - r.height - M)) + 'px';
    wsMenu = { id, el: menu, prev };
    menu.querySelector('[role=menuitem]').focus();
  }
  document.addEventListener('mousedown', (e) => { if (wsMenu && !wsMenu.el.contains(e.target)) closeWsMenu(false); }, true);
  document.addEventListener('scroll', (e) => { const t = e.target; if (wsMenu && (t === document || (t && t.contains && t.contains($('workspaces'))))) closeWsMenu(false); }, true); // 목록이 움직일 때만 닫는다(터미널 출력의 스크롤에는 반응하지 않는다)
  window.addEventListener('resize', () => closeWsMenu(false));
  window.addEventListener('blur', () => closeWsMenu(true));
  // 키보드로 메뉴 열기: 행의 버튼에 포커스가 있을 때 ContextMenu 키 또는 Shift+F10(버튼 자리 기준으로 띄운다)
  $('workspaces').addEventListener('keydown', (e) => {
    if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey))) return;
    const row = e.target && e.target.closest ? e.target.closest('.ws') : null;
    if (!row || e.target.classList.contains('ws-edit')) return;
    e.preventDefault();
    const b = row.querySelector('.ws-main').getBoundingClientRect();
    openWsMenu(row.dataset.id, b.left + 24, b.bottom - 4);
  });
  // 시험 전용(MARU_APP_UI=wsmenu|wsrename): 둘째 행의 메뉴를 열거나 이름 편집을 연 채로 둔다(화면 확인용)
  function openWsDev(mode) {
    if (mode === 'wsdrag') { const mark = () => { const rs = $('workspaces').children; if (rs[1]) rs[1].classList.add('grip-on'); const t = rs[3] || rs[rs.length - 1]; if (t && t !== rs[1]) t.classList.add('drop-before'); }; mark(); new MutationObserver(mark).observe($('workspaces'), { childList: true }); return; } // 시험 전용: 둘째 행에 끌기 손잡이, 넷째 행 위에 놓을 자리 선(목록을 다시 그려도 유지)
    const row = $('workspaces').children[1]; if (!row) return;
    if (mode === 'wsmenu') { const b = row.getBoundingClientRect(); openWsMenu(row.dataset.id, b.left + 40, b.top + 30); } else startWsEdit(row.dataset.id);
  }
  // ---- 작업 공간 순서 바꾸기: 끌어 놓기 + ⌥↑/⌥↓. 같은 형제 묶음(최상위끼리·한 부모의 자식끼리)만. 검증은 main(L.reorderWs). 프로젝트 끌기·파일 놓기와는 자체 타입·상태로 분리 ----
  const WS_DRAG_TYPE = 'application/x-maru-ws'; let wsDrag = null; let wsDragPend = false; // wsDrag: { id, group }. 끄는 동안은 renderWs 를 미룬다(DOM 을 바꾸면 dragend 가 오지 않을 수 있다)
  const wsBox = $('workspaces');
  const wsGroupOf = (id) => { const w = wsList.find((x) => x.id === id); const d = Lib.hierarchyOrder(wsList).find((x) => x.id === id); return w && d && d.depth === 1 ? w.parentId : ''; }; // hierarchyOrder 와 같은 규칙의 형제 묶음 키(최상위는 '')
  const wsSibs = (g) => Lib.hierarchyOrder(wsList).filter((x) => (x.depth === 1 ? x.parentId : '') === g).map((x) => x.id);
  const wsItems = () => wsList.map((x) => ({ id: x.id, parentId: x.parentId }));
  const clearWsDrop = () => { for (const n of wsBox.querySelectorAll('.drop-before, .drop-after')) n.classList.remove('drop-before', 'drop-after'); };
  function wsDropInfo(e) {
    if (!wsDrag || !e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], WS_DRAG_TYPE) < 0) return null;
    const row = e.target && e.target.closest ? e.target.closest('.ws') : null;
    if (!row || !wsBox.contains(row) || row.dataset.id === wsDrag.id || row.dataset.group !== wsDrag.group) return null; // 다른 묶음(다른 부모의 자식·최상위↔자식)은 받지 않는다
    const r = row.getBoundingClientRect(); const after = e.clientY >= r.top + r.height / 2;
    let beforeId = row.dataset.id; let mark = row;
    if (after) {
      const sibs = wsSibs(wsDrag.group).filter((x) => x !== wsDrag.id); const i = sibs.indexOf(row.dataset.id);
      beforeId = i >= 0 && i + 1 < sibs.length ? sibs[i + 1] : null;
      if (wsDrag.group === '') { let n = row.nextElementSibling; while (n && n.dataset.group === row.dataset.id) { mark = n; n = n.nextElementSibling; } } // 부모의 자식 줄 아래에 선을 긋는다
    }
    if (!Lib.reorderWs(wsItems(), wsDrag.id, beforeId)) return null; // 제자리이면 받지 않는다
    return { el: mark, after, beforeId };
  }
  function endWsDrag() {
    wsDrag = null; clearWsDrop();
    for (const n of wsBox.querySelectorAll('.dragging')) n.classList.remove('dragging');
    if (wsDragPend) { wsDragPend = false; renderWs(); }
  }
  async function doWsReorder(id, beforeId) {
    let res = null; try { res = await window.maru.reorderWorkspace(id, beforeId); } catch (x) { res = null; }
    await syncWs();
    if (!res || !res.ok) { flashNote(T('ws.err.move')); return false; }
    const sibs = wsSibs(wsGroupOf(id)); const w = wsList.find((x) => x.id === id);
    flashNote(T('ws.moved', { title: w ? w.title : id, pos: sibs.indexOf(id) + 1, total: sibs.length }));
    return true;
  }
  wsBox.addEventListener('dragstart', (e) => {
    const row = e.target && e.target.closest ? e.target.closest('.ws') : null;
    if (!row || !wsBox.contains(row) || !e.dataTransfer || wsEdit || row.getAttribute('draggable') !== 'true') { if (row && e.dataTransfer && e.target === row) e.preventDefault(); return; }
    closeWsMenu(false);
    wsDrag = { id: row.dataset.id, group: row.dataset.group };
    e.dataTransfer.setData(WS_DRAG_TYPE, wsDrag.id); e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  wsBox.addEventListener('dragover', (e) => {
    const d = wsDropInfo(e); clearWsDrop();
    if (!d) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    d.el.classList.add(d.after ? 'drop-after' : 'drop-before');
  });
  wsBox.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !wsBox.contains(e.relatedTarget)) clearWsDrop(); });
  wsBox.addEventListener('drop', (e) => {
    const d = wsDropInfo(e); clearWsDrop();
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    const id = wsDrag.id;
    doWsReorder(id, d.beforeId).then(() => { if (wsDrag && wsDrag.id === id) endWsDrag(); }); // 그사이 새로 시작한 끌기는 건드리지 않는다
  });
  document.addEventListener('dragend', () => { wsPtrDown = false; if (wsDrag) endWsDrag(); }); // 끌기가 끝나면 mouseup 이 오지 않는다
  // 키보드 대안: 행의 버튼에서 ⌥↑/⌥↓ 로 같은 묶음 안에서 한 칸 이동(전역 ⌘⇧↑/↓ 와 겹치지 않게 ⌘·Ctrl·Shift 가 없을 때만)
  wsBox.addEventListener('keydown', (e) => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    const row = e.target && e.target.closest ? e.target.closest('.ws') : null;
    if (!row || !e.target.classList.contains('ws-main') || wsEdit) return;
    e.preventDefault();
    const id = row.dataset.id; const ids = wsSibs(row.dataset.group); const i = ids.indexOf(id); if (i < 0) return;
    const up = e.key === 'ArrowUp';
    if (up ? i === 0 : i === ids.length - 1) return;
    const before = up ? ids[i - 1] : (ids[i + 2] === undefined ? null : ids[i + 2]);
    doWsReorder(id, before).then(() => { const r = [...wsBox.children].find((n) => n.dataset.id === id); const b = r && r.querySelector('.ws-main'); if (b) b.focus(); });
  });
  function renderWs() {
    if (wsDrag) { wsDragPend = true; return; } // 끄는 동안은 다시 그리지 않는다(끝난 뒤 endWsDrag 가 그린다)
    if (wsEdit && !wsList.some((w) => w.id === wsEdit.id)) wsEdit = null; // 편집하던 작업 공간이 사라졌다
    const key = JSON.stringify([wsList, activeId, lang, wsCollapsedIds, wsEdit ? wsEdit.id : null]);
    if (key === wsKey) return;
    if (wsEdit && wsEdit.composing) return; // 한글 조합 중에는 입력칸을 바꿔 끼우지 않는다(조합이 끊긴다). wsKey 를 갱신하지 않았으니 다음 주기에 다시 그린다
    wsKey = key;
    const box = $('workspaces');
    const f = document.activeElement;
    const fr = f && box.contains(f) ? f.closest('.ws') : null;
    const refocus = fr && !(wsEdit && f === wsEdit.input) ? { id: fr.dataset.id, x: f.classList.contains('ws-x'), c: f.classList.contains('ws-chev'), b: f.classList.contains('ws-badge'), s: f.classList.contains('ws-sub') } : null;
    if (wsMenu && !wsList.some((w) => w.id === wsMenu.id)) closeWsMenu(false); // 메뉴는 행에 붙어 있지 않으므로 목록을 다시 그려도 열어 둔다(상태가 바뀔 때마다 닫히면 고를 수 없다). 그 작업 공간이 사라졌을 때만 닫는다
    let edit = null; // 편집 중인 입력칸의 값·선택 범위는 다시 그리기 전에 붙잡아 둔다
    if (wsEdit && wsEdit.input) { edit = { value: wsEdit.input.value, s: wsEdit.input.selectionStart, e: wsEdit.input.selectionEnd, d: wsEdit.input.selectionDirection, focus: document.activeElement === wsEdit.input }; wsEdit.busy = true; }
    box.replaceChildren(); // (크롬은 포커스 있는 요소를 떼어낼 때 blur 를 보낸다: busy 동안은 확정하지 않는다)
    const nums = numberMap();
    const kidCount = new Map(); for (const w of wsList) if (w.parentId) kidCount.set(w.parentId, (kidCount.get(w.parentId) || 0) + 1);
    const titleOf = new Map(wsList.map((w) => [w.id, w.title]));
    const grp = new Map(Lib.hierarchyOrder(wsList).map((x) => [x.id, x.depth === 1 ? x.parentId : '']));
    const lastOf = new Map(); for (const w of wsList) if (w.parentId) lastOf.set(w.parentId, w.id);
    for (const w of wsList) {
      const kid = !!w.parentId && titleOf.has(w.parentId);
      if (kid && wsCollapsedIds.includes(w.parentId) && w.id !== activeId) continue; // 접힌 부모의 하위 세션은 숨긴다(활성이면 보인다)
      const on = w.id === activeId; const ux = w.ux || w.state; const k = stateKey(ux);
      const row = el('div', 'ws' + (on ? ' active' : '') + (w.sub === true ? ' hassub' : '') + (kid ? ' kid' + (lastOf.get(w.parentId) === w.id ? ' last' : '') : '') + (w.flash ? ' flash' : '') + (w.unread ? ' unread' : '')); row.dataset.id = w.id; row.setAttribute('role', 'listitem');
      row.dataset.group = grp.get(w.id) || ''; // 형제 묶음(최상위 '' / 부모 id)
      if (!wsEdit) { row.draggable = true; const gr = el('span', 'ws-grip', '⋮⋮'); gr.setAttribute('aria-hidden', 'true'); row.append(gr); } // 끌 수 있다는 표시(마우스를 올리면 보인다). 이름을 바꾸는 중에는 끌 수 없다
      const kids = kidCount.get(w.id) || 0; const closedKids = kids > 0 && wsCollapsedIds.includes(w.id);
      if (kids > 0) {
        const ch = el('button', 'ws-chev', closedKids ? '▸' : '▾'); ch.type = 'button'; ch.setAttribute('aria-expanded', String(!closedKids));
        ch.setAttribute('aria-label', T(closedKids ? 'ws.expand.aria' : 'ws.collapse.aria', { title: w.title })); ch.title = ch.getAttribute('aria-label');
        ch.addEventListener('click', async () => { try { await window.maru.setWsCollapsed(w.id, !closedKids); } catch (x) { /* 무시 */ } syncWs(); });
        row.append(ch);
      }
      const editing = !!wsEdit && wsEdit.id === w.id;
      const main = el(editing ? 'div' : 'button', 'ws-main' + (editing ? ' editing' : '')); if (!editing) main.type = 'button'; // 편집 중에는 단추가 아니다(입력칸 안의 클릭·스페이스가 작업 공간 전환으로 새지 않는다)
      if (on && !editing) main.setAttribute('aria-current', 'true');
      if (!editing) main.setAttribute('aria-label', T('ws.row.aria', { title: w.title, path: w.path, state: T('agent.' + k) }) + (w.unread ? ' · ' + T('ws.unread.aria') : '') + (w.team && w.team.name ? ' · ' + T('ws.team.aria', { name: w.team.name }) : ''));
      const c = el('span', 'col'); const num = nums.get('workspace:' + w.id);
      const l1 = el('span', 'l1'); const nm = el('span', 'nm');
      if (editing) { const inp = makeWsInput(w, edit); nm.append(inp); wsEdit.input = inp; } else nm.append(el('span', 'n', w.title));
      l1.append(nm); if (w.unread) { const ud = el('span', 'ws-unread'); ud.setAttribute('aria-hidden', 'true'); l1.append(ud); } l1.append(el('span', 'st ' + k, T('agent.' + k)));
      const l2 = el('span', 'l2');
      if (w.rc === 'on') { const rt = el('span', 'ws-rc', T('rc.tag')); rt.setAttribute('aria-label', T('rc.tag.aria')); l2.append(rt); } // 원격 켜짐 표시: 둘째 줄 맨 앞(상태 글자·안 읽은 점·하위 단추·× 자리와 겹치지 않는다)
      l2.append(el('span', 's', w.path)); if (num) l2.append(kbdHint(num));
      c.append(l1, l2);
      const extra = [];
      if (w.project) extra.push(el('span', 'chip', w.project)); // 프로젝트 이름표는 둘째 줄에(제목이 잘리지 않게)
      if (w.team && typeof w.team.name === 'string' && w.team.name) { const tg = el('span', 'chip team', w.team.name); tg.title = T('ws.team.aria', { name: w.team.name }); extra.push(tg); } // 이 하위 세션은 그 팀의 총괄로 돌아간다
      if (w.loc) extra.push(el('span', 'loc', T('ws.loc', { name: w.loc }))); // 훅이 알려 준 현재 위치(다를 때만)
      if (Array.isArray(w.subs) && w.subs.length) extra.push(el('span', 'subs', T('ws.sub', { names: w.subs.join(', ') })));
      if (kid && Number.isFinite(w.reportAt)) extra.push(el('span', 'rep', T('ws.kid.rep', { time: fmtClock(w.reportAt) })));
      if (extra.length) { const l3 = el('span', 'l3'); l3.append(...extra); c.append(l3); }
      const cn = childNoteText(w.cnote);
      if (cn) { const nt = el('span', 'l3 cnote', cn); nt.setAttribute('role', 'status'); c.append(nt); }
      if (num && !editing) main.setAttribute('aria-keyshortcuts', 'Meta+' + num);
      main.append(el('span', 'dot ' + k), c);
      if (!editing) {
        main.title = w.path + (ux === 'unknown' ? ' — ' + T('agent.unknown.sub') : '');
        main.addEventListener('click', async () => { closeDetail(true); try { await window.maru.activateWorkspace(w.id); } catch (x) { /* 무시 */ } syncWs(); });
      }
      row.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); if (!(wsEdit && wsEdit.id === w.id)) openWsMenu(w.id, ev.clientX, ev.clientY); });
      row.append(main);
      if (w.reports > 0) {
        const bd = el('button', 'ws-badge', T('ws.reports', { n: w.reports })); bd.type = 'button'; bd.setAttribute('aria-haspopup', 'dialog'); bd.dataset.id = w.id;
        bd.setAttribute('aria-label', T('ws.reports.aria', { n: w.reports }));
        bd.addEventListener('click', (ev) => { ev.stopPropagation(); if (repOpenId === w.id) closeReports(true); else openReports(w.id, bd); });
        row.append(bd);
      }
      if (w.sub === true) { // 이 마루 작업 공간 아래에 하위 세션을 직접 연다(위 + 는 그대로 새 작업 공간)
        const sb = el('button', 'ws-sub', T('sub.open.btn')); sb.type = 'button'; sb.setAttribute('aria-label', T('sub.open.aria')); sb.title = T('sub.open.aria'); sb.setAttribute('aria-haspopup', 'dialog');
        sb.addEventListener('click', (ev) => { ev.stopPropagation(); openSub(w.id, false); });
        row.append(sb);
      }
      const x = el('button', 'ws-x', '×'); x.type = 'button'; x.setAttribute('aria-label', T('ws.close.aria', { title: w.title }));
      x.addEventListener('click', async () => { try { await window.maru.closeWorkspace(w.id); } catch (e) { /* 무시 */ } syncWs(); });
      row.append(x); box.append(row);
    }
    if (refocus) {
      const r = [...box.children].find((n) => n.dataset.id === refocus.id);
      const t = r && r.querySelector(refocus.x ? '.ws-x' : refocus.s ? '.ws-sub' : refocus.c ? '.ws-chev' : refocus.b ? '.ws-badge' : '.ws-main');
      if (t) t.focus();
    }
    if (wsEdit) { // 새 입력칸에 포커스·선택 범위를 되돌린다. 입력칸이 없으면(행이 숨겨짐) 편집을 접는다
      if (wsEdit.input && wsEdit.input.isConnected) {
        if (edit && edit.focus) { wsEdit.input.focus(); try { wsEdit.input.setSelectionRange(edit.s, edit.e, edit.d || 'none'); } catch (x) { /* 무시 */ } }
        wsEdit.busy = false;
      } else wsEdit = null;
    }
    $('ws-add').disabled = wsList.length >= Lib.WS_MAX;
    $('term-empty').hidden = wsList.length > 0 || detailOpen;
    const a = wsList.find((w) => w.id === activeId);
    $('term-name').textContent = a ? a.title : T('app.title');
    $('term-cwd').textContent = a ? a.path : '';
    renderBusy(a ? a.state : 'none', a ? a.bg : 0, a ? a.ux : null);
    renderRc();
    if (repOpenId) repRefresh();
    if (projHintWs !== wsList.length) renderProjects(projView); // 작업 공간 수가 바뀌면 프로젝트 줄의 번호도 바뀐다
  }
  // ---- 하위 세션 보고 팝오버(읽기 전용): 읽음 표시도, 터미널에 쓰는 것도 하지 않는다. 내용은 textContent 로만 ----
  let repOpenId = null; let repAnchor = null; let repCount = -1;
  function closeReports(refocus) {
    const pop = $('rep-pop'); const id = repOpenId; repOpenId = null; repCount = -1; pop.hidden = true; pop.replaceChildren();
    document.removeEventListener('mousedown', repOutside, true);
    if (refocus && id) { const b = [...document.querySelectorAll('.ws-badge')].find((n) => n.dataset.id === id); if (b) b.focus(); }
  }
  function repOutside(ev) { const pop = $('rep-pop'); if (!pop.contains(ev.target) && !(ev.target.closest && ev.target.closest('.ws-badge'))) closeReports(false); }
  function paintReports(items) {
    const pop = $('rep-pop'); pop.replaceChildren(); pop.setAttribute('aria-label', T('rep.title'));
    const head = el('div', 'rep-head'); head.append(el('h3', 'pop-title', T('rep.title')));
    const x = el('button', 'btn ghost rep-x', T('common.close')); x.type = 'button'; x.addEventListener('click', () => closeReports(true)); head.append(x);
    pop.append(head);
    const list = el('div', 'rep-list');
    if (!items.length) list.append(el('div', 'hint', T('rep.empty')));
    for (const it of items) {
      const row = el('div', 'rep-item');
      const meta = el('div', 'rep-meta');
      meta.append(el('span', 'rep-t', fmtClock(it.at)), el('b', '', it.known === false || !it.title ? T('rep.unknown') : it.title));
      if (it.project) meta.append(el('span', 'chip', it.project));
      if (it.bg > 0) meta.append(el('span', 'hint', T('rep.bg', { n: it.bg })));
      row.append(meta, el('div', 'rep-text' + (it.text ? '' : ' rep-none'), it.text ? String(it.text).slice(0, 2000) : T('rep.empty.text')));
      list.append(row);
    }
    pop.append(list, el('div', 'hint rep-hint', T('rep.hint')));
    return x;
  }
  async function openReports(id, anchor) {
    let r = null; try { r = await window.maru.getReports(id); } catch (x) { r = null; }
    const items = r && Array.isArray(r.items) ? r.items.filter((it) => it && typeof it.text === 'string' && Number.isFinite(it.at)).slice(0, 50) : [];
    const pop = $('rep-pop'); const was = repOpenId;
    repOpenId = id; repAnchor = anchor; repCount = items.length;
    const x = paintReports(items); pop.hidden = false;
    const ar = anchor.getBoundingClientRect(); const pw = pop.offsetWidth;
    pop.style.left = Math.max(8, Math.min(ar.right + 8, window.innerWidth - pw - 8)) + 'px';
    pop.style.top = Math.max(8, Math.min(ar.top, window.innerHeight - pop.offsetHeight - 8)) + 'px';
    if (!was) { document.addEventListener('mousedown', repOutside, true); x.focus(); }
  }
  async function repRefresh() { // 열려 있는 동안 보고 수가 바뀌면 다시 읽는다
    const w = wsList.find((n) => n.id === repOpenId);
    if (!w || !(w.reports > 0)) { closeReports(false); return; }
    if (w.reports !== repCount) { const b = [...document.querySelectorAll('.ws-badge')].find((n) => n.dataset.id === w.id); if (b) openReports(w.id, b); }
  }
  document.addEventListener('keydown', (e) => { if (repOpenId && e.key === 'Escape' && !modalOpen()) { e.preventDefault(); closeReports(true); } });
  // ---- 하위 세션 동의 창: main 이 상태를 가진다(토큰은 한 번만 유효). 폴더·제목·맡길 내용 전체를 textContent 로만 보여 준다 ----
  let consentTok = null;
  let consentAnswering = null; // 답을 main 에 보냈고 아직 돌아오지 않은 토큰
  function syncConsent(v) {
    const dlg = $('dlg-consent');
    if (!v || typeof v.token !== 'string' || typeof v.folder !== 'string' || typeof v.brief !== 'string') { if (consentTok) { consentTok = null; closeModal(dlg); } return; }
    if (consentTok === v.token || consentAnswering === v.token) return; // 방금 답한 토큰은 IPC 가 돌아올 때까지 다시 열지 않는다(main 이 팀 목록을 다시 읽는 사이 ws:changed 가 와도)
    consentTok = v.token;
    $('cs-title').textContent = T('consent.title');
    $('cs-folder-k').textContent = T('consent.folder'); $('cs-folder').textContent = v.folder;
    $('cs-what-k').textContent = T('consent.what'); $('cs-what').textContent = (typeof v.project === 'string' && v.project ? v.project + ' · ' : '') + String(v.title || '');
    $('cs-brief-k').textContent = T('consent.brief'); $('cs-brief').textContent = v.brief; // 자르지 않는다(검증이 이미 4000자로 제한했고 전달하는 것과 같은 문자열)
    $('cs-go').textContent = T(v.paste === true ? 'consent.paste' : 'consent.go');
    $('cs-cancel').textContent = T('consent.cancel'); $('cs-ok').textContent = T('consent.open');
    paintTeams(v);
    $('cs-count').textContent = T('consent.count', { n: Number.isInteger(v.chars) ? v.chars : [...v.brief].length, m: Number.isInteger(v.lines) ? v.lines : v.brief.split('\n').length });
    const box = $('cs-brief'); box.scrollTop = 0;
    $('cs-ok').disabled = true; $('cs-scroll').textContent = '';
    const atEnd = () => box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
    const sync = () => { const ok = atEnd(); $('cs-ok').disabled = !ok; $('cs-scroll').textContent = ok ? '' : T('consent.scroll'); }; // 끝까지 내려야 열 수 있다(스크롤이 필요 없으면 바로)
    box.onscroll = sync;
    openModal(dlg, $('cs-cancel'), { closable: () => true, close: () => answerConsent('cancel') }); // 처음 포커스는 취소(실수로 Enter 를 눌러도 열리지 않는다)
    sync(); // 모달이 보인 뒤에 크기를 잰다
  }
  // 맡을 팀: "팀 없이" + main 이 보낸 설치된 스쿼드(이름은 textContent 로만). 고른 값은 승인과 함께 보내고 main 이 설치된 목록과 다시 대조한다
  let consentSquad = null;
  function paintTeams(v) {
    const box = $('cs-teams'); const row = $('cs-team'); box.replaceChildren();
    const teams = Array.isArray(v.squads) ? v.squads.filter((q) => q && typeof q.slug === 'string' && SQUAD_SLUG.test(q.slug) && typeof q.name === 'string') : [];
    consentSquad = typeof v.squad === 'string' && teams.some((q) => q.slug === v.squad) ? v.squad : null;
    const none = teams.length === 0;
    const asked = typeof v.squadAsked === 'string' && SQUAD_SLUG.test(v.squadAsked);
    // 고를 팀이 없는 경우의 안내는 "다시 골라 주세요" 가 아니라 팀 없이 열린다는 것을 말한다(래퍼를 못 쓰는 환경이면 그 이유로)
    const note = none && v.paste === true && asked ? T('consent.team.nowrapper')
      : none && v.squadChanged === true ? T('consent.team.gone')
      : v.squadMissing === true && asked ? T('consent.team.missing', { slug: v.squadAsked })
      : v.squadChanged === true ? T('consent.team.changed') : '';
    $('cs-team-note').textContent = note;
    row.hidden = none && !note; // 고를 팀이 없어도 안내(요청한 팀이 없다·목록이 바뀌었다)가 있으면 줄은 보인다: 팀 없이 열린다는 것을 알려야 한다
    for (const id of ['cs-team-k', 'cs-teams', 'cs-team-hint']) $(id).hidden = none; // 목록 없이 안내만 보일 때는 제목·목록·설명을 숨긴다
    if (none) { consentSquad = null; return; }
    $('cs-team-k').textContent = T('consent.team'); $('cs-team-hint').textContent = T('consent.team.hint');
    const opts = [{ slug: null, name: T('consent.team.none'), personal: false }, ...teams];
    for (const q of opts) {
      const lab = el('label', 'cs-opt' + (q.slug === consentSquad ? ' on' : ''));
      const r = el('input'); r.type = 'radio'; r.name = 'cs-team'; r.checked = q.slug === consentSquad;
      r.addEventListener('change', () => { consentSquad = q.slug; for (const n of box.children) n.classList.toggle('on', n === lab); });
      lab.append(r, el('span', 'nm', q.name));
      if (q.personal) lab.append(el('span', 'tag', T('squad.personal')));
      if (q.slug !== null && q.slug === v.squad) lab.append(el('span', 'tag sug', T('consent.team.suggested')));
      box.append(lab);
    }
  }
  async function answerConsent(ans) {
    const tok = consentTok; if (!tok) return;
    const sq = ans === 'open' ? consentSquad : null;
    consentTok = null; consentAnswering = tok; closeModal($('dlg-consent'));
    try { await window.maru.answerChildConsent(tok, ans, sq); } catch (x) { /* main 이 만료시킨다 */ }
    consentAnswering = null; // 돌아온 뒤에야 같은 토큰의 창(팀 목록이 바뀌어 다시 고르게 하는 경우)이 다시 열릴 수 있다
    syncWs();
  }
  $('cs-ok').addEventListener('click', () => { if (!$('cs-ok').disabled) answerConsent('open'); });
  $('cs-cancel').addEventListener('click', () => answerConsent('cancel'));
  // ---- 하위 세션 직접 열기: 폴더는 main 의 선택창으로만(렌더러는 표시용 문자열과 한 번 쓰는 토큰만 받는다). 열기는 토큰·제목·내용·팀·알림 여부만 보낸다 ----
  const SB_MAX = 4000;
  let sbParent = null; let sbToken = null; let sbSquad = null; let sbBusy = false;
  function sbCount() { $('sb-count').textContent = T('sub.count', { n: [...$('sb-brief').value].length, m: SB_MAX }); }
  function sbPaintTeams(prep) { // 맡을 팀: 동의 창과 같은 모양(`팀 없이` + 설치된 팀). 적용할 수 없으면 줄을 숨기고 이유만 알린다
    const box = $('sb-teams'); box.replaceChildren(); sbSquad = null;
    const teams = Array.isArray(prep.squads) ? prep.squads.filter((q) => q && typeof q.slug === 'string' && SQUAD_SLUG.test(q.slug) && typeof q.name === 'string') : [];
    const none = teams.length === 0; const note = none && prep.noWrapper === true ? T('sub.noteam') : '';
    $('sb-team-note').textContent = note; $('sb-team').hidden = none && !note;
    for (const id of ['sb-team-k', 'sb-teams', 'sb-team-hint']) $(id).hidden = none;
    if (none) return;
    $('sb-team-k').textContent = T('consent.team'); $('sb-team-hint').textContent = T('consent.team.hint');
    for (const q of [{ slug: null, name: T('consent.team.none'), personal: false }, ...teams]) {
      const lab = el('label', 'cs-opt' + (q.slug === null ? ' on' : ''));
      const r = el('input'); r.type = 'radio'; r.name = 'sb-team'; r.checked = q.slug === null;
      r.addEventListener('change', () => { sbSquad = q.slug; for (const n of box.children) n.classList.toggle('on', n === lab); });
      lab.append(r, el('span', 'nm', q.name));
      if (q.personal) lab.append(el('span', 'tag', T('squad.personal')));
      box.append(lab);
    }
  }
  function sbSetFolder(display) { // display: main 이 만든 표시용 문자열(홈은 ~). 경로로 쓰지 않는다
    sbToken = display ? sbToken : null;
    $('sb-path').textContent = display || '';
    const base = display ? display.split('/').filter(Boolean).pop() : ''; $('sb-name').placeholder = base || '';
  }
  function closeSubDialog() { closeModal($('dlg-sub')); }
  function focusSubButton(parentId) { // 닫은 뒤(목록을 다시 그린 뒤) 그 부모 줄의 하위 세션 버튼으로, 줄이 없으면 터미널로
    if (modalOpen()) return;
    const row = [...$('workspaces').children].find((n) => n.dataset && n.dataset.id === parentId); const b = row && row.querySelector('.ws-sub');
    if (b) b.focus(); else focusTerm();
  }
  function sbParentGone() { // 대화상자가 열린 사이 부모 작업 공간이 사라지면 닫는다
    if (!sbParent || $('dlg-sub').hidden || sbBusy) return;
    if (!wsList.some((w) => w.id === sbParent)) { closeSubDialog(); sbParent = null; sbToken = null; focusTerm(); }
  }
  function sbError(reason) {
    const known = ['invalid', 'title', 'brief', 'dir', 'maru', 'expired', 'parent', 'children-max', 'ws-max', 'rate', 'budget', 'start', 'squad', 'busy'];
    $('sb-err').textContent = T('sub.err.' + (known.includes(reason) ? reason : 'fail'), { n: Lib.CHILD_MAX });
  }
  async function openSub(parentId, auto) {
    if (modalOpen() || sbBusy || typeof parentId !== 'string') return;
    let prep = null; try { prep = await window.maru.subPrepare(parentId); } catch (x) { prep = null; }
    if (!prep || !prep.ok || modalOpen()) { if (!prep || !prep.ok) flashNote(T('sub.err.parent')); return; }
    sbParent = parentId; sbToken = null; sbBusy = false;
    $('sb-title').textContent = T('sub.title'); $('sb-under').textContent = T('sub.under', { title: String(prep.title || '') });
    $('sb-folder-k').textContent = T('sub.folder'); $('sb-pick').textContent = T('sub.folder.pick'); $('sb-folder-hint').textContent = T('sub.folder.hint');
    $('sb-path').dataset.empty = T('sub.folder.none');
    $('sb-name-k').textContent = T('sub.name'); $('sb-name-hint').textContent = T('sub.name.hint');
    $('sb-brief-k').textContent = T('sub.brief'); $('sb-brief-hint').textContent = T('sub.brief.hint');
    $('sb-notify-k').textContent = T('sub.notify'); $('sb-notify-hint').textContent = T('sub.notify.hint');
    $('sb-ok').textContent = T('sub.ok'); $('sb-ok').disabled = false; $('sb-pick').disabled = false;
    $('sb-name').value = ''; $('sb-brief').value = ''; $('sb-notify').checked = true; $('sb-err').textContent = '';
    sbSetFolder(''); sbCount(); sbPaintTeams(prep);
    openModal($('dlg-sub'), $('sb-pick'), { closable: () => !sbBusy });
    if (auto) pickSubFolder(); // 시험 전용(MARU_APP_UI=subnew): main 이 지어낸 폴더를 이미 고른 것으로 돌려준다
  }
  async function pickSubFolder() {
    if (sbBusy) return;
    sbBusy = true; $('sb-pick').disabled = true; $('sb-err').textContent = '';
    let r = null; try { r = await window.maru.subPickFolder(sbParent); } catch (x) { r = null; }
    sbBusy = false; $('sb-pick').disabled = false;
    if (r && r.ok && typeof r.token === 'string' && typeof r.display === 'string') { sbToken = r.token; sbSetFolder(r.display); }
    else if (!r || r.reason !== 'cancel') sbError(r && typeof r.reason === 'string' ? r.reason : 'fail');
    $('sb-pick').focus();
  }
  async function submitSub() {
    if (sbBusy) return;
    if (!sbToken) { $('sb-err').textContent = T('sub.err.nofolder'); $('sb-pick').focus(); return; }
    sbBusy = true; $('sb-ok').disabled = true; $('sb-err').textContent = '';
    let res = null;
    try { res = await window.maru.subOpen({ parent: sbParent, token: sbToken, title: $('sb-name').value, brief: $('sb-brief').value, squad: sbSquad, notify: $('sb-notify').checked }); } catch (x) { res = null; }
    sbBusy = false; $('sb-ok').disabled = false;
    if (res && res.ok) { closeSubDialog(); await syncWs(); focusSubButton(sbParent); return; }
    const reason = res && typeof res.reason === 'string' ? res.reason : 'fail';
    if (reason === 'expired' || reason === 'dir' || reason === 'maru' || reason === 'invalid') { sbToken = null; sbSetFolder(''); sbError(reason); $('sb-pick').focus(); return; } // 폴더 선택이 만료됐거나 쓸 수 없다: 다시 고르게 한다
    if (reason === 'squad') { let prep = null; try { prep = await window.maru.subPrepare(sbParent); } catch (x) { prep = null; } if (prep && prep.ok) sbPaintTeams(prep); }
    sbError(reason);
  }
  $('sb-pick').addEventListener('click', pickSubFolder);
  $('sb-ok').addEventListener('click', submitSub);
  $('sb-cancel').addEventListener('click', () => { if (!sbBusy) { const id = sbParent; closeSubDialog(); focusSubButton(id); } });
  $('sb-brief').addEventListener('input', sbCount);
  $('sb-brief').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submitSub(); } }); // Enter 는 줄바꿈, 제출은 Cmd/Ctrl+Enter
  window.maru.onOpenSub((id) => { if (!modalOpen()) openSub(id, false); }); // 앱 메뉴 "하위 세션 열기…"
  // ---- 스쿼드 만들기: 글을 받아 main 에 넘기면 main 이 정리·검사해 마루 입력줄에 채운다(파일은 쓰지 않는다). Enter 는 사용자가 누른다 ----
  let snBusy = false;
  const SN_MAX = 300;
  function snCount() { const n = [...$('sn-text').value].length; $('sn-count').textContent = T('squadnew.count', { n, m: SN_MAX }); }
  function openSquadNew() {
    snBusy = false;
    $('sn-title').textContent = T('squadnew.title'); $('sn-label').textContent = T('squadnew.label'); $('sn-hint').textContent = T('squadnew.hint'); $('sn-ok').textContent = T('squadnew.ok');
    $('sn-text').value = ''; $('sn-err').textContent = ''; $('sn-ok').disabled = false; snCount();
    const chips = $('sn-chips'); chips.replaceChildren(); chips.setAttribute('aria-label', T('squadnew.ex.aria'));
    for (const k of ['squadnew.ex1', 'squadnew.ex2', 'squadnew.ex3']) {
      const c = el('button', 'sn-chip', T(k)); c.type = 'button';
      c.addEventListener('click', () => { $('sn-text').value = T(k); snCount(); $('sn-err').textContent = ''; $('sn-text').focus(); });
      chips.append(c);
    }
    openModal($('dlg-squadnew'), $('sn-text'), { closable: () => !snBusy });
  }
  async function submitSquadNew() {
    if (snBusy) return;
    const text = $('sn-text').value;
    if (![...text.trim()].length) { $('sn-err').textContent = T('squadnew.err.invalid'); $('sn-text').focus(); return; }
    snBusy = true; $('sn-ok').disabled = true; $('sn-err').textContent = '';
    let res = null; try { res = await window.maru.requestSquadCreate(text); } catch (x) { res = null; }
    snBusy = false; $('sn-ok').disabled = false;
    if (res && res.ok) { closeModal($('dlg-squadnew')); await syncWs(); focusTerm(); flashNote(T('squadnew.note.ok')); return; } // 닫으면 모달 앞의 포커스로 돌아가므로 그 뒤에 터미널로 옮긴다
    const reason = res && typeof res.reason === 'string' ? res.reason : 'fail';
    $('sn-err').textContent = T(['invalid', 'no-maru', 'not-ready', 'agent-busy', 'busy'].includes(reason) ? 'squadnew.err.' + reason : reason === 'no-term' || reason === 'shell' ? 'squadnew.err.not-ready' : 'squadnew.err.fail');
  }
  $('squad-add').addEventListener('click', openSquadNew);
  $('sn-ok').addEventListener('click', submitSquadNew);
  $('sn-cancel').addEventListener('click', () => { if (!snBusy) closeModal($('dlg-squadnew')); });
  $('sn-text').addEventListener('input', snCount);
  $('sn-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submitSquadNew(); } }); // Enter 는 줄바꿈(어차피 공백으로 바뀐다), 제출은 Cmd/Ctrl+Enter
  async function newWs() { try { await window.maru.newWorkspace(); } catch (x) { /* 무시 */ } syncWs(); }
  $('ws-add').addEventListener('click', newWs);
  $('term-empty-new').addEventListener('click', newWs);
  $('workspaces').addEventListener('keydown', (e) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.altKey || e.defaultPrevented) return; // ⌥↑/⌥↓ 는 순서 변경이 처리한다
    const items = [...$('workspaces').querySelectorAll('.ws-main')]; const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  });
  window.maru.onWorkspacesChanged(() => syncWs());
  // ⌘W: 열린 모달·메뉴·팝오버가 있으면 그것을 닫고, 아니면 활성 작업 공간을 닫는다(확인은 main)
  window.maru.onCloseRequest(async () => {
    const act = Lib.closeRequestAction({ overlayOpen: modalOpen() || !!wsMenu || !!wsEdit || menuOpen || updOpen || detailOpen || !!repOpenId, hasActive: !!activeId });
    if (act === 'overlay') {
      if (modalOpen()) { const top = modals[modals.length - 1]; if (top.closable()) top.close(); }
      else if (wsMenu) closeWsMenu(true);
      else if (wsEdit) endWsEdit(false, true);
      else if (repOpenId) closeReports(true);
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

  // ---- 원격 제어 토글(터미널 위 막대): 상태는 main 이 정한 w.rc 를 그대로 그린다. 눌러도 main 이 문장을 보내고 확인된 증거가 올 때까지 표시가 바뀌지 않는다 ----
  const RC_STATES = ['off', 'on', 'turning-on', 'turning-off', 'unknown'];
  function renderRc() {
    applyReadLayout(); // 상세 화면이 열리고 닫힐 때와 활성 작업 공간이 바뀔 때마다 여기를 지나므로, 읽기 배치도 같이 맞춘다
    const b = $('rc-toggle'); if (!b) return;
    const a = wsList.find((w) => w.id === activeId);
    b.hidden = !a || detailOpen; // 활성 작업 공간이 없거나 상세 화면이 터미널을 가리면 숨긴다
    if (b.hidden) return;
    const st = RC_STATES.includes(a.rc) ? a.rc : 'off';
    b.dataset.rc = st; b.setAttribute('aria-checked', String(st === 'on' || st === 'turning-on'));
    b.querySelector('.rc-label').textContent = T('rc.label.' + st);
    b.title = T('rc.title'); b.setAttribute('aria-description', T('rc.title'));
    b.disabled = a.cc !== true || a.state === 'exited'; // Claude 화면이 아니거나 끝난 세션이면 숨기지 않고 끈다
  }
  const rcErrKey = (r) => 'rc.err.' + (['no-session', 'shell', 'not-ready', 'waiting', 'busy', 'unknown', 'draft', 'pending', 'inactive', 'busy-ui'].includes(r) ? r : 'invalid');
  async function rcClick() {
    const b = $('rc-toggle'); if (!activeId || b.disabled) return;
    if (modalOpen() || detailOpen) { note(T('rc.err.busy-ui')); return; }
    let res = null;
    try { res = await window.maru.rcToggle(activeId); } catch (x) { res = null; }
    if (!res || !res.ok) note(T(rcErrKey(res && res.reason)));
    else { syncWs(); focusTerm(); } // 성공: 터미널로 포커스를 돌려 사용자가 곧바로 Claude 의 확인 질문에 답할 수 있게 한다
  }
  $('rc-toggle').addEventListener('click', rcClick);
  window.maru.onRcToggle(() => { rcClick(); }); // 앱 메뉴도 같은 처리

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
  // ---- 할 일 -> 원래 세션으로 이동해 입력줄에 채우기(출처가 있는 항목). 렌더러는 항목의 정체(index + shown)만 보낸다 ----
  const srcHint = (h) => { const days = Math.max(0, Math.floor((Date.now() / 1000 - h.at) / 86400)); return days < 1 ? T('todo.src.today', { folder: h.folder }) : T('todo.src.days', { folder: h.folder, n: days }); };
  const validSrcHint = (h) => !!h && typeof h.folder === 'string' && h.folder.length > 0 && h.folder.length <= 80 && Number.isFinite(h.at);
  let openingTodo = false;
  function openNote(box, nodes, ms) {
    clearTimeout(noteTimer); clearTimeout(projNoteTimer);
    box.replaceChildren(...nodes);
    noteTimer = setTimeout(() => { if (box.isConnected) box.replaceChildren(); }, ms);
  }
  function noteButton(label, fn) { const b = el('button', 'note-undo', label); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function showOpenResult(box, res, idx, shown, isDetail) {
    if (res && !res.ok && res.reason === 'cancel') { box.replaceChildren(); return; } // 사용자가 확인 창에서 취소: 아무 일도 없다
    if (!res || !res.ok) { openNote(box, [el('span', '', T(Lib.openNoticeKey(res && res.reason)))], 6000); return; }
    const nodes = [];
    if (res.mode === 'choose') { // 오래된 세션: 어디에도 채우지 않고 사용자가 고른 곳에만 채운다
      nodes.push(el('span', '', T('todo.open.too-old')), document.createTextNode(' '));
      nodes.push(noteButton(T('todo.open.choose.new'), () => openTodoSession(idx, shown, box, false, 'new')), document.createTextNode(' · '));
      nodes.push(noteButton(T('todo.open.choose.orig'), () => openTodoSession(idx, shown, box, false, 'original')));
      openNote(box, nodes, 30000); return;
    }
    if (res.filled === false) {
      if (res.reason === 'agent-busy') nodes.push(el('span', '', T('todo.open.agent-busy')));
      else if (typeof res.token === 'string') {
        const clip = [...String(res.text || '')].slice(0, 120).join('');
        nodes.push(el('span', '', T(res.reason === 'inactive' ? 'todo.open.inactive' : 'todo.open.timeout', { text: clip })), document.createTextNode(' '));
        nodes.push(noteButton(T('todo.open.retry'), async () => {
          let r = null; try { r = await window.maru.retryTodoFill(res.token); } catch (x) { r = null; }
          if (r && r.ok && r.filled) { box.replaceChildren(); focusTerm(); return; }
          openNote(box, [el('span', '', r && r.ok && r.reason === 'agent-busy' ? T('todo.open.agent-busy') : T(Lib.fillNoticeKey(r && r.reason)))], 6000);
        }));
      } else nodes.push(el('span', '', T(Lib.openNoticeKey(res.reason))));
    } else if (typeof res.fallback === 'string') nodes.push(el('span', '', T(Lib.openNoticeKey(res.fallback))));
    openNote(box, nodes, nodes.length > 1 ? 12000 : 6000);
  }
  async function openTodoSession(idx, shown, box, isDetail, choice) {
    if (openingTodo) return;
    openingTodo = true;
    openNote(box, [el('span', '', T('todo.open.working'))], 25000);
    let res = null;
    try { res = await window.maru.openTodo(idx, shown, choice || null); } catch (x) { res = null; } finally { openingTodo = false; }
    const target = isDetail && res && res.ok ? $('quest-note') : box; // 상세 화면은 닫고 터미널로 돌아가므로 안내는 메인 패널에
    if (isDetail && res && res.ok) { box.replaceChildren(); closeDetail(false); }
    showOpenResult(target, res, idx, shown, false);
    focusTerm();
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
      const hasSrc = canFill && validSrcHint(it.src);
      const body = el('span', 'body'); body.append(el('span', 't', it.title));
      if (canFill) { const pe = el('span', 'p', it.prompt); pe.title = it.prompt; body.append(pe); }
      if (hasSrc) { const se = el('span', 'p src', srcHint(it.src)); se.title = T('todo.src.aria', { folder: it.src.folder }); body.append(se); } // 어디로 가는지(폴더·며칠 전)
      const imp = el('span', 'imp');
      if (Lib.todoStarred(it.importance)) { imp.textContent = '★'; imp.title = T('todo.imp'); imp.setAttribute('aria-label', imp.title); }
      b.append(imp, body);
      if (!canFill) b.append(el('span', 'own', T('todo.own')));
      if (canFill) b.addEventListener('click', async () => {
        closeDetail(false); // 상세가 열려 있으면 터미널로 돌아간 뒤 채운다
        if (hasSrc) { await openTodoSession(i, Lib.todoKey(it), $('quest-note'), false, null); return; } // 출처 세션이 있으면 그리로(없거나 열 수 없으면 main 이 지금처럼 마루 세션에 채운다)
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
    if (detailOpen && detailMode === 'day') fetchDay(false);
    refreshCal();

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
    if (['stale', 'no-prompt', 'unsafe-start', 'not-ready', 'no-term', 'inactive', 'shell'].includes(r)) return T(Lib.fillNoticeKey(r));
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
    detailMode = 'inbox'; detailOpen = true; detailKey = null; detail = null; detailSig = ''; detailSeq++; dayKey = null; daySeq++;
    inboxDet = { kind, slug, loading: true }; const my = ++inboxDetSeq;
    renderRc(); $('terminal').hidden = true; $('term-empty').hidden = true; $('proj-detail').hidden = true; $('inbox-detail').hidden = false; $('day-view').hidden = true; if (memView) memView.hide();
    $('id-note').textContent = '';
    if (lastPanels) renderProjects(lastPanels.projects);
    renderCal(); // 고른 날 강조·aria-pressed 를 바로 지운다
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
  let projView = { open: [], done: [], doneCount: 0, unsorted: [], collapsed: [] };
  let doneOpen = false; // "완료" 목록 펼침은 저장하지 않는다(카테고리 접힘은 main 이 data/project-ui.json 에 저장)
  let unsortedOpen = false; // "분류 안 된 작업" 펼침도 저장하지 않는다
  let dragState = null; let pendingPv = null; let projHintWs = -1; let projNoteTimer = null;
  const DRAG_TYPE = 'application/x-maru-reorder'; // 파일 drop('Files')과 섞이지 않게 자체 타입만 쓴다
  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  function projTitle(it) { return it.kind === 'unclassified' ? it.tag : it.title; } // 분류 안 된 줄의 이름은 태그
  // ⌘숫자 힌트: main 메뉴와 같은 Lib.numberTargets 로 센다(작업 공간 먼저, 이어서 접히지 않은 진행 중 프로젝트 줄). 'kind:id' -> 번호
  function numberMap() {
    const m = new Map();
    Lib.numberTargets(Lib.visibleWsIds(Lib.hierarchyOrder(wsList), wsCollapsedIds, activeId), Lib.visibleProjectKeys(projView.open, projView.collapsed)).forEach((t, i) => m.set(t.kind + ':' + t.id, i + 1));
    return m;
  }
  function kbdHint(n) { const k = el('span', 'kbd', '⌘' + n); k.setAttribute('aria-hidden', 'true'); return k; }
  function projNote(msg) {
    const n = $('proj-note'); n.textContent = msg;
    clearTimeout(projNoteTimer); projNoteTimer = setTimeout(() => { n.textContent = ''; }, 4000);
  }
  function projRow(it, num, canDrag, showTag) {
    const b = el('button', 'proj' + (it.key === detailKey ? ' on' : '')); b.type = 'button'; b.dataset.key = it.key; b.dataset.tag = it.tag;
    const name = projTitle(it);
    let cnt;
    if (it.status === 'done') cnt = el('span', 'cnt', showTag ? it.tag + (it.doneAt ? ' · ' + it.doneAt.slice(5) : '') : (it.doneAt || '')); // 완료 목록은 카테고리 묶음 없이 한 줄씩: 어느 카테고리였는지와 끝낸 날(월-일)만 작게 붙인다
    else if (it.needsCheck) cnt = el('span', 'cnt check', T('proj.check'));
    else cnt = el('span', 'cnt', T('proj.todos', { n: it.openTodos }));
    const pr = el('span', 'pr'); pr.append(cnt); if (num) pr.append(kbdHint(num));
    if (canDrag && it.kind === 'project') { const gr = el('span', 'grip', '⋮⋮'); gr.setAttribute('aria-hidden', 'true'); b.append(gr); } // 끌 수 있다는 표시(마우스를 올리면 보인다)
    b.append(el('span', 'pt', name), pr);
    b.title = canDrag && it.kind === 'project' ? name + '\n' + T('proj.row.tip') : showTag && it.doneAt ? name + '\n' + it.tag + ' · ' + it.doneAt : name;
    if (it.key === detailKey) b.setAttribute('aria-current', 'true');
    b.setAttribute('aria-label', T('proj.row.aria', { title: name, state: showTag ? it.tag + ' · ' + (it.doneAt || '') : cnt.textContent }));
    if (num) b.setAttribute('aria-keyshortcuts', 'Meta+' + num);
    if (canDrag && it.kind === 'project') { b.draggable = true; b.dataset.drag = 'proj'; } // 분류 안 된 작업 줄은 끌 수 없다
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
    projView = pv && Array.isArray(pv.open) && Array.isArray(pv.done) ? { unsorted: [], ...pv } : { open: [], done: [], doneCount: 0, unsorted: [], collapsed: [] };
    projHintWs = wsList.length;
    const card = $('proj-card'); const f = document.activeElement;
    const refocus = f && card.contains(f) ? (f.dataset.cat ? 'c:' + f.dataset.sec + ':' + f.dataset.cat : f.dataset.key ? 'k:' + f.dataset.key : f.id === 'proj-done-toggle' ? 't' : f.id === 'proj-unsorted-toggle' ? 'u' : null) : null;
    const nums = numberMap();
    const box = $('projects'); box.replaceChildren();
    if (!projView.open.length) box.append(el('div', 'empty', T('proj.empty')));
    fillGroups(box, projView.open, 'open', nums);
    const un = Array.isArray(projView.unsorted) ? projView.unsorted : [];
    const ut = $('proj-unsorted-toggle'); ut.hidden = un.length === 0; ut.textContent = T('proj.unsorted.toggle', { n: un.length });
    ut.setAttribute('aria-label', T('proj.unsorted.toggle', { n: un.length }) + ' — ' + T('proj.unsorted.aria'));
    ut.setAttribute('aria-expanded', String(unsortedOpen && un.length > 0));
    const ub = $('projects-unsorted'); ub.replaceChildren(); ub.hidden = !unsortedOpen || un.length === 0;
    if (!ub.hidden) for (const it of un) ub.append(projRow(it, 0, false)); // 번호·끌기 없음
    const n = projView.doneCount | 0;
    const tg = $('proj-done-toggle'); tg.hidden = n === 0; tg.textContent = T('proj.done.toggle', { n });
    tg.setAttribute('aria-label', T('proj.done.toggle', { n }) + ' — ' + T('proj.done.aria'));
    tg.setAttribute('aria-expanded', String(doneOpen && n > 0));
    const done = $('projects-done'); done.replaceChildren(); done.hidden = !doneOpen || n === 0;
    if (!done.hidden) { // 진행 중 목록과 같은 카테고리 이름표를 또 그리면 카테고리가 둘로 나뉜 것처럼 보인다. 완료는 묶지 않고 끝낸 날짜순으로 한 줄씩
      const flat = projView.done.flatMap((g) => g.items).sort((a, b) => ((a.doneAt || '') < (b.doneAt || '') ? 1 : (a.doneAt || '') > (b.doneAt || '') ? -1 : 0));
      for (const it of flat) done.append(projRow(it, 0, false, true));
    }
    if (refocus) {
      let t = null;
      if (refocus === 't') t = tg;
      else if (refocus === 'u') t = ut;
      else if (refocus.startsWith('c:')) t = [...card.querySelectorAll('.proj-cat')].find((x) => 'c:' + x.dataset.sec + ':' + x.dataset.cat === refocus);
      else t = [...card.querySelectorAll('.proj')].find((x) => 'k:' + x.dataset.key === refocus);
      if (t && !t.hidden) t.focus();
    }
  }
  $('proj-unsorted-toggle').addEventListener('click', () => { unsortedOpen = !unsortedOpen; if (lastPanels) renderProjects(lastPanels.projects); $('proj-unsorted-toggle').focus(); });
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
      const ps = g ? g.items : [];
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
    const r = row.getBoundingClientRect(); const after = e.clientY >= r.top + r.height / 2;
    let beforeId = row.dataset.key;
    if (after) { let s = row.nextElementSibling; while (s && s.dataset.key === dragState.id) s = s.nextElementSibling; beforeId = s ? s.dataset.key : null; }
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
  // 키보드 대안: 포커스된 카테고리·프로젝트 줄에서 ⌥↑/⌥↓ 로 한 칸 이동
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
      ids = g ? g.items.map((it) => it.key) : [];
    }
    const i = ids.indexOf(id); if (i < 0) return;
    const up = e.key === 'ArrowUp';
    if (up ? i === 0 : i === ids.length - 1) return;
    const before = up ? ids[i - 1] : (ids[i + 2] === undefined ? null : ids[i + 2]);
    doReorder(kind, id, before);
  });

  function openDetail(key) {
    detailMode = 'project'; inboxDet = null; inboxDetSeq++; $('inbox-detail').hidden = true; $('day-view').hidden = true; dayKey = null; daySeq++; if (memView) memView.hide();
    detailKey = key; detailOpen = true; detail = null; detailSig = '';
    renderRc(); $('terminal').hidden = true; $('term-empty').hidden = true; $('proj-detail').hidden = false;
    $('pd-note').textContent = '';
    if (lastPanels) renderProjects(lastPanels.projects);
    renderCal();
    fetchDetail(true);
  }
  // 시험 전용: 첫 프로젝트(없으면 첫 '분류 안 됨')의 상세를 연다
  function openFirstProject() {
    const all = projView.open.flatMap((g) => g.items);
    const it = all[0] || (projView.unsorted || [])[0];
    if (it) openDetail(it.key);
  }
  function closeDetail(refocus) {
    if (!detailOpen) return;
    detailOpen = false; detailKey = null; detail = null; detailSig = ''; detailSeq++; inboxDet = null; inboxDetSeq++; dayKey = null; daySeq++;
    $('proj-detail').hidden = true; $('inbox-detail').hidden = true; $('day-view').hidden = true; if (memView) memView.hide(); $('terminal').hidden = false; $('term-empty').hidden = wsList.length > 0; renderRc();
    if (lastPanels) renderProjects(lastPanels.projects);
    renderCal();
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
    $('pd-title').textContent = d.kind === 'unclassified' ? T('proj.unsorted.title', { tag: d.tag }) : d.title;
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
      if (t.canOpen === true && Number.isInteger(t.idx) && typeof t.shown === 'string') { // 눌러서 원래 세션으로(출처가 없으면 마루 세션에 채운다)
        const ob = el('button', 'pd-todo-t pd-todo-open', t.title); ob.type = 'button';
        if (validSrcHint(t.src)) ob.title = T('todo.src.aria', { folder: t.src.folder });
        ob.addEventListener('click', () => openTodoSession(t.idx, t.shown, $('pd-note'), true, null));
        r.append(imp, ob);
        if (validSrcHint(t.src)) r.append(el('span', 'pd-src', srcHint(t.src)));
      } else r.append(imp, el('span', 'pd-todo-t', t.title));
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
    for (const m of d.memories) { const dm = Lib.memoryDisplay(m, lang); const c = el('span', 'chip', dm.title); if (dm.description) c.title = dm.description; mm.append(c); } // 화면 언어의 제목(없으면 slug)
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
  function renderBusy(agent, bg, ux) {
    lastAgent = agent; renderParty();
    const core = document.querySelector('.core');
    const k = stateKey(agent);
    core.classList.toggle('idle', agent !== 'busy' && agent !== 'waiting');
    core.classList.toggle('still', k === 'exited' || k === 'pending' || k === 'unavailable');
    ringMode = k; kickRing();
    core.classList.toggle('waiting', agent === 'waiting');
    const sx = Lib.agentStatusText(k, bg);
    const known = ux === 'unknown' || ux === 'turnEnded'; // 훅이 없는 폴더: 대기인 척하지 않는다
    $('status-main').textContent = known ? T('agent.' + ux) : T(sx.key, sx.params);
    $('status-sub').textContent = known ? T('agent.' + ux + '.sub') : T('agent.' + k + '.sub');
    $('core').setAttribute('aria-label', T('core.aria', { s: T(sx.key, sx.params) }));
  }

  // 하단 플랜 사용량 띠: 렌더되는 값(문구·퍼센트·단계)이 바뀔 때만 DOM 을 건드린다
  let usageData = null, usageKey = null;
  function renderUsage() {
    const v = usageData ? Lib.usageView(usageData, Date.now()) : null;
    const age = v ? Lib.fmtUsageAge(v.ageMs) : null;
    const rows = v ? v.windows.map((w) => ({ w, r: Lib.fmtUsageReset(w) })) : [];
    const key = v ? lang + '|' + JSON.stringify(rows.map(({ w, r }) => [w.key, w.pct, w.level, r.key, r.params.n])) + '|' + age.key + (age.params.n || '') : '';
    if (key === usageKey) return;
    usageKey = key;
    $('usage').hidden = !v;
    if (!v) return;
    for (const [k, id, nk] of [['five_hour', 'five', 'usage.five'], ['seven_day', 'week', 'usage.week']]) {
      const row = rows.find((x) => x.w.key === k);
      $('u-' + id).hidden = !row;
      if (!row) continue;
      const { w, r } = row;
      const bar = $('u-' + id + '-bar');
      bar.setAttribute('aria-valuenow', String(w.pct));
      bar.setAttribute('aria-label', T('usage.meter.aria', { name: T(nk) }));
      bar.setAttribute('aria-valuetext', w.pct + '%');
      $('u-' + id + '-fill').style.width = w.pct + '%';
      $('u-' + id + '-fill').className = 'u-fill' + (w.level === 'ok' ? '' : ' lv-' + w.level);
      $('u-' + id + '-pct').textContent = w.pct + '%';
      $('u-' + id + '-pct').className = 'u-pct' + (w.level === 'ok' ? '' : ' lv-' + w.level);
      $('u-' + id + '-reset').textContent = T(r.key, r.params);
    }
    $('u-age').textContent = T(age.key, age.params);
  }

  let lastKey = null;
  async function poll() {
    readTick(); // 읽기 화면이 켜진 활성 작업 공간만 대화를 받는다(끝을 기다리지 않는다)
    try {
      const p = await window.maru.getPanels();
      if (p) {
        const { usage: pu, ...rest } = p; // usage 는 at 이 자주 바뀌므로 정적 렌더 키에서 뺀다(renderUsage 가 자기 키로 거른다)
        const key = JSON.stringify(rest);
        usageData = p.usage || null; renderUsage();
        if (key !== lastKey) { lastKey = key; renderStatic(p); window.maru.notifyRendered(); }
      }
    } catch (e) { /* 다음 주기에 재시도 */ }
  }

  // ---- 언어 전환(즉시, 저장은 프로필이 있을 때만) ----
  function relabel() {
    applyStatic();
    if (lastPanels) renderStatic(lastPanels);
    wsKey = null; renderWs();
    if (readCurOn) { readRender(); renderReadStatus(); } // 읽기 화면의 안내 문구도 새 언어로
    if (detailOpen && detailMode === 'project' && detail) renderDetail(false);
    if (detailOpen && detailMode === 'inbox' && inboxDet) renderInboxDetail(false);
    if (memView) memView.relabel();
    renderCal(); if (detailOpen && detailMode === 'day' && dayData) renderDay(false);
    if (setRows) renderSettings();
    if (su.open) renderSetup(false);
    if (homeNotice) $('home-warn').textContent = T('home.warn.' + homeNotice);
    if (!$('pop-update').hidden) renderUpdate();
    renderLangSeg();
    usageKey = null; renderUsage();
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
          cb.disabled = true; const want = cb.checked;
          try { await (r.toggle.kind === 'resume' ? window.maru.setResume(want) : window.maru.setCalendar(want)); } catch (e) { /* 다시 읽기에서 반영 */ }
          if (r.toggle.kind !== 'resume' && !want) forgetDayEvents(); // 끄는 즉시 펼친 일정 제목과 받아 둔 상세를 잊는다
          if (r.toggle.kind !== 'resume') { refreshCal(); if (detailOpen && detailMode === 'day') fetchDay(false); } // 끄면 일정 제목·점이 5초 폴링을 기다리지 않고 바로 사라진다
          setLoading = false; loadSettings(false);
        });
        lab.append(cb, el('span', '', T(r.toggle.kind === 'resume' ? 'resume.toggle' : 'cal.toggle'))); right.append(lab);
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
  const canDrop = () => !!activeId && !modalOpen() && !detailOpen && !readTermFolded; // 접힌 띠에는 놓지 않는다(보이지 않는 터미널에 경로가 들어가면 안 된다)
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
    if (readTermFolded) { note(T('read.drop.folded')); return; }
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

  // ---- ⌘⇧↑/↓: 왼쪽 패널의 위·아래 대상으로(작업 공간 끝에서 아래는 첫 프로젝트로, 첫 프로젝트에서 위는 마지막 작업 공간으로). 맨 처음·맨 끝에서는 멈춘다 ----
  document.addEventListener('keydown', (e) => {
    if (!Lib.isStepKey(e) || modalOpen()) return;
    const t = e.target;
    if (t && t.closest && !t.closest('.xterm') && ((t.tagName === 'INPUT' && /^(text|search|url|email|password|number|tel|)$/.test(t.type || '')) || t.tagName === 'TEXTAREA' || t.isContentEditable)) return; // 글자 입력칸에서는 원래 뜻(처음·끝까지 선택)을 둔다
    e.preventDefault(); e.stopPropagation();
    if (!stepReady) return; // 앞 이동(작업 공간 전환)이 끝난 뒤에만 다음으로
    const targets = Lib.numberTargets(Lib.visibleWsIds(Lib.hierarchyOrder(wsList), wsCollapsedIds, activeId), Lib.visibleProjectKeys(projView.open, projView.collapsed), Infinity);
    const wsCur = activeId ? { kind: 'workspace', id: activeId } : null;
    const pjCur = detailOpen && detailMode === 'project' && detailKey ? { kind: 'project', id: detailKey } : null;
    const cur = pjCur && targets.some((x) => x.kind === 'project' && x.id === pjCur.id) ? pjCur : wsCur; // 목록에 없는 프로젝트(접힌 묶음·분류 안 됨)를 보고 있으면 활성 작업 공간을 기준으로
    const to = Lib.stepTarget(targets, cur, e.key === 'ArrowUp' ? -1 : 1);
    if (!to) return;
    closeWsMenu(false); closeMenu(false); closeUpdate(false);
    if (to.kind === 'project') { openDetail(to.id); focusTerm(); return; }
    stepReady = false;
    (async () => { try { closeDetail(true); if (to.id !== activeId) { await window.maru.activateWorkspace(to.id); await syncWs(); } focusTerm(); } catch (x) { /* 무시 */ } finally { stepReady = true; } })();
  }, true);

  // ---- ⌘⇧←/→: 지금 보고 있는 대상의 묶음을 접기 / 펼치기(프로젝트 상세를 보고 있으면 그 카테고리, 아니면 활성 작업 공간의 하위 세션 묶음) ----
  document.addEventListener('keydown', (e) => {
    if (!Lib.isFoldKey(e) || modalOpen()) return;
    const t = e.target;
    if (t && t.closest && !t.closest('.xterm') && ((t.tagName === 'INPUT' && /^(text|search|url|email|password|number|tel|)$/.test(t.type || '')) || t.tagName === 'TEXTAREA' || t.isContentEditable)) return; // 글자 입력칸에서는 원래 뜻(줄 처음·끝까지 선택)을 둔다
    e.preventDefault(); e.stopPropagation();
    if (e.repeat || foldBusy) return;
    const f = Lib.foldTarget({ ws: wsList, wsCollapsed: wsCollapsedIds, activeId, project: detailOpen && detailMode === 'project' ? detailKey : null, groups: projView.open, catCollapsed: projView.collapsed }, e.key === 'ArrowRight');
    if (!f) return;
    foldBusy = true;
    (async () => { try { if (f.kind === 'category') await toggleCat(f.tag, f.closed); else { await window.maru.setWsCollapsed(f.id, f.closed); await syncWs(); } } catch (x) { /* 무시 */ } finally { foldBusy = false; } })();
  }, true);

  // ---- 전역 키·바깥 클릭 ----
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && modalOpen()) { trapTab(e); return; }
    if (e.key !== 'Escape') return;
    if (colDrag) return; // 패널 경계를 끄는 중의 Esc 는 끌기 취소만 한다(상세·메뉴를 함께 닫지 않는다)
    if (wsEdit && document.activeElement === wsEdit.input) return; // 이름 입력칸이 Esc 를 직접 처리한다(취소)
    if (wsMenu) { e.preventDefault(); e.stopPropagation(); closeWsMenu(true); return; }
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

  // ---- 달력 카드(왼쪽)와 하루 보기(가운데) ----
  // 모든 문구는 textContent 로만 넣는다. 날짜 문자열은 main 이 검증해 준 값이고, 하루 보기는 읽기 전용이다.
  let calYm = todayStr().slice(0, 7); let calData = null; let calSeq = 0; let calSig = '';
  let dayKey = null; let dayData = null; let daySig = ''; let daySeq = 0; let dayPendTimer = null;
  const dayColl = new Set(); const dayExp = new Set(); let devDayOpen = false; // 접힌 기록 묶음(묶음 정체성 키)·펼친 일정(날짜|시각|제목): 렌더러 메모리에만 둔다(저장 안 함, 하루 보기를 닫았다 열어도 앱이 도는 동안 유지)
  const capAdd = (set, k) => { set.delete(k); set.add(k); while (set.size > 200) set.delete(set.values().next().value); }; // 두 상태는 최대 200개만 둔다(가장 오래된 것부터 버림)
  const grpId = (g) => (g.key ? 'p:' + g.key : g.title ? 't:' + g.title : 'n:');
  const evKey = (day, e) => day + '|' + (e.allDay ? '' : e.time) + '|' + e.title;
  const capText = (x, n) => { const c = [...String(x == null ? '' : x)]; return c.length > n ? c.slice(0, n).join('') + '…' : c.join(''); };
  const ymdDate = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); return new Date(+m[1], +m[2] - 1, +m[3]); };
  const fmtIntl = (date, opts) => { try { return new Intl.DateTimeFormat(lang, opts).format(date); } catch (x) { return ''; } };
  function calDayLabel(day, info) {
    const parts = [fmtIntl(ymdDate(day), { month: 'long', day: 'numeric' })];
    if (info && info.records) parts.push(T('cal.day.rec', { n: info.records }));
    if (info && info.events) parts.push(T('cal.day.ev', { n: info.events }));
    if (info && info.diary) parts.push(T('cal.day.diary'));
    return parts.join(', ');
  }
  function renderCal() {
    const p = Lib.parseYm(calYm); if (!p) return;
    const today = calData ? calData.today : todayStr();
    const days = calData && calData.ym === calYm ? calData.days : {};
    const on = !!(calData && calData.calendarOn);
    const selDay = detailOpen && detailMode === 'day' ? dayKey : null;
    const grid = $('cal-grid'); const f = document.activeElement;
    const had = f && grid.contains(f) && f.dataset.day ? f.dataset.day : null;
    const sig = JSON.stringify([lang, calYm, days, today, on, selDay, had]);
    if (sig === calSig) return;
    calSig = sig;
    $('cal-month').textContent = fmtIntl(new Date(p.year, p.month - 1, 1), { year: 'numeric', month: 'long' });
    $('cal-prev').disabled = !Lib.shiftYm(calYm, -1); $('cal-next').disabled = !Lib.shiftYm(calYm, 1);
    const wds = $('cal-wds'); wds.replaceChildren();
    for (let i = 0; i < 7; i++) wds.append(el('span', 'cal-wd', fmtIntl(new Date(2024, 0, 7 + i), { weekday: 'narrow' }))); // 2024-01-07 은 일요일
    const lay = Lib.monthLayout(p.year, p.month);
    const stop = had && had.startsWith(calYm + '-') ? had : selDay && selDay.startsWith(calYm + '-') ? selDay : today.startsWith(calYm + '-') ? today : calYm + '-01'; // 탭으로 들어오는 칸(roving tabindex)
    grid.replaceChildren();
    for (let i = 0; i < lay.first; i++) grid.append(el('span', 'cal-pad'));
    for (let d = 1; d <= lay.days; d++) {
      const day = calYm + '-' + pad(d); const info = Object.prototype.hasOwnProperty.call(days, day) ? days[day] : null;
      const b = el('button', 'cal-d' + (day === today ? ' today' : '') + (day === selDay ? ' sel' : '')); b.type = 'button'; b.dataset.day = day;
      b.append(el('span', 'n', String(d)));
      const dots = el('span', 'dots');
      if (info && info.records) dots.append(el('i', 'rec'));
      if (info && info.events) dots.append(el('i', 'ev'));
      b.append(dots);
      b.setAttribute('aria-label', calDayLabel(day, info));
      if (day === today) b.setAttribute('aria-current', 'date');
      b.setAttribute('aria-pressed', String(day === selDay));
      b.tabIndex = day === stop ? 0 : -1;
      b.addEventListener('click', () => showDay(day, 'title'));
      grid.append(b);
    }
    $('cal-legend').textContent = T(on ? 'cal.legend' : 'cal.legend.rec');
    if (had) { const n = grid.querySelector('[data-day="' + had + '"]'); if (n) n.focus(); }
  }
  async function refreshCal() {
    const my = ++calSeq; const ym = calYm;
    let d = null; try { d = await window.maru.getMonthDays(ym); } catch (x) { d = null; }
    if (my !== calSeq || !d || d.ym !== calYm || !Lib.parseYm(d.ym) || typeof d.today !== 'string' || !d.days || typeof d.days !== 'object') return;
    calData = d; renderCal();
  }
  function setCalMonth(ym) { if (!Lib.parseYm(ym) || ym === calYm) return; calYm = ym; calSig = ''; renderCal(); refreshCal(); }
  $('cal-prev').addEventListener('click', () => { const n = Lib.shiftYm(calYm, -1); if (n) setCalMonth(n); });
  $('cal-next').addEventListener('click', () => { const n = Lib.shiftYm(calYm, 1); if (n) setCalMonth(n); });
  $('cal-today').addEventListener('click', () => {
    const t = (calData ? calData.today : todayStr()); setCalMonth(t.slice(0, 7));
    const b = $('cal-grid').querySelector('[data-day="' + t + '"]'); if (b) b.focus();
  });
  // 방향키: 날짜 칸 사이 이동(좌우 하루, 상하 한 주, Home/End 달의 처음·끝). 달 밖으로는 나가지 않는다
  $('cal-grid').addEventListener('keydown', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('.cal-d') : null;
    if (!t || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.isComposing) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    const all = [...$('cal-grid').querySelectorAll('.cal-d')]; const i = all.indexOf(t);
    let j = -1;
    if (step !== undefined) j = i + step; else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = all.length - 1; else return;
    e.preventDefault();
    if (j >= 0 && j < all.length) { for (const x of all) x.tabIndex = -1; all[j].tabIndex = 0; all[j].focus(); }
  });

  // 하루 보기: kind 'title' 이면 제목에 포커스(열 때), 'keep' 이면 누른 단추에 그대로(전날·다음 날)
  function showDay(day, focus) {
    if (!Lib.validDay(day) || !Lib.parseYm(day.slice(0, 7))) return;
    closeMenu(false); closeUpdate(false);
    detailMode = 'day'; inboxDet = null; inboxDetSeq++; detailKey = null; detail = null; detailSig = ''; detailSeq++; detailOpen = true;
    dayKey = day; dayData = null; daySig = ''; daySeq++; clearTimeout(dayPendTimer);
    renderRc(); $('terminal').hidden = true; $('term-empty').hidden = true; $('proj-detail').hidden = true; $('inbox-detail').hidden = true; if (memView) memView.hide();
    $('day-view').hidden = false;
    $('day-view').setAttribute('aria-label', T('day.aria'));
    $('dv-title').textContent = fmtIntl(ymdDate(day), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    $('dv-prev').disabled = !Lib.shiftDay(day, -1); $('dv-next').disabled = !Lib.shiftDay(day, 1);
    $('dv-body').replaceChildren();
    if (lastPanels) renderProjects(lastPanels.projects);
    if (day.slice(0, 7) !== calYm) setCalMonth(day.slice(0, 7)); else { calSig = ''; renderCal(); }
    if (focus === 'title') $('dv-title').focus();
    fetchDay();
  }
  async function fetchDay() {
    const my = ++daySeq; const day = dayKey;
    let d = null; try { d = await window.maru.getDayDetail(day); } catch (x) { d = null; }
    if (my !== daySeq || !detailOpen || detailMode !== 'day' || day !== dayKey) return;
    if (!d || d.day !== day || !Array.isArray(d.groups) || !d.events) { closeDetail(true); return; }
    clearTimeout(dayPendTimer);
    if (d.calendarOn === false || d.events.state === 'off') dayExp.clear(); // 캘린더가 꺼졌으면 펼친 일정 제목을 바로 잊는다
    if (d.events.state === 'pending' || (d.events.state === 'ok' && d.events.detail === 'pending')) dayPendTimer = setTimeout(() => { if (detailOpen && detailMode === 'day' && day === dayKey) fetchDay(); }, 1500); // 일정(또는 그 상세)을 읽는 중이면 곧 다시 묻는다
    if (devDayOpen && d.events.state === 'ok' && d.events.items.length && d.groups.length > 1) { devDayOpen = false; for (const e of d.events.items.slice(0, 2)) capAdd(dayExp, evKey(d.day, e)); capAdd(dayColl, grpId(d.groups[1])); } // 시험 전용(MARU_APP_DAY_OPEN=1): 앞 두 일정 펼침·둘째 묶음 접힘
    const sig = JSON.stringify([d, [...dayColl], [...dayExp]]);
    if (sig === daySig && dayData) return; // 같으면 다시 그리지 않는다(깜박임·포커스 이동 없음)
    daySig = sig; dayData = d; renderDay(false);
  }
  const fmtEndDay = (x) => (typeof x === 'string' && Lib.validDay(x) ? fmtIntl(ymdDate(x), { month: 'long', day: 'numeric' }) : '');
  function evRange(e, bk) { // bk: 끝 날·끝 시각을 가진 블록(합쳐진 다른 캘린더 것이면 그쪽 값)
    const end = bk.endDay ? fmtEndDay(bk.endDay) : '';
    if (e.allDay) return T('cal.allday') + (end ? ' – ' + end : '');
    return e.time + (bk.endTime ? ' – ' + (end ? end + ' ' : '') + bk.endTime : '');
  }
  function renderDay() {
    const d = dayData; if (!d) return;
    $('day-view').setAttribute('aria-label', T('day.aria'));
    $('dv-title').textContent = fmtIntl(ymdDate(d.day), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    $('dv-prev').disabled = !Lib.shiftDay(d.day, -1); $('dv-next').disabled = !Lib.shiftDay(d.day, 1);
    const body = $('dv-body'); const f = document.activeElement;
    const keepKey = f && body.contains(f) && f.dataset && f.dataset.fk ? f.dataset.fk : null; // 다시 그린 뒤 같은 토글에 포커스를 되돌린다
    const keep = f && body.contains(f) ? f : null;
    body.replaceChildren();
    const sec = (key, act) => { const x = el('section', 'dv-sec'); if (act) { const h = el('div', 'dv-sh'); h.append(el('h3', 'pd-h', T(key)), act); x.append(h); } else x.append(el('h3', 'pd-h', T(key))); body.append(x); return x; };
    if (d.diary || d.groups.length || d.isToday) {
      const x = sec('day.sec.diary');
      if (d.diary) {
        x.append(el('h4', 'dv-diary-title', d.diary.title));
        for (const para of String(d.diary.body).split(/\n{2,}/)) if (para.trim()) x.append(el('p', 'dv-p', para));
      } else x.append(el('p', 'hint dv-hint', T(d.isToday ? 'day.diary.today' : 'day.diary.none')));
    }
    const ev = d.events;
    if (d.calendarOn && (ev.state !== 'ok' || ev.items.length)) {
      const x = sec('day.sec.events');
      if (ev.state === 'pending') x.append(el('p', 'hint dv-hint', T('day.events.loading')));
      else if (ev.state === 'fail') x.append(el('p', 'hint dv-hint', T(ev.perm ? 'day.events.perm' : 'day.events.fail')));
      else ev.items.forEach((e, i) => {
        const k = evKey(d.day, e); const open = dayExp.has(k); const id = 'dv-ev-' + i;
        const w = el('div', 'dv-evx' + (open ? ' open' : ''));
        const b = el('button', 'dv-ev'); b.type = 'button'; b.dataset.fk = 'e:' + k; b.setAttribute('aria-expanded', String(open)); if (open) b.setAttribute('aria-controls', id); // 대상이 그려져 있을 때만 aria-controls
        b.append(el('span', 'cal-t', e.allDay ? T('cal.allday') : e.time), el('span', 'cal-n', e.title));
        b.addEventListener('click', () => { if (dayExp.has(k)) dayExp.delete(k); else capAdd(dayExp, k); fetchDayLocal(); });
        w.append(b);
        if (open) {
          const dt = el('div', 'dv-evd'); dt.id = id;
          const blocks = [e, ...(Array.isArray(e.more) ? e.more.slice(0, 3) : [])]; // 같은 일정이 여러 캘린더에 있으면 블록마다 캘린더 이름을 소제목으로 보여 준다
          blocks.forEach((bk, bi) => {
            const bx = blocks.length > 1 ? el('div', 'evd-b') : dt;
            if (blocks.length > 1) bx.append(el('div', 'evd-bh', capText(bk.cal, 80) || T('day.ev.cal')));
            const tr = (!e.allDay || bk.endDay) ? evRange(e, bk) : ''; // 하루짜리 종일 일정은 시간 줄을 생략한다(이미 "종일"이 위에 있다)
            if (tr) bx.append(el('div', 'evd-time', tr));
            const row = (lk, v, cls) => { if (!v) return; const r = el('div', 'evd-r'); r.append(el('span', 'evd-l', T(lk)), el('span', 'evd-v' + (cls ? ' ' + cls : ''), v)); bx.append(r); };
            if (blocks.length === 1) row('day.ev.cal', capText(bk.cal, 80));
            row('day.ev.loc', capText(bk.loc, 200)); row('day.ev.notes', capText(bk.notes, 600), 'evd-notes');
            if (bx !== dt) dt.append(bx);
          });
          if (ev.detail === 'pending') dt.append(el('div', 'hint evd-wait', T('day.events.loading')));
          else if (ev.detail === 'fail') dt.append(el('div', 'hint evd-wait', T(ev.perm ? 'day.events.perm' : 'day.events.fail'))); // 상세를 읽지 못했으면 상세가 없는 일정처럼 보이지 않게 알린다
          w.append(dt);
        }
        x.append(w);
      });
    }
    if (d.groups.length) {
      const ids = d.groups.map(grpId); const allClosed = ids.every((i) => dayColl.has(i));
      const all = el('button', 'dv-all', T(allClosed ? 'day.all.expand' : 'day.all.collapse')); all.type = 'button'; all.dataset.fk = 'all';
      all.addEventListener('click', () => { for (const i of ids) { if (allClosed) dayColl.delete(i); else capAdd(dayColl, i); } fetchDayLocal(); });
      const x = sec('day.sec.records', all);
      d.groups.forEach((g, gi) => {
        const id = ids[gi]; const closed = dayColl.has(id); const lid = 'dv-log-' + gi;
        const h = el('h4', 'dv-gh'); const b = el('button', 'dv-gt'); b.type = 'button'; b.dataset.fk = 'g:' + id; b.setAttribute('aria-expanded', String(!closed)); if (!closed) b.setAttribute('aria-controls', lid);
        b.append(el('span', 'ct', g.title || T('day.notag')));
        if (closed) b.append(el('span', 'cn', T('day.group.n', { n: g.items.length })));
        b.addEventListener('click', () => { if (dayColl.has(id)) dayColl.delete(id); else capAdd(dayColl, id); fetchDayLocal(); });
        h.append(b); x.append(h);
        if (closed) return;
        const lg = el('div', 'pd-log'); lg.id = lid;
        for (const it of g.items) { const r = el('div', 'pd-row dv-row'); r.append(el('span', 'd', it.time), el('span', 'k k-' + it.kind, T('proj.kind.' + it.kind)), el('span', 'x', it.text)); lg.append(r); }
        x.append(lg);
      });
    }
    if (!d.diary && !d.groups.length && !(ev.items && ev.items.length) && (ev.state === 'off' || ev.state === 'ok')) body.append(el('p', 'dv-empty', T('day.empty')));
    if (keepKey) { const n = [...body.querySelectorAll('[data-fk]')].find((x) => x.dataset.fk === keepKey); if (n) { n.focus(); return; } }
    if (keep && !document.contains(keep)) $('dv-title').focus();
  }
  // 캘린더를 끈 직후: 펼친 일정 상태와 받아 둔 하루 데이터 안의 일정(제목·장소·메모)을 모두 지우고, 열려 있으면 다시 그린다
  function forgetDayEvents() {
    dayExp.clear(); daySig = '';
    if (dayData) { dayData = { ...dayData, calendarOn: false, events: { state: 'off', items: [] } }; if (detailOpen && detailMode === 'day') renderDay(); }
  }
  // 토글을 눌렀을 때: 이미 받은 데이터로 바로 다시 그린다(포커스는 renderDay 가 같은 토글로 되돌린다)
  function fetchDayLocal() { renderDay(); daySig = JSON.stringify([dayData, [...dayColl], [...dayExp]]); }
  $('dv-close').addEventListener('click', () => closeDetail(true));
  $('dv-prev').addEventListener('click', () => { const n = Lib.shiftDay(dayKey, -1); if (n) showDay(n, 'keep'); });
  $('dv-next').addEventListener('click', () => { const n = Lib.shiftDay(dayKey, 1); if (n) showDay(n, 'keep'); });

  // ---- 기억 보기: 터미널 자리를 차지하는 읽기 전용 화면(목록·그래프) ----
  memView = window.MaruMemView.create({ T, $, el, Lib, onClose: () => closeDetail(true), lang: () => lang });
  function openMemory(initialMode) {
    if (detailOpen && detailMode === 'memory') return;
    detailMode = 'memory'; inboxDet = null; inboxDetSeq++; dayKey = null; daySeq++; detailKey = null; detail = null; detailSig = ''; detailSeq++; detailOpen = true;
    renderRc(); $('terminal').hidden = true; $('term-empty').hidden = true; $('proj-detail').hidden = true; $('inbox-detail').hidden = true; $('day-view').hidden = true;
    if (lastPanels) renderProjects(lastPanels.projects);
    renderCal();
    memView.show(initialMode).then(() => $('mv-title').focus());
  }
  $('mem-open').addEventListener('click', () => openMemory('list'));

  // ---- 첫 설정(덮개) ----
  const SU_STEPS = ['lang', 'prereq', 'home', 'connect', 'done'];
  const su = { blocked: null, open: false, step: 'lang', name: '', prereq: null, checking: false, busy: false, err: '', later: false, fake: false, authOk: null, termBusy: false, termLock: false, termHint: false, auto: false, lastAt: 0 };
  let suUnfinished = false;
  let homeManaged = false; let homeNotice = null;
  function suOpen(step, fake, blocked) {
    su.open = true; su.step = step; su.err = ''; su.busy = false; su.later = false; su.fake = !!fake; su.blocked = blocked || null;
    if (!su.name && profile) su.name = profile.name;
    $('setup').hidden = false; $('root-missing').hidden = true; $('meet-banner').hidden = true;
    syncModalState();
    renderSetup(true);
    if (step === 'prereq') suCheck(); else if (step === 'done') suAuth();
  }
  function suClose() { su.open = false; $('setup').hidden = true; syncModalState(); focusTerm(); refreshMeet(); }
  function suGo(step) { su.step = step; su.err = ''; su.termHint = false; renderSetup(true); if (step === 'prereq') suCheck(); else if (step === 'done') suAuth(); }
  // 마지막 단계: 로그인 상태를 다시 읽어(앱이 다시 시작돼 이전 점검 결과가 없다) 로그인 전이면 그렇게 말한다
  async function suAuth() {
    su.authOk = null; let r = null; try { r = await window.maru.setupPrereqs(); } catch (e) { r = null; }
    const a = r && Array.isArray(r.list) ? r.list.find((x) => x.id === 'auth') : null; su.authOk = a && a.status === 'ok' ? true : a && a.status === 'need' ? false : null; // 읽지 못한 것(unknown)은 안내하지 않는다
    if (su.step === 'done' && su.open) renderSetup(false);
  }
  // auto: 창으로 돌아왔을 때의 자동 재확인. 목록을 비우지 않고(깜박임 없이) 결과만 바꾼다
  async function suCheck(auto, force) {
    su.checking = true; su.auto = auto === true; su.lastAt = Date.now(); su.err = '';
    if (!su.auto) su.prereq = null;
    renderSetup(false);
    let r = null; try { r = await window.maru.setupPrereqs(force === true); } catch (e) { r = null; }
    su.checking = false; su.termLock = false; su.lastAt = Date.now(); // 결과가 오면 터미널 단추를 다시 쓸 수 있다
    if (r && Array.isArray(r.list)) { su.prereq = r; su.err = ''; } else if (!su.auto) { su.prereq = null; su.err = T('su.prereq.failed'); }
    su.auto = false;
    if (su.step === 'prereq') renderSetup(false);
  }
  // 터미널 단추: main 이 명령을 정하고 확인 창에서 보여 준다(렌더러는 종류만 보낸다)
  async function suTerm(kind) {
    if (su.termBusy || su.termLock) return;
    if (su.fake) { su.err = T('setup.term.err.invalid'); renderSetup(false); return; }
    su.termBusy = true; su.err = ''; renderSetup(false);
    let r = null; try { r = await window.maru.setupTerminal(kind, lang); } catch (e) { r = null; }
    su.termBusy = false; su.lastAt = Date.now(); // 확인 창을 닫고 돌아온 포커스로 바로 다시 확인하지 않게
    const reason = r && r.reason;
    if (r && r.ok) { su.termHint = true; su.termLock = true; } // 다음 확인 결과가 올 때까지 두 번째 터미널을 열지 못하게
    else if (reason !== 'cancelled') su.err = T(['invalid', 'prereq', 'write', 'launch'].includes(reason) ? 'setup.term.err.' + reason : 'setup.term.err.launch');
    renderSetup(false);
  }
  // 아직 못 갖춘 행이 있는가(로그인처럼 막지 않는 행도 포함)
  const suPending = () => !!(su.prereq && su.prereq.list.some((x) => x.status === 'missing' || x.status === 'need'));
  // 창으로 돌아오면(포커스) 못 갖춘 도구가 있을 때 다시 확인한다: 1.5초 안 중복·확인 중에는 건너뜀
  window.addEventListener('focus', () => {
    if (su.open && su.step === 'prereq' && !su.checking && !su.fake && su.prereq && suPending() && Date.now() - su.lastAt >= 1500) suCheck(true);
  });
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
      if (su.checking && !su.prereq) list.append(el('p', '', T('su.prereq.checking')));
      const claudeSt = ((su.prereq && su.prereq.list.find((y) => y.id === 'claude')) || {}).status;
      for (const x of (su.prereq && su.prereq.list) || []) {
        const r = el('div', 'su-row'); const rt = el('div', 'rt');
        rt.append(el('span', '', T('prereq.name.' + x.id) + (x.detail ? ' ' + x.detail : '')), el('span', 'pill ' + (x.status === 'ok' ? 'ok' : x.status === 'unknown' ? 'unknown' : 'need'), T('prereq.status.' + x.status)));
        r.append(rt);
        if (x.how) r.append(el('div', 'how', T(x.how)));
        const acts = [];
        if (x.id === 'claude' && x.status === 'missing') acts.push(suBtn(T('setup.term.install'), 'primary', () => suTerm('install-claude'), su.termBusy || su.termLock), suBtn(T('setup.term.guide'), 'ghost', () => { window.maru.setupOpenGuide().catch(() => {}); }));
        else if (x.id === 'claude' && x.status === 'need') acts.push(suBtn(T('setup.term.guide'), 'ghost', () => { window.maru.setupOpenGuide().catch(() => {}); }));
        else if (x.id === 'auth' && x.status !== 'ok' && claudeSt === 'ok') acts.push(suBtn(T('setup.term.login'), 'primary', () => suTerm('login'), su.termBusy || su.termLock));
        if (acts.length) { const a = el('div', 'su-act'); a.append(...acts); r.append(a); }
        list.append(r);
      }
      body.append(list);
      if (su.termHint && suPending()) body.append(el('div', 'hint', T('setup.term.hint')));
      const lst = (su.prereq && su.prereq.list) || [];
      const au = lst.find((x) => x.id === 'auth'); const cl = lst.find((x) => x.id === 'claude');
      if (au && au.status === 'need' && cl && cl.status === 'ok') body.append(el('div', 'hint', T('su.prereq.authNote'))); // 막지는 않는다(API 키 등 다른 방법도 있다)
      if (su.prereq && !su.prereq.ready) body.append(el('div', 'hint', T('su.prereq.blocked'))); // ready 는 auth 를 보지 않는다: 필수 도구가 빠졌을 때만
      body.append(err());
      row.append(suBtn(T('su.back'), 'ghost', () => suGo('lang')), suBtn(T('su.prereq.recheck'), '', () => suCheck(false, true), su.checking && !su.auto), suBtn(T('su.next'), 'primary', () => suGo('home'), (su.checking && !su.auto) || !(su.prereq && su.prereq.ready)));
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
      if (su.authOk === false) body.append(el('div', 'hint', T('su.done.authCheck')));
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
  let meetPending = false; // 확인 창이 떠 있는 동안 다시 누르지 못하게
  async function startMeet() {
    if (!activeId || modalOpen() || meetPending) return;
    meetPending = true; $('meet-start').disabled = true;
    let r = null; try { r = await window.maru.meetStart(activeId); } catch (e) { r = null; } finally { meetPending = false; $('meet-start').disabled = false; }
    if (r && r.reason === 'busy') return;
    if (r && r.ok) { flashNote(T('meet.note.ok')); refreshMeet(); return; }
    const reason = r && r.reason;
    if (reason === 'cancel') return;
    const why = r && ['bracketed', 'claude-up', 'quiet'].includes(r.why) ? ' (' + T('meet.why.' + r.why) + ')' : ''; // 어느 조건에서 기다리는지(진단)
    flashNote(T(reason === 'not-maru' ? 'meet.note.not-maru' : reason === 'setup' ? 'meet.note.setup' : reason === 'not-ready' || reason === 'no-term' || reason === 'shell' ? 'meet.note.not-ready' : 'meet.note.fail') + (reason === 'not-ready' ? why : ''));
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
      if (I18N.isLang(init.uiLang)) lang = init.uiLang; // 시험 전용(MARU_APP_LANG, 개발 실행 + MARU_APP_UI=memory|memgraph): 프로필·설정은 바꾸지 않고 화면 언어만
      if (init.uiUnsorted === true) unsortedOpen = true; // 시험 전용(MARU_APP_UNSORTED=open)
      if (init.uiDoneOpen === true) doneOpen = true; // 시험 전용(MARU_APP_DONE=open)
    }
    applyStatic();
    initCols(init); initRead(init);
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
    else if (init && init.uiOpen === 'squadnew') openSquadNew(); // 시험 전용(MARU_APP_UI=squadnew): 화면 확인용
    window.maru.updateNotice().then((n) => { if (n) { updNotice = n; $('upd-dot').hidden = false; } }).catch(() => {});
    syncWs().then(poll).then(() => { if (init && init.uiOpen === 'subnew') { const m = wsList.find((w) => w.sub === true); if (m) openSub(m.id, true); } if (init && init.uiOpen === 'project') openFirstProject(); if (init && init.uiOpen === 'day' && typeof init.uiDay === 'string') { devDayOpen = init.uiDayOpen === true; showDay(init.uiDay, 'title'); } if (init && (init.uiOpen === 'memory' || init.uiOpen === 'memgraph')) openMemory(init.uiOpen === 'memgraph' ? 'graph' : 'list'); if (init && init.uiOpen === 'memgraph' && I18N.isLang(init.uiLangSwitch)) setTimeout(() => { lang = init.uiLangSwitch; relabel(); }, 1500); // 시험 전용(MARU_APP_LANGSWITCH): 저장 없이 언어를 바꿔 relabel 경로를 확인
    if (init && init.uiOpen === 'memgraph' && (init.uiMemZoom || init.uiMemSel || init.uiMemHover)) setTimeout(() => memView.devPose({ zoom: Number(init.uiMemZoom) || 0, sel: init.uiMemSel === true, hover: init.uiMemHover === true }), 600); if (init && init.uiOpen === 'inbox') { setNotifsOpen(true); $('inbox').scrollIntoView({ block: 'end' }); } if (init && (init.uiOpen === 'wsmenu' || init.uiOpen === 'wsrename' || init.uiOpen === 'wsdrag')) openWsDev(init.uiOpen); }); // 시험 전용(MARU_APP_UI=project): 화면 확인용으로 상세를 연 채 둔다
    setInterval(poll, 1000);
    setInterval(() => { refreshCal(); if (detailOpen && detailMode === 'day') fetchDay(false); }, 5000); // 일지·회고·일정은 main 이 읽어 둔 캐시를 가볍게 다시 묻는다
    refreshMeet(); setInterval(refreshMeet, 30000);
    setInterval(() => { if (lastPanels) renderInbox(lastPanels.inbox); }, 30000); // 상대 시각(N분 전)을 갱신
    setInterval(syncWs, 1000); // 상태 파일은 이벤트가 없으므로 주기적으로 읽는다
  }
  boot();
})();
