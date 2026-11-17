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
