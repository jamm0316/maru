(function () {
  var COPY = window.MARU_COPY, LINKS = window.MARU_LINKS || {};
  var root = document.documentElement;
  var KEY = 'maru-lang';
  var lang = 'en';

  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function store(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function t(k) { var d = COPY[lang]; return (d && d[k] != null) ? d[k] : (COPY.en[k] || ''); }

  var s = stored();
  if (s === 'en' || s === 'ko') lang = s;
  else if (/^ko/i.test(navigator.language || '')) lang = 'ko';

  var video = document.getElementById('promo');
  var film = document.getElementById('film');
  var btn = document.getElementById('film-btn');
  var btnT = document.getElementById('film-btn-t');
  var ready = false, userPaused = false;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function applyLinks() {
    document.querySelectorAll('[data-link]').forEach(function (a) {
      var url = LINKS[a.getAttribute('data-link')];
      var label = a.getAttribute('data-label');
      if (url) {
        a.setAttribute('href', url);
        a.classList.remove('is-disabled');
        a.removeAttribute('aria-disabled');
        a.removeAttribute('aria-label');
        a.textContent = label;
      } else {
        a.removeAttribute('href');
        a.classList.add('is-disabled');
        a.setAttribute('aria-disabled', 'true');
        var soon = t(a.getAttribute('data-i18n') + '.soon') || (label + ' · ' + t('soon'));
        a.removeAttribute('aria-label');
        a.textContent = soon;
      }
    });
  }

  function setVideo() {
    var src = lang === 'ko' ? 'assets/maru-promo-ko.mp4' : 'assets/maru-promo.mp4';
    var poster = lang === 'ko' ? 'assets/poster-ko.png' : 'assets/poster.png';
    if (video.getAttribute('data-src') === src) return;
    video.setAttribute('data-src', src);
    ready = false;
    film.classList.remove('is-ready');
    btn.disabled = true;
    video.setAttribute('poster', poster);
    video.src = src;
    video.muted = true;
    video.load();
    if (!reduced && !userPaused) { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
  }

  function syncBtn() {
    var paused = video.paused;
    btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    btn.classList.toggle('is-paused', paused);
    btnT.textContent = t(paused ? 'video.play' : 'video.pause');
  }

  function apply() {
    root.setAttribute('lang', lang);
    document.title = t('meta.title');
    var md = document.querySelector('meta[name="description"]');
    if (md) md.setAttribute('content', t('meta.description'));
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var i = pair.indexOf(':');
        if (i > 0) el.setAttribute(pair.slice(0, i).trim(), t(pair.slice(i + 1).trim()));
      });
    });
    document.querySelectorAll('[data-link]').forEach(function (a) {
      var key = a.getAttribute('data-i18n');
      a.setAttribute('data-label', t(key));
    });
    applyLinks();
    document.querySelectorAll('.lang button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-lang') === lang ? 'true' : 'false');
    });
    setVideo();
    syncBtn();
    demoApply();
  }

  // Links: data-i18n would overwrite the label; applyLinks runs after and sets final text.
  document.querySelectorAll('.lang button').forEach(function (b) {
    b.addEventListener('click', function () {
      lang = b.getAttribute('data-lang');
      store(lang);
      apply();
      startTry();
    });
  });

  video.addEventListener('loadedmetadata', function () { ready = true; film.classList.add('is-ready'); btn.disabled = false; syncBtn(); });
  video.addEventListener('loadeddata', function () { ready = true; film.classList.add('is-ready'); btn.disabled = false; syncBtn(); });
  video.addEventListener('error', function () { ready = false; film.classList.remove('is-ready'); btn.disabled = true; });
  video.addEventListener('play', syncBtn);
  video.addEventListener('pause', syncBtn);
  btn.addEventListener('click', function () {
    if (!ready) return;
    if (video.paused) { userPaused = false; var p = video.play(); if (p && p.catch) p.catch(function () {}); } else { userPaused = true; video.pause(); }
  });
  if (reduced) video.removeAttribute('autoplay');

  // Try-it strip: type and erase example prompts.
  var tryEl = document.getElementById('try-text'), tryTimer = null, tryRun = 0;
  function startTry() {
    clearTimeout(tryTimer); var run = ++tryRun;
    var list = [t('try.p1'), t('try.p2'), t('try.p3')];
    if (reduced) { tryEl.textContent = list[0]; return; }
    var i = 0, n = 0, dir = 1;
    (function step() {
      if (run !== tryRun) return;
      var txt = list[i];
      n += dir; tryEl.textContent = txt.slice(0, n);
      var wait = 55 + Math.random() * 45;
      if (dir === 1 && n >= txt.length) { dir = -1; wait = 1900; }
      else if (dir === -1 && n <= 0) { dir = 1; i = (i + 1) % list.length; wait = 450; }
      else if (dir === -1) wait = 22;
      tryTimer = setTimeout(step, wait);
    })();
  }

  // Install blocks: copy the command. Clipboard API first, a hidden textarea as fallback.
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:-100px;opacity:0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      ok ? resolve() : reject();
    });
  }
  document.querySelectorAll('.copy-btn').forEach(function (b) {
    var box = b.parentNode, code = box.querySelector('.cmd-text'), live = box.querySelector('[aria-live]'), timer = null;
    b.addEventListener('click', function () {
      copyText(code.textContent.trim()).then(function () {
        b.textContent = t('install.copied'); live.textContent = t('install.copied');
        clearTimeout(timer);
        timer = setTimeout(function () { b.textContent = t('install.copy'); live.textContent = ''; }, 2000);
      }, function () {
        var r = document.createRange(); r.selectNodeContents(code);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      });
    });
  });

  // By-role demo: a mock app window that plays a scenario step by step. All text comes from copy.js (keys under "demo.").
  var ROLES = ['dev', 'mkt', 'pm', 'res'], NSTEP = 5;
  var dRole = 0, dStep = 0, dHint = true, dWidth = 0;
  var dm = {};
  ['body', 'flow', 'ws', 'sq', 'plus', 'sum', 'dots', 'prev', 'next', 'count', 'live', 'take', 'panel'].forEach(function (k) { dm[k] = document.getElementById('dm-' + k); });
  var dTabs = document.querySelectorAll('.demo-tabs [role="tab"]');

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  var WHO = { me: 'demo.me', maru: 'demo.maru', sess: 'demo.sess' };
  function msg(f, who, key) {
    var p = el('p', 'dm-msg dm-' + who);
    p.appendChild(el('span', 'dm-who', t(WHO[who])));
    p.appendChild(el('span', 'dm-txt', t(key)));
    f.appendChild(p);
  }
  function card(f, titleKey, tagKey) {
    var c = el('div', 'dm-card'), h = el('div', 'dm-card-h');
    h.appendChild(el('span', 'dm-card-t', t(titleKey)));
    if (tagKey) h.appendChild(el('span', 'dm-chip dm-chip-or', t(tagKey)));
    c.appendChild(h); f.appendChild(c); return c;
  }
  function hint(c, k) { c.appendChild(el('p', 'dm-hint', t(k))); }
  function btns(c, keys) {
    var b = el('div', 'dm-btns');
    keys.forEach(function (k, i) { b.appendChild(el('span', 'dm-btn' + (i === keys.length - 1 ? ' dm-btn-or' : ''), t(k))); });
    c.appendChild(b);
  }
  function kv(c, pairs) {
    var dl = el('dl', 'dm-kv');
    pairs.forEach(function (p) { dl.appendChild(el('dt', null, t(p[0]))); dl.appendChild(el('dd', null, t(p[1]))); });
    c.appendChild(dl);
  }
  function question(c, qKey) {
    var q = el('div', 'dm-q');
    q.appendChild(el('span', 'dm-q-l', t('demo.q')));
    q.appendChild(el('span', 'dm-q-t', t(qKey)));
    c.appendChild(q);
  }
  function rowsList(c, pairs) {
    var ul = el('ul', 'dm-rows');
    pairs.forEach(function (p) {
      var li = el('li'); li.appendChild(el('span', 'dm-chip', t(p[0]))); li.appendChild(el('span', null, t(p[1]))); ul.appendChild(li);
    });
    c.appendChild(ul);
  }
  // Overview: Maru's one-screen answer for all sessions. rows: [nameKey, statusKey, textKey]
  function overview(f, rows, qKey) {
    var c = card(f, 'demo.ov.title'), ul = el('ul', 'dm-ov');
    rows.forEach(function (r) {
      var li = el('li'), top = el('div', 'dm-ov-top');
      top.appendChild(el('span', 'dm-ov-n', t(r[0]))); top.appendChild(el('span', 'dm-chip dm-chip-or', t(r[1])));
      li.appendChild(top); li.appendChild(el('p', 'dm-ov-t', t(r[2]))); ul.appendChild(li);
    });
    c.appendChild(ul);
    if (qKey) question(c, qKey);
    hint(c, 'demo.ov.note');
  }
  function journalKv(c, ks) { kv(c, [['demo.j.done', ks[0]], ['demo.j.dec', ks[1]], ['demo.j.open', ks[2]]]); }

  function confirmCard(f) {
    var c = card(f, 'demo.dev.c.title');
    kv(c, [['demo.dev.c.fl', 'demo.dev.c.fv'], ['demo.dev.c.bl', 'demo.dev.c.bv']]);
    c.appendChild(el('p', 'dm-lab', t('demo.dev.c.tl')));
    var ul = el('ul', 'dm-radio');
    ['demo.dev.c.t0', 'demo.dev.c.t1', 'demo.dev.c.t2'].forEach(function (k, i) {
      var li = el('li', i === 1 ? 'on' : null), r = el('span', 'dm-r'); r.setAttribute('aria-hidden', 'true');
      li.appendChild(r); li.appendChild(el('span', null, t(k)));
      if (i === 1) li.appendChild(el('span', 'sr-only', ' (' + t('demo.selected') + ')'));
      ul.appendChild(li);
    });
    c.appendChild(ul);
    hint(c, 'demo.dev.c.hint'); hint(c, 'demo.one');
    btns(c, ['demo.cancel', 'demo.open']);
  }

  function calendar(f) {
    var c = card(f, 'demo.pm.s3.title'), w = el('div', 'dm-cal'), g = el('div', 'dm-grid');
    g.setAttribute('aria-hidden', 'true');
    t('demo.pm.dow').split(',').forEach(function (d) { g.appendChild(el('span', 'dm-dow', d)); });
    for (var i = 0; i < 3; i++) g.appendChild(el('span'));
    var dots = [3, 7, 10, 14, 17, 21, 24, 28];
    for (var d = 1; d <= 30; d++) g.appendChild(el('span', 'dm-day' + (dots.indexOf(d) >= 0 ? ' has' : '') + (d === 14 ? ' sel' : ''), String(d)));
    w.appendChild(el('p', 'sr-only', t('demo.pm.s3.sr')));
    w.appendChild(g);
    var det = el('div', 'dm-det');
    det.appendChild(el('p', 'dm-lab', t('demo.pm.s3.day')));
    var ul = el('ul', 'dm-rows');
    [['demo.pm.pa', 'demo.pm.s3.r1'], ['demo.pm.pb', 'demo.pm.s3.r2']].forEach(function (p) {
      var li = el('li'); li.appendChild(el('span', 'dm-chip', t(p[0]))); li.appendChild(el('span', null, t(p[1]))); ul.appendChild(li);
    });
    det.appendChild(ul);
    det.appendChild(el('p', 'dm-lab', t('demo.pm.s3.nl')));
    det.appendChild(el('p', 'dm-note', t('demo.pm.s3.note')));
    w.appendChild(det); c.appendChild(w);
  }

  function pmReport(f) {
    var c = card(f, 'demo.pm.s5.title', 'demo.unverified'), ul = el('ul', 'dm-proj');
    [['demo.pm.pa', ['demo.pm.a.d', 'demo.pm.a.c', 'demo.pm.a.o']], ['demo.pm.pb', ['demo.pm.b.d', 'demo.pm.b.c', 'demo.pm.b.o']], ['demo.pm.pc', ['demo.pm.c.d', 'demo.pm.c.c', 'demo.pm.c.o']]].forEach(function (p) {
      var li = el('li'); li.appendChild(el('span', 'dm-chip', t(p[0])));
      var d = el('div', 'dm-proj-b'); journalKv(d, p[1]); li.appendChild(d); ul.appendChild(li);
    });
    c.appendChild(ul);
    rowsList(c, [['demo.q', 'demo.pm.s5.q1'], ['demo.q', 'demo.pm.s5.q2']]);
    hint(c, 'demo.pm.s5.note');
  }

  function resTable(f) {
    var c = card(f, 'demo.res.s4.title', 'demo.unverified'), tb = el('table', 'dm-tb'), hd = el('tr');
    ['demo.res.th1', 'demo.res.th2', 'demo.res.th3'].forEach(function (k) { var h = el('th', null, t(k)); h.setAttribute('scope', 'col'); hd.appendChild(h); });
    var th = el('thead'); th.appendChild(hd); tb.appendChild(th);
    var body = el('tbody');
    [['demo.res.r1.o', 'demo.res.r1.p', true], ['demo.res.r2.o', 'demo.res.r2.p', false], ['demo.res.r3.o', 'demo.res.r3.p', false]].forEach(function (r) {
      var tr = el('tr'), o = el('th', null, t(r[0])); o.setAttribute('scope', 'row'); tr.appendChild(o); tr.appendChild(el('td', null, t(r[1])));
      var td = el('td'), s = el('span', 'dm-stt ' + (r[2] ? 'ok' : 'no')), m = el('span', null, r[2] ? '✓ ' : '! '); m.setAttribute('aria-hidden', 'true');
      s.appendChild(m); s.appendChild(document.createTextNode(t(r[2] ? 'demo.st.ok' : 'demo.st.no'))); td.appendChild(s); tr.appendChild(td); body.appendChild(tr);
    });
    tb.appendChild(body); c.appendChild(tb); hint(c, 'demo.res.s4.note');
  }

  function dialog(f, o) {
    var c = card(f, o.title, o.tag);
    if (o.rows) kv(c, o.rows);
    if (o.hint) hint(c, o.hint);
    btns(c, o.btns);
  }

  var SQ_DEV = 'demo.sq.dev', SQ_RES = 'demo.sq.res', SQ_NEWS = 'demo.sq.news';
  var SS_W = 'demo.ss.work', SS_T = 'demo.ss.turn', SS_R = 'demo.ss.rep';
  var DATA = {
    dev: {
      take: 'demo.dev.take', labels: ['demo.dev.l1', 'demo.dev.l2', 'demo.dev.l3', 'demo.dev.l4', 'demo.dev.l5'], sq: [SQ_DEV, SQ_RES],
      steps: [
        { flow: function (f) { msg(f, 'me', 'demo.dev.s1.me'); msg(f, 'maru', 'demo.dev.s1.maru'); } },
        { hl: [0, 'demo.selected'], flow: confirmCard },
        { hl: [0, 'demo.working'], sub: [['demo.dev.f1', SQ_DEV, SS_W], ['demo.dev.f2', null, SS_W], ['demo.dev.f3', null, SS_W]], flow: function (f) {
          msg(f, 'maru', 'demo.dev.s3.maru'); msg(f, 'sess', 'demo.dev.s3.sess');
          var c = card(f, 'demo.dev.s3.card');
          rowsList(c, [['demo.dev.m1.r', 'demo.dev.m1.t'], ['demo.dev.m2.r', 'demo.dev.m2.t']]); hint(c, 'demo.dev.s3.hint');
        } },
        { hl: [0, 'demo.reported'], sub: [['demo.dev.f1', SQ_DEV, SS_R], ['demo.dev.f2', null, SS_W], ['demo.dev.f3', null, SS_T]], flow: function (f) {
          msg(f, 'me', 'demo.ov.me');
          overview(f, [['demo.dev.f1', SS_R, 'demo.dev.s4.r1'], ['demo.dev.f2', SS_W, 'demo.dev.s4.r2'], ['demo.dev.f3', SS_T, 'demo.dev.s4.r3']], 'demo.dev.s4.q');
        } },
        { flow: function (f) {
          msg(f, 'me', 'demo.dev.s5.me'); msg(f, 'maru', 'demo.dev.s5.maru');
          var c = card(f, 'demo.dev.s5.title'); journalKv(c, ['demo.dev.s5.d', 'demo.dev.s5.c', 'demo.dev.s5.o']);
        } }
      ]
    },
    mkt: {
      take: 'demo.mkt.take', labels: ['demo.mkt.l1', 'demo.mkt.l2', 'demo.mkt.l3', 'demo.mkt.l4', 'demo.mkt.l5'], sq: [SQ_DEV, SQ_RES, SQ_NEWS],
      steps: [
        { sq: 2, plus: true, flow: function (f) { dialog(f, { title: 'demo.mkt.s1.title', rows: [['demo.mkt.s1.lbl', 'demo.mkt.s1.v']], hint: 'demo.mkt.s1.hint', btns: ['demo.cancel', 'demo.mkt.s1.go'] }); } },
        { hl: [2, 'demo.pending'], flow: function (f) { dialog(f, { title: 'demo.mkt.s2.title', tag: 'demo.mkt.s2.kind', rows: [['demo.mkt.s2.nm', 'demo.sq.news'], ['demo.mkt.s2.mem', 'demo.mkt.s2.memv']], hint: 'demo.mkt.s2.hint', btns: ['demo.reject', 'demo.approve'] }); } },
        { hl: [2, 'demo.working'], sub: [['demo.mkt.f1', 'demo.own', SS_W], ['demo.mkt.f2', null, SS_W], ['demo.mkt.f3', null, SS_W]], flow: function (f) {
          msg(f, 'me', 'demo.mkt.s3.me'); msg(f, 'maru', 'demo.mkt.s3.maru'); msg(f, 'sess', 'demo.mkt.s3.sess');
        } },
        { hl: [2, 'demo.reported'], sub: [['demo.mkt.f1', 'demo.own', SS_R], ['demo.mkt.f2', null, SS_W], ['demo.mkt.f3', null, SS_T]], flow: function (f) {
          msg(f, 'me', 'demo.ov.me'); msg(f, 'maru', 'demo.mkt.s4.maru');
          overview(f, [['demo.mkt.f1', SS_R, 'demo.mkt.s4.r1'], ['demo.mkt.f2', SS_W, 'demo.mkt.s4.r2'], ['demo.mkt.f3', SS_T, 'demo.mkt.s4.r3']], 'demo.mkt.s4.q');
        } },
        { flow: function (f) {
          msg(f, 'maru', 'demo.mkt.s5.maru');
          dialog(f, { title: 'demo.mkt.s5.title', tag: 'demo.mkt.s5.kind', rows: [['demo.mkt.s5.nl', 'demo.mkt.s5.nm']], hint: 'demo.mkt.s5.why', btns: ['demo.reject', 'demo.approve'] });
          msg(f, 'me', 'demo.mkt.s5.me');
        } }
      ]
    },
    pm: {
      take: 'demo.pm.take', labels: ['demo.pm.l1', 'demo.pm.l2', 'demo.pm.l3', 'demo.pm.l4', 'demo.pm.l5'], sq: [SQ_DEV, SQ_RES],
      steps: [
        { flow: function (f) { msg(f, 'me', 'demo.pm.s1.me'); msg(f, 'maru', 'demo.pm.s1.maru'); } },
        { sub: 'pm', flow: function (f) {
          msg(f, 'me', 'demo.ov.me'); msg(f, 'maru', 'demo.pm.s2.maru');
          overview(f, [['demo.pm.f1', SS_R, 'demo.pm.s2.r1'], ['demo.pm.f2', SS_W, 'demo.pm.s2.r2'], ['demo.pm.f3', SS_T, 'demo.pm.s2.r3']], 'demo.pm.s2.q');
        } },
        { sub: 'pm', flow: calendar },
        { sub: 'pm', flow: function (f) {
          msg(f, 'me', 'demo.pm.s4.me'); msg(f, 'maru', 'demo.pm.s4.maru');
          var c = card(f, 'demo.pm.s4.ct'); kv(c, [['demo.pm.pa', 'demo.pm.s4.cv']]);
        } },
        { sub: 'pm', flow: pmReport }
      ]
    },
    res: {
      take: 'demo.res.take', labels: ['demo.res.l1', 'demo.res.l2', 'demo.res.l3', 'demo.res.l4', 'demo.res.l5'], sq: [SQ_DEV, SQ_RES],
      steps: [
        { hl: [1, 'demo.working'], sub: [['demo.res.f1', SQ_RES, SS_W]], flow: function (f) {
          msg(f, 'me', 'demo.res.s1.me'); msg(f, 'maru', 'demo.res.s1.maru');
          var c = card(f, 'demo.res.s1.card'); rowsList(c, [['demo.res.m1.r', 'demo.res.m1.t'], ['demo.res.m2.r', 'demo.res.m2.t']]);
        } },
        { hl: [1, 'demo.working'], sub: [['demo.res.f1', SQ_RES, SS_W], ['demo.res.f2', SQ_RES, SS_W], ['demo.res.f3', null, SS_W]], flow: function (f) {
          msg(f, 'me', 'demo.res.s2.me'); msg(f, 'maru', 'demo.res.s2.maru');
          var c = card(f, 'demo.res.s2.card'); rowsList(c, [['demo.st.done', 'demo.res.s2.p1'], ['demo.st.doing', 'demo.res.s2.p2'], ['demo.st.wait', 'demo.res.s2.p3']]);
        } },
        { hl: [1, 'demo.reported'], sub: [['demo.res.f1', SQ_RES, SS_R], ['demo.res.f2', SQ_RES, SS_W], ['demo.res.f3', null, SS_T]], flow: function (f) {
          msg(f, 'me', 'demo.ov.me');
          overview(f, [['demo.res.f1', SS_R, 'demo.res.s3.r1'], ['demo.res.f2', SS_W, 'demo.res.s3.r2'], ['demo.res.f3', SS_T, 'demo.res.s3.r3']], 'demo.res.s3.q');
        } },
        { hl: [1, 'demo.reported'], sub: [['demo.res.f1', SQ_RES, SS_R], ['demo.res.f2', SQ_RES, SS_W], ['demo.res.f3', null, SS_T]], flow: function (f) { msg(f, 'maru', 'demo.res.s4.maru'); resTable(f); } },
        { hl: [1, 'demo.working'], sub: [['demo.res.f1', SQ_RES, SS_W], ['demo.res.f2', SQ_RES, SS_W], ['demo.res.f3', null, SS_T]], flow: function (f) {
          msg(f, 'me', 'demo.res.s5.me'); msg(f, 'maru', 'demo.res.s5.maru');
          var c = card(f, 'demo.res.s5.card'); rowsList(c, [['demo.res.r2.o', 'demo.st.wait'], ['demo.res.r3.o', 'demo.st.wait']]); hint(c, 'demo.res.s5.hint');
        } }
      ]
    }
  };
  var PM_SUB = [['demo.pm.f1', null, SS_R], ['demo.pm.f2', null, SS_W], ['demo.pm.f3', null, SS_T]];
  function subOf(s) { return s.sub === 'pm' ? PM_SUB : (s.sub || []); }

  function renderStep() {
    var D = DATA[ROLES[dRole]], s = D.steps[dStep], sub = subOf(s);
    clear(dm.flow); s.flow(dm.flow);
    clear(dm.ws);
    var m = el('li', 'dm-row' + (sub.length ? '' : ' on')); m.appendChild(el('span', 'dm-dot' + (sub.length ? '' : ' on'))); m.appendChild(el('span', 'dm-rn', t('demo.maru'))); dm.ws.appendChild(m);
    sub.forEach(function (r) {
      var li = el('li', 'dm-row dm-child'), b = el('div', 'dm-rb');
      b.appendChild(el('span', 'dm-rn', t(r[0])));
      if (r[1]) b.appendChild(el('span', 'dm-chip', t(r[1])));
      b.appendChild(el('span', 'dm-rs', t(r[2])));
      li.appendChild(b); dm.ws.appendChild(li);
    });
    clear(dm.sq);
    var n = s.sq || D.sq.length;
    for (var i = 0; i < n; i++) {
      var on = s.hl && s.hl[0] === i, li2 = el('li', 'dm-sqi' + (on ? ' on' : ''));
      li2.appendChild(el('span', 'dm-rn', t(D.sq[i])));
      li2.appendChild(el('span', 'dm-sqt', t(D.sq[i] === SQ_NEWS ? 'demo.own' : 'demo.builtin')));
      if (on) li2.appendChild(el('span', 'dm-sqs', t(s.hl[1])));
      dm.sq.appendChild(li2);
    }
    dm.plus.classList.toggle('on', !!s.plus);
    var txt = t('demo.ws') + ': ' + t('demo.maru');
    if (sub.length) txt += ' › ' + sub.map(function (r) { return t(r[0]); }).join(', ');
    if (s.hl) txt += ' · ' + t('demo.squads') + ': ' + t(D.sq[s.hl[0]]);
    dm.sum.textContent = txt;
  }

  function renderChrome() {
    var D = DATA[ROLES[dRole]];
    dTabs.forEach(function (b, i) { var on = i === dRole; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    dm.panel.setAttribute('aria-labelledby', 'dt-' + ROLES[dRole]);
    dm.take.textContent = t(D.take);
    Array.prototype.forEach.call(dm.dots.querySelectorAll('button'), function (b, i) {
      var label = t(D.labels[i]);
      b.querySelector('.l').textContent = label;
      b.setAttribute('aria-label', t('demo.stepword') + ' ' + (i + 1) + ': ' + label);
      if (i === dStep) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    dm.prev.setAttribute('aria-disabled', dStep === 0 ? 'true' : 'false');
    dm.next.textContent = t(dStep === NSTEP - 1 ? 'demo.restart' : 'demo.next');
    dm.next.classList.toggle('is-hint', dHint);
    dm.count.textContent = (dStep + 1) + ' / ' + NSTEP;
  }

  function measure() {
    var r0 = dRole, s0 = dStep, max = 0, tmax = 0;
    dm.body.style.minHeight = '0'; dm.take.style.minHeight = '0';
    for (var r = 0; r < ROLES.length; r++) {
      dRole = r; dm.take.textContent = t(DATA[ROLES[r]].take); tmax = Math.max(tmax, dm.take.offsetHeight);
      for (var s = 0; s < NSTEP; s++) { dStep = s; renderStep(); max = Math.max(max, dm.body.offsetHeight); }
    }
    dRole = r0; dStep = s0; renderStep(); renderChrome();
    dm.body.style.minHeight = max + 'px'; dm.take.style.minHeight = tmax + 'px';
    dWidth = window.innerWidth;
  }

  function demoApply() { renderChrome(); measure(); }

  function setStep(n, announce) {
    dStep = Math.max(0, Math.min(NSTEP - 1, n)); dHint = false;
    renderStep(); renderChrome();
    if (!reduced) { dm.flow.classList.remove('dm-in'); void dm.flow.offsetWidth; dm.flow.classList.add('dm-in'); }
    if (announce) dm.live.textContent = t('demo.stepword') + ' ' + (dStep + 1) + '/' + NSTEP + ': ' + t(DATA[ROLES[dRole]].labels[dStep]);
  }
  function setRole(i, focus) {
    dRole = i; dStep = 0; dHint = false;
    renderStep(); renderChrome();
    if (!reduced) { dm.flow.classList.remove('dm-in'); void dm.flow.offsetWidth; dm.flow.classList.add('dm-in'); }
    if (focus) dTabs[i].focus();
  }
  dTabs.forEach(function (b, i) {
    b.addEventListener('click', function () { setRole(i, false); });
    b.addEventListener('keydown', function (e) {
      var n = i;
      if (e.key === 'ArrowRight') n = (i + 1) % dTabs.length;
      else if (e.key === 'ArrowLeft') n = (i + dTabs.length - 1) % dTabs.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = dTabs.length - 1;
      else return;
      e.preventDefault(); setRole(n, true);
    });
  });
  Array.prototype.forEach.call(dm.dots.querySelectorAll('button'), function (b, i) { b.addEventListener('click', function () { setStep(i, true); }); });
  dm.prev.addEventListener('click', function () { if (dStep > 0) setStep(dStep - 1, true); });
  dm.next.addEventListener('click', function () { setStep(dStep === NSTEP - 1 ? 0 : dStep + 1, true); });
  var dTimer = null;
  window.addEventListener('resize', function () { clearTimeout(dTimer); dTimer = setTimeout(function () { if (window.innerWidth !== dWidth) measure(); }, 150); });

  apply();
  startTry();

  // Scroll reveal.
  var els = document.querySelectorAll('.reveal');
  if (reduced || !('IntersectionObserver' in window)) {
    els.forEach(function (e) { e.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach(function (e) { io.observe(e); });
  }
})();
