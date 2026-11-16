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

  // ---- 터미널 ----
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
  term.open($('terminal'));
  // 한글 글꼴이 로드된 뒤 다시 적용해 글자 아틀라스를 새로 만든다
  if (document.fonts && document.fonts.load) document.fonts.load('14px MaruHangul', '가').then(() => { term.options.fontFamily = TERM_FONT + ' '; term.options.fontFamily = TERM_FONT; }).catch(() => {});
  try {
    const gl = new window.WebglAddon.WebglAddon();
    gl.onContextLoss(() => gl.dispose());
    term.loadAddon(gl);
  } catch (e) { /* WebGL 불가 시 DOM 렌더러 */ }

  let started = false;
  function doFit() {
    try { fit.fit(); window.maru.ptyResize(term.cols, term.rows); } catch (e) { /* 레이아웃 전 */ }
    if (!started) startPty(); // 시작 실패 시 다음 리사이즈에 재시도
  }
  term.attachCustomKeyEventHandler((e) => {
    const seq = window.MaruLib.keyToSeq(e);
    if (seq === null) return true;
    if (e.type === 'keydown') window.maru.ptyWrite(seq);
    return false;
  });
  term.onData((d) => window.maru.ptyWrite(d));
  window.maru.onPtyData((d) => term.write(d));
  window.maru.onPtyExit((code) => {
    term.write(`\r\n\x1b[38;5;208m[프로세스 종료 code=${code} · Cmd+Shift+R 로 터미널 다시 시작]\x1b[0m\r\n`);
  });
  async function startPty() {
    try { fit.fit(); started = !!(await window.maru.ptyStart(term.cols, term.rows)); } catch (e) { started = false; }
    if (started) term.focus();
  }
  window.maru.onPtyRestart(async () => {
    term.reset();
    try { started = !!(await window.maru.ptyRestart(term.cols, term.rows)); } catch (e) { started = false; }
    if (started) term.focus();
  });
  new ResizeObserver(doFit).observe($('terminal'));
  window.addEventListener('resize', doFit);

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

  function renderStatic(p) {
    $('root-missing').hidden = !p.rootMissing;
    $('lv').textContent = 'LV ' + p.level.level;
    $('growth-left').textContent = '성장도 · 기억 ' + p.level.memories + '개';
    $('growth-right').textContent = '다음 레벨까지 기억 ' + p.level.toNext + '개';
    $('bar').style.width = Math.round(p.level.ratio * 100) + '%';
    $('batt').textContent = p.battery ? '배터리 ' + p.battery.percent + '%' : '배터리 -';
    $('disk').textContent = p.disk ? '여유 ' + p.disk.freeGB + 'GB' : '여유 -';
    $('term-name').textContent = p.rootName;
    $('term-cwd').textContent = '~/' + p.rootName;

    const ws = $('workspaces'); ws.replaceChildren();
    for (const w of p.workspaces) {
      const row = el('div', 'ws' + (w.active ? ' active' : ''));
      row.append(el('span', 'dot'));
      const c = el('span', 'col');
      c.append(el('span', 'n', w.name), el('span', 's', '대화 중'));
      row.append(c); ws.append(row);
    }
    const party = $('party'); party.replaceChildren();
    for (const m of p.party) {
      const row = el('div', 'party-row' + (m.lead ? ' lead' : ''));
      const l = el('span'); l.append(el('b', '', m.name), document.createTextNode(' ' + m.role));
      row.append(l, el('span', 'm', m.model)); party.append(row);
    }

    const q = $('quests'); q.replaceChildren();
    if (!p.todos.length) q.append(el('div', 'empty', '아직 추천할 일이 없습니다'));
    let prevTag = null;
    p.todos.forEach((it, i) => {
      if (it.tag !== prevTag) { prevTag = it.tag; q.append(el('div', 'tag-head', it.tag)); }
      const canFill = !!it.prompt;
      const b = el(canFill ? 'button' : 'div', 'todo' + (canFill ? '' : ' manual'));
      if (canFill) b.type = 'button';
      const body = el('span', 'body'); body.append(el('span', 't', it.title));
      if (canFill) { const pe = el('span', 'p', it.prompt); pe.title = it.prompt; body.append(pe); }
      b.append(el('span', 'imp' + (it.importance >= 8 ? ' hi' : ''), String(it.importance)), body);
      if (!canFill) b.append(el('span', 'own', '직접'));
      if (canFill) b.addEventListener('click', async () => {
        let res = null;
        try { res = await window.maru.fillQuest(i, window.MaruLib.todoKey(it)); } catch (e) { /* 무시 */ }
        if (!res || !res.ok) note(window.MaruLib.fillNotice(res && res.reason));
        term.focus();
      });
      q.append(b);
    });

    const sk = $('skills'); sk.replaceChildren();
    for (const n of p.skills) sk.append(el('span', 'chip', n));
    $('skills-count').textContent = p.skills.length + '개 · 대기 제안 ' + p.pendingSkillProposals;

    const br = $('briefing'); br.replaceChildren();
    if (!p.briefing.length) br.append(el('div', 'empty', '밤사이 기록이 없습니다.'));
    for (const e of p.briefing) {
      const row = el('div', 'brief'); row.append(el('span', 'at', fmtAt(e.at)), el('span', '', e.text)); br.append(row);
    }

  }

  const AGENT_VIEW = {
    busy: ['작업 중', '마루가 일하고 있습니다'],
    idle: ['입력 대기', '다음 지시를 기다리고 있습니다'],
    waiting: ['확인 필요', '터미널에서 확인이 필요합니다'],
    none: ['대기', '아직 상태 신호가 없습니다'],
  };
  function renderBusy(p) {
    const core = document.querySelector('.core');
    const v = AGENT_VIEW[p.agent] || AGENT_VIEW.none;
    core.classList.toggle('idle', p.agent !== 'busy' && p.agent !== 'waiting');
    core.classList.toggle('waiting', p.agent === 'waiting');
    $('status-main').textContent = v[0];
    $('status-sub').textContent = v[1];
    $('core').setAttribute('aria-label', '마루 코어: ' + v[0]);
  }

  let lastKey = null; let lastBusy = null;
  async function poll() {
    try {
      const p = await window.maru.getPanels();
      if (p) {
        const { agent, ...rest } = p;
        const key = JSON.stringify(rest);
        if (key !== lastKey) { lastKey = key; renderStatic(p); window.maru.notifyRendered(); }
        if (agent !== lastBusy) { lastBusy = agent; renderBusy(p); }
      }
    } catch (e) { /* 다음 주기에 재시도 */ }
  }

  tickClock(); setInterval(tickClock, 15000);
  startPty().then(poll);
  setInterval(poll, 1000);
})();
