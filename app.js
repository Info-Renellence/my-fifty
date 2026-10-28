/* Pulse (the rep phone app; "My Fifty" is the name of the customer list in it). Screens follow "Edge – Final Mockup (2)"
   (F1-F29, the dark design of 2026-10-27). Plain JS, no build step. Every read is GET /api/data?op=..., every write
   POST /api/act { op }. Sign-in is Supabase Auth with Google (@renellence.com). Avatars come from avatars.js. */
(function () {
  'use strict';

  // ---- basics ------------------------------------------------------------------------------------
  var $app = document.getElementById('app');
  var $sheet = document.getElementById('sheet');
  var sb = null, session = null, ME = null, BOOT = null, CONFIG = null;
  var cache = {};

  // No zooming (Yousef 2026-10-21). iPhone Safari ignores user-scalable=no, so pinch gestures and two-finger moves are
  // stopped here too; double-tap zoom is off through touch-action in app.css.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) { document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false }); });
  document.addEventListener('touchmove', function (e) { if (e.touches.length > 1 && e.cancelable) e.preventDefault(); }, { passive: false });

  // Pure helpers live in lib.js (unit tested in test/unit/lib.test.js).
  var L = window.MFLib;
  var esc = L.esc, nb = L.nb, ymd = L.ymd, addDays = L.addDays, shortDate = L.shortDate, errText = L.errText;
  var AV = window.PulseAv.av;
  // Avatar state for the motion prototype (avatar-motion.css): going cold shivers, My Fifty shimmers, candidates peek,
  // new leads wave, waiting on something taps. Only classes; nothing moves without avatar-motion.css.
  function avState(o) {
    o = o || {};
    var s = [];
    if (o.goingCold || o.coldDays >= 30 || o.tag === 'Going cold' || o.cold) s.push('st-cold');
    if (o.stage === 'fifty') s.push('st-fifty');
    if (o.stage === 'candidate') s.push('st-cand');
    if (o.isNew || o.newThisWeek || o.fresh) s.push('st-new');
    if (o.status && /^Waiting/.test(o.status.label || '')) s.push('st-wait');
    if (/^(ordered|thawed|asleep)$/.test(o.mood || '')) s.push('st-' + o.mood);   // api/data.js moodOf (owner 2026-10-28)
    return s.join(' ');
  }
  // A plain toast, or Today's "+1" toast with the gold chip (F2).
  function toast(msg, plus) {
    var t = document.getElementById('toast');
    t.className = plus ? 'plus' : '';
    t.innerHTML = (plus ? '<span class="p1">' + esc(plus) + '</span>' : '') + '<span>' + esc(msg) + '</span>';
    void t.offsetWidth; t.classList.add('on');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('on'); }, plus ? 1800 : 2600);
  }

  // ---- talking to the server -----------------------------------------------------------------------
  function token() { return session && session.access_token; }
  function api(op, params) {
    var qs = new URLSearchParams(Object.assign({ op: op }, params || {})).toString();
    return fetch('/api/data?' + qs, { headers: { Authorization: 'Bearer ' + token() } }).then(answer);
  }
  function act(op, body) {
    return fetch('/api/act', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
      body: JSON.stringify(Object.assign({ op: op }, body || {})) }).then(answer).then(function (r) { cache = {}; return r; });
  }
  function answer(r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (r.status === 401) { signOutLocal(); throw new Error('signed_out'); }
      if (!r.ok) { var e = new Error(j.error || 'server_error'); e.detail = j.detail; throw e; }
      return j;
    });
  }
  // Read with a short-lived cache so going back is instant; any write clears it. An answer is reused for a minute at
  // most, and never after the app comes back to the front (a phone keeps the app open for days).
  var CACHE_MS = 60000;
  function read(op, params) {
    var k = op + JSON.stringify(params || {});
    if (cache[k] && Date.now() - cache[k].at < CACHE_MS) return Promise.resolve(cache[k].j);
    return api(op, params).then(function (j) { cache[k] = { at: Date.now(), j: j }; return j; });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) cache = {}; });
  function localStorageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

  // ---- icons (paths from the mockup) ---------------------------------------------------------------
  var P = {
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    text: '<path d="M4 5h16v11H9l-5 4z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    box: '<path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5M12 12v9"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pinned: '<path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z"/>',
    flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
    gift: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M12 8c-2-4-6-4-6-1.5S9 8 12 8c3 0 6 .5 6-1.5S14 4 12 8z"/>',
    today: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
    people: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8"/>',
    redo: '<path d="M4 4v6h6"/><path d="M20 12a8 8 0 0 0-14.9-4L4 10M4 12a8 8 0 0 0 14.9 4"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    star: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
    // lead groups (F6, F19-F22, F29)
    social: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="0.8" fill="currentColor"/>',
    event: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M12 13.5l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z"/>',
    warm: '<path d="M12 21s-7.5-4.6-7.5-10.4A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7.5 2.6C19.5 16.4 12 21 12 21z"/>',
    cold: '<path d="M12 2v20M4 7l16 10M20 7L4 17"/><path d="M9 3.5L12 6l3-2.5M9 20.5L12 18l3 2.5"/>',
    onboarded: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 15.5l2 2 4.5-4.5"/>',
    // product thumbnails (F9)
    syringe: '<path d="M18 2l4 4M17 7l3-3M19 9l-8.7 8.7a2 2 0 0 1-1.4.6H6v-2.9a2 2 0 0 1 .6-1.4L15 5M9 11l4 4M2 22l4-4"/>',
    needle: '<path d="M3 21l7-7M14 4l6 6M12 6l6 6-6.5 6.5a2 2 0 0 1-2.8 0L6.5 16.3a2 2 0 0 1 0-2.8z"/>',
    drop: '<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>',
  };
  function ic(name, size, width, extra) {
    var z = size || 16;
    return '<svg width="' + z + '" height="' + z + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (width || (z >= 20 ? 1.6 : 1.8))
      + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + P[name] + '</svg>';
  }
  var FLAME_D = 'M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-6 1-9.5z';
  function flame(size, fill) { return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="' + (fill || 'currentColor') + '" aria-hidden="true"><path d="' + FLAME_D + '"/></svg>'; }
  // The gold coin (F11, F26). One gradient definition on the page, used by every coin.
  var COIN_DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF1B8"/><stop offset=".5" stop-color="#F7C948"/><stop offset="1" stop-color="#D9900F"/></linearGradient></defs></svg>';
  function coin(size) {
    return '<svg class="coin" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="url(#cg)"/>'
      + '<circle cx="12" cy="12" r="7.2" fill="none" stroke="#B9770E" stroke-opacity="0.55" stroke-width="1.2"/>'
      + '<path d="M12 7.6v8.8M14.3 9.4c-.5-.7-1.3-1-2.3-1-1.3 0-2.2.7-2.2 1.6 0 2.2 4.6 1.2 4.6 3.6 0 1-1 1.8-2.4 1.8-1.1 0-2-.4-2.5-1.2" fill="none" stroke="#7A4A05" stroke-width="1.6" stroke-linecap="round"/></svg>';
  }

  // ---- shared pieces ---------------------------------------------------------------------------------
  function tabs(on) {
    function t(href, key, icon, label) {
      return '<a href="' + href + '" data-nav class="' + (on === key ? 'on' : '') + '"' + (on === key ? ' aria-current="page"' : '') + '>' + icon + label + '</a>';
    }
    return '<nav class="tabs" aria-label="Main">'
      + t('/', 'today', ic('today', 25, 1.5), 'Today')
      + t('/people', 'people', ic('people', 25, 1.5), 'People')
      + t('/order', 'order', '<span class="plus">' + ic('plus', 18, 2.4) + '</span>', 'Order')
      + t('/rewards', 'rewards', ic('trophy', 25, 1.5), 'Rewards')
      + '</nav>';
  }
  function backLink(href, label) { return '<a href="' + esc(href) + '" data-nav class="back">' + ic('back', 18, 1.8) + esc(label) + '</a>'; }
  function sect(left, right, color) {
    return '<div class="sect"><span class="kicker"' + (color ? ' style="color:' + color + '"' : '') + '>' + esc(left) + '</span>' + (right ? '<span class="r">' + right + '</span>' : '') + '</div>';
  }
  var CHEV = '<span class="chev">' + ic('chev', 15, 1.8) + '</span>';
  function empty(icon, text, sub, extra) {
    return '<section class="empty"' + (extra ? ' style="' + extra + '"' : '') + '><span class="ico">' + ic(icon, 18) + '</span><span class="t">' + esc(text)
      + (sub ? '<span class="s">' + esc(sub) + '</span>' : '') + '</span></section>';
  }
  function skeleton(kind) {
    var head = '<span class="sk line" style="width:40%;margin:8px 4px 10px"></span><span class="sk" style="display:block;width:45%;height:36px;margin:0 4px 16px"></span>';
    if (kind === 'today') return head + '<span class="sk tile" style="display:block;height:196px;margin:30px 0 14px;border-radius:22px"></span>'
      + '<span class="sk" style="display:block;height:46px;margin-bottom:12px"></span><span class="sk tile" style="display:block;height:320px"></span>';
    if (kind === 'card') return '<span class="sk line" style="width:24%;margin:4px 4px 14px"></span><span class="sk tile" style="display:block;height:196px;margin-bottom:14px;border-radius:26px"></span>'
      + '<div style="display:flex;justify-content:space-around;margin-bottom:14px"><span class="sk" style="width:54px;height:54px;border-radius:50%"></span><span class="sk" style="width:54px;height:54px;border-radius:50%"></span><span class="sk" style="width:54px;height:54px;border-radius:50%"></span><span class="sk" style="width:54px;height:54px;border-radius:50%"></span></div>'
      + '<span class="sk" style="display:block;height:156px"></span>';
    return head + '<span class="sk tile" style="display:block;height:360px"></span>';
  }
  function loading(kind) { return '<div class="scr" aria-busy="true" aria-label="Loading">' + skeleton(kind) + '</div>'; }
  function failed(e) {
    return '<div class="scr" style="align-items:center;justify-content:center;gap:14px;text-align:center">'
      + '<span class="round">' + ic('redo', 22) + '</span>'
      + '<span style="font-size:17px;font-weight:600;max-width:300px">' + esc(errText(e)) + '</span><button type="button" data-reload class="pillbtn blue" style="height:44px;padding:0 22px">Try again</button></div>';
  }
  // The role avatar with the small Fifty dot in its corner (F6 rows).
  function avDot(role, name, size, kind, pid) {
    return '<span class="avwrap">' + AV(role, name, size, avState({ stage: 'fifty', cold: kind === 'cold' }), pid) + '<span class="badge"><span class="dot ' + kind + '" style="width:10px;height:10px"></span></span></span>';
  }

  // ---- router ------------------------------------------------------------------------------------------
  var ROUTES = [
    [/^\/$/, function () { return screenToday(); }],
    [/^\/people$/, function () { return screenPeople(); }],
    // The Today My Fifty tile (owner 2026-10-27): People, always on the My Fifty tab, whatever tab was open last.
    [/^\/people\/fifty$/, function () { peopleView = 'fifty'; history.replaceState({}, '', '/people'); return screenPeople(); }],
    [/^\/people\/leads\/(onboarded|social|event|warm|cold)$/, function (m) { return screenLeads(m[1]); }],
    [/^\/person\/([0-9a-f-]{36})$/, function (m) { return screenPerson(m[1]); }],
    [/^\/person\/([0-9a-f-]{36})\/history$/, function (m) { return screenHistory(m[1]); }],
    [/^\/person\/([0-9a-f-]{36})\/onboarding$/, function (m) { return screenOnboarding(m[1]); }],
    [/^\/order$/, function () { return screenWho(); }],
    [/^\/order\/([0-9a-f-]{36})$/, function (m) { return screenProducts(m[1]); }],
    [/^\/order\/([0-9a-f-]{36})\/review$/, function (m) { return screenReview(m[1]); }],
    [/^\/orders\/([0-9a-f-]{36})$/, function (m) { return screenOrderStatus(m[1]); }],
    [/^\/rewards$/, function () { return screenRewards(); }],
    [/^\/rewards\/wins$/, function () { return screenWins(); }],
  ];
  function go(path, replace) {
    if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path);
    render();
  }
  function render() {
    closeSheet();
    var path = location.pathname.replace(/\/+$/, '') || '/';
    for (var i = 0; i < ROUTES.length; i++) {
      var m = path.match(ROUTES[i][0]);
      if (m) { window.scrollTo(0, 0); return ROUTES[i][1](m); }
    }
    go('/', true);
  }
  // Paints a screen: shows a skeleton only if loading is slow, then the HTML. Only the newest screen asked for may
  // paint: a slow answer for a screen the rep already left is dropped.
  var paintSeq = 0;
  function paint(promise, view, tab, sk) {
    var mine = ++paintSeq;
    var t = setTimeout(function () { if (mine !== paintSeq) return; $app.innerHTML = loading(sk) + (tab ? tabs(tab) : ''); }, 120);
    return promise.then(function (data) {
      clearTimeout(t);
      if (mine !== paintSeq) return data;
      $app.innerHTML = view(data) + (tab ? tabs(tab) : '');
      return data;
    }, function (e) {
      clearTimeout(t);
      if (mine !== paintSeq) return;
      if (e.message === 'signed_out') return;
      $app.innerHTML = failed(e) + (tab ? tabs(tab) : '');
    });
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-nav]');
    if (a && a.getAttribute('href') && a.getAttribute('href').charAt(0) === '/') {
      e.preventDefault();
      go(a.getAttribute('href'));
      return;
    }
    if (e.target.closest('[data-reload]')) { cache = {}; render(); }
  });
  window.addEventListener('popstate', render);

  // ---- F2 Today -----------------------------------------------------------------------------------------
  // Two tiles (streak, My Fifty), then Visits and Calls: the day's list split by what to do, with the visits and calls
  // agreed at the weekly 1-on-1 (Compass) mixed in. Logged today folds away under the list.
  var todayTab = 'visit', todayShowDone = false, todayData = null;
  var cap = function (s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
  function todayRows(d) {
    var rows = { visit: [], call: [] }, seen = {};
    d.list.forEach(function (x) {
      var k = x.action === 'visit' ? 'visit' : 'call';
      seen[k + x.id] = rows[k].length;
      rows[k].push({ id: x.id, name: x.name, role: x.role, stage: x.stage, why: cap(x.detail), kind: k, taskId: x.taskId, coldDays: x.why === 'going_cold' ? parseInt(String(x.detail).replace(/\D+/g, ''), 10) : 0 });
    });
    var missed = [];
    if (d.week) {
      [['visit', d.week.visits], ['call', d.week.calls]].forEach(function (g) {
        g[1].forEach(function (p) {
          if (p.state === 'missed') { missed.push(p); return; }
          if (p.state !== 'open') return;
          var at = seen[g[0] + p.contactId];
          if (at != null) { if (p.purpose) rows[g[0]][at].why = p.purpose; rows[g[0]][at].pickId = p.id; return; }
          seen[g[0] + p.contactId] = rows[g[0]].length;
          rows[g[0]].push({ id: p.contactId, name: p.name, role: p.role, why: p.purpose || 'From your 1-on-1', kind: g[0], pickId: p.id });
        });
      });
    }
    // Logged today drops off the open rows (the list already leaves out people reached today; a 1-on-1 pick may not).
    var doneIds = {};
    d.done.forEach(function (x) { doneIds[(x.kind === 'visit' ? 'visit' : 'call') + x.id] = true; });
    rows.visit = rows.visit.filter(function (r) { return !doneIds['visit' + r.id]; });
    rows.call = rows.call.filter(function (r) { return !doneIds['call' + r.id]; });
    var done = { visit: d.done.filter(function (x) { return x.kind === 'visit'; }), call: d.done.filter(function (x) { return x.kind !== 'visit'; }) };
    return { rows: rows, done: done, missed: missed };
  }
  // F2d (Final Mockup (3), owner 2026-10-28): one progress panel, the streak over My Fifty, with Nell and her line.
  function todayPanel(day, f, perfect) {
    var goal = day.goal, n = day.done, met = n >= goal, toNext = Math.max(0, f.next - f.count);
    var circles = (day.week || []).map(function (w) {
      var c, on = w.state === 'today' || w.state === 'met';
      if (w.state === 'today' && perfect) c = '<span class="tp-d perfect">' + flame(13) + '</span>';
      else if (w.state === 'met' || (w.state === 'today' && met)) c = '<span class="tp-d saved">' + flame(13) + '</span>';
      else if (w.state === 'today') {
        var deg = Math.round(Math.min(n, goal) / goal * 360);
        c = '<span class="tp-d ring" style="background:conic-gradient(#F7C948 0 ' + deg + 'deg, rgba(255,255,255,0.12) ' + deg + 'deg 360deg)"><span class="num">' + n + '/' + goal + '</span></span>';
      } else c = '<span class="tp-d off"></span>';
      return '<span class="tp-dw">' + c + '<span class="tp-dl' + (on ? ' on' : '') + '">' + w.label + '</span></span>';
    }).join('');
    var say = perfect ? 'Perfect day! 🔥' : met ? 'Streak saved! 🎉' : (goal - n) + ' more ' + (day.streak ? 'saves your streak!' : 'starts a streak!');
    var fill = Math.round(Math.min(1, f.next ? f.count / f.next : 0) * 100);
    return '<div class="tp-wrap"><div class="tp" aria-label="' + day.streak + ' day streak, ' + n + ' of ' + goal + ' today. ' + f.count + ' in My Fifty">'
      + '<span class="tp-glow" aria-hidden="true"></span><div class="tp-col">'
      + '<div class="tp-streak"><span class="tp-row">' + flame(22, 'url(#pfl)') + '<span class="tp-n num">' + day.streak + '</span><span class="tp-w">day streak</span></span>'
      + '<span class="tp-days">' + circles + '</span></div>'
      + '<span class="tp-hr"></span>'
      + '<a href="/people/fifty" data-nav class="tp-fifty' + (fiftyUp(f.count) ? ' fifty-up' : '') + '" aria-label="' + f.count + ' in My Fifty, ' + toNext + ' more to reach ' + f.next + '">'
      + '<span class="tp-row"><span style="color:#62B2F7;display:flex">' + ic('target', 22, 2) + '</span><span class="tp-n num">' + f.count + '</span><span class="tp-w">in My Fifty</span></span>'
      + '<span class="tp-bar"><span style="width:' + fill + '%"></span></span><span class="tp-next">' + toNext + ' more to reach ' + f.next + '</span></a></div></div>'
      + '<img class="nl-idle" src="/nell/idle.webp" alt="" aria-hidden="true" width="172" height="228">'
      + '<div class="tp-say" role="status">' + esc(say) + '</div></div>';
  }
  function screenToday() {
    return paint(read('today'), function (d) {
      todayData = d;
      var t = todayRows(d), rows = t.rows, dn = t.done;
      var perfect = !rows.visit.length && !rows.call.length && (dn.visit.length + dn.call.length) > 0;
      var dateLine = L.longDate(d.date).toUpperCase();
      var h = '<div class="scr today">'
        + '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFB020"/><stop offset="1" stop-color="#D9640C"/></linearGradient>'
          + '<linearGradient id="pfl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFC531"/><stop offset="0.55" stop-color="#FF7A00"/><stop offset="1" stop-color="#E0310B"/></linearGradient></defs></svg>'
        + '<div class="head"><span style="display:flex;flex-direction:column"><span class="date">' + esc(dateLine) + '</span><h1 class="h1">Today</h1></span>'
        + '<button type="button" data-me class="me num" aria-label="Signed in as ' + esc(ME.name || '') + '. Open to sign out" aria-haspopup="dialog">' + esc(ME.initials) + '</button></div>'
        + (d.week ? weekFocus(d.week) : '')
        + todayPanel(d.day, d.fifty, perfect)
        + '<div class="seg big" role="tablist">' + [['visit', 'Visits'], ['call', 'Calls']].map(function (k) {
          var on = todayTab === k[0], n = dn[k[0]].length, of = n + rows[k[0]].length;
          return '<button type="button" role="tab" aria-selected="' + on + '" data-ttab="' + k[0] + '"' + (on ? ' class="on"' : '') + '>' + k[1]
            + '<span class="cnt num">' + n + '/' + of + '</span></button>';
        }).join('') + '</div>';
      var open = rows[todayTab], done = dn[todayTab];
      var missed = todayTab === 'visit' ? t.missed : [];
      h += '<section class="card r18 tlist">';
      if (!open.length && !done.length && !missed.length) {
        h += '<div class="row" style="min-height:76px"><span class="round">' + ic(todayTab === 'visit' ? 'pin' : 'phone', 18) + '</span><span class="grow"><span class="t">'
          + (todayTab === 'visit' ? 'No visits on your list' : 'No calls on your list') + '</span><span class="sub">New leads, follow-ups and people going cold show up here.</span></span></div>';
      }
      open.forEach(function (r) {
        h += '<div class="row trow">'
          + '<a href="/person/' + r.id + '" data-nav data-avtap aria-hidden="true" tabindex="-1">' + AV(r.role, r.name, 40, avState(r), r.id) + '</a>'
          + '<a href="/person/' + r.id + '" data-nav class="grow"><span class="t ellip">' + esc(r.name) + '</span><span class="sub ellip">' + esc(r.why) + '</span></a>'
          + '<button type="button" class="round" data-tlog="' + r.id + '" data-kind="' + r.kind + '"' + (r.pickId ? ' data-pick="' + r.pickId + '"' : '')
          + ' aria-label="' + (r.kind === 'visit' ? 'Log a visit with ' : 'Call ') + esc(r.name) + '">' + ic(r.kind === 'visit' ? 'pin' : 'phone', 18) + '</button></div>';
      });
      if (done.length || missed.length) {
        h += '<button type="button" class="donebar" data-tdone aria-expanded="' + todayShowDone + '"><span class="goldchk">' + ic('check', 13, 3) + '</span>'
          + '<span style="flex:1;text-align:left;color:var(--ink)">' + (done.length + missed.length) + ' done</span><span style="font-size:13px">' + (todayShowDone ? 'Hide' : 'Show') + '</span></button>';
        if (todayShowDone) {
          done.forEach(function (x) {
            // A logged row opens the person (owner 2026-10-28), as the open rows do.
            h += '<a href="/person/' + x.id + '" data-nav class="drow"><span class="grow"><span class="dn">' + esc(x.name) + '</span><span class="dw">' + (x.kind === 'visit' ? (x.video ? 'Video visit' : 'Visit') : x.kind === 'text' ? 'Text' : 'Call') + ' · ' + timeOf(x.at) + '</span></span><span class="logged">Logged</span></a>';
          });
          missed.forEach(function (p) {
            h += '<div class="drow"><a href="/person/' + p.contactId + '" data-nav class="grow"><span class="dn">' + esc(p.name) + '</span><span class="dw">Visit · missed' + (p.when ? ' ' + esc(p.when) : '') + '</span></a>'
              + '<button type="button" class="link" data-unmissed="' + p.id + '" style="font-size:13px;min-height:36px">Undo</button></div>';
          });
        }
      }
      h += '</section>' + pushPrompt() + '</div>';
      setTimeout(function () { nellPreload(); nellNudge(d); }, 400);
      return h;
    }, 'today', 'today');
  }
  function timeOf(at) { return new Date(at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }).replace(/\s?([ap])\.?m\.?/i, function (m, x) { return ' ' + x.toUpperCase() + 'M'; }); }

  // ---- Celebrations: a new My Fifty account glows once on this phone -----------------------------------------
  function fiftyUp(count) {
    var prev = parseInt(localStorageGet('pulse-fifty-seen'), 10);
    localStorageSet('pulse-fifty-seen', String(count));
    return !isNaN(prev) && count > prev;
  }

  // ---- The week (Compass): set in the weekly 1-on-1. The focus line and "Confirm my week" until it is confirmed. ----
  var weekJustConfirmed = false;
  function weekFocus(w) {
    if (!w.focus && w.confirmed) return '';
    var pop = weekJustConfirmed; weekJustConfirmed = false;
    return '<section class="card r18 focus">'
      + '<span class="round" style="width:38px;height:38px;border-radius:12px">' + ic('target', 18) + '</span>'
      + '<span class="grow"><span class="kicker" style="color:var(--sky)">This week’s focus</span><span class="t">' + esc(w.focus ? (w.focus.line || w.focus.name) : 'Your week') + '</span>'
      + '<span class="sub">' + esc(w.counts) + '</span></span>'
      + (w.confirmed ? '<span class="tag green' + (pop ? ' pop' : '') + '">' + ic('check', 12, 3) + ' Confirmed</span>'
        : '<button type="button" data-confirm-week class="pillbtn blue">Confirm</button>')
      + '</section>';
  }
  $app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-confirm-week]');
    if (b) {
      b.disabled = true;
      act('confirm_week').then(function () { weekJustConfirmed = true; toast('Week confirmed'); screenToday(); }, function (err) { b.disabled = false; toast(errText(err)); });
      return;
    }
    b = e.target.closest('[data-unmissed]');
    if (b) {
      b.disabled = true;
      act('visit_missed', { pickId: b.getAttribute('data-unmissed'), undo: true }).then(function () { toast('Undone'); screenToday(); }, function (err) { b.disabled = false; toast(errText(err)); });
      return;
    }
    b = e.target.closest('[data-ttab]');
    if (b) { todayTab = b.getAttribute('data-ttab'); screenToday(); return; }
    if (e.target.closest('[data-tdone]')) { todayShowDone = !todayShowDone; screenToday(); return; }
    b = e.target.closest('[data-tlog]');
    if (b) {
      var id = b.getAttribute('data-tlog'), kind = b.getAttribute('data-kind'), pick = b.getAttribute('data-pick');
      var row = todayData && todayRows(todayData).rows[kind].filter(function (r) { return r.id === id; })[0];
      if (kind === 'call') callOrText(id, 'call', { today: row, pickId: pick });
      else openLog(id, 'visit', { today: row, pickId: pick });
    }
  });

  // ---- F3 / F28 Log it ----------------------------------------------------------------------------------------
  // Reached or not, then a quick note (said, or typed when voice is off). The follow-up is tomorrow unless the voice
  // note names a day. ctx.today = the Today row it came from (Today shows the "+1" instead of the full win screen).
  function openLog(contactId, kind, ctx) {
    read('person', { id: contactId }).then(function (p) { logSheet(p, kind, ctx || {}); }, function (err) { toast(errText(err)); });
  }
  function logSheet(p, kind, ctx) {
    var st = { kind: kind || 'call', ans: null, follow: 'tomorrow', note: '', typing: false, rec: null, busy: false, aiOutputId: null, secs: 0 };
    var isV = st.kind === 'visit';
    var Q = isV ? 'Did the visit happen?' : st.kind === 'text' ? 'Did they answer?' : 'Did you reach them?';
    var YES = isV ? 'Visited' : 'Reached', NO = isV ? 'Did not connect' : 'No reply';
    function draw() {
      var ready = st.ans && st.note.trim().length > 1 && !st.busy && (st.rec === null);
      var box = '';
      if (st.ans) {
        if (st.typing) {
          box = '<div class="notebox typing"><textarea class="note" data-note rows="3" placeholder="What happened? Add a line starting Next: for the next step">' + esc(st.note) + '</textarea>'
            + (BOOT.voice ? '<button type="button" data-mic class="mic" aria-label="Say it instead">' + ic('mic', 20, 2) + '</button>' : '') + '</div>';
        } else {
          var recording = st.rec === 'on', working = st.rec === 'working', has = !!st.note.trim();
          var title = working ? 'Writing it up…' : recording ? 'Listening… 0:' + String(st.secs).padStart(2, '0') : has ? 'Note added' : 'Add a quick note';
          var sub = working ? 'One moment' : recording ? 'Tap to stop' : has ? '“' + st.note.split('\n')[0].slice(0, 60) + '”' : BOOT.voice ? 'Tap and say what happened' : 'Tap and type what happened';
          box = '<button type="button" class="notebox' + (recording ? ' rec' : '') + '" data-notebox>'
            + '<span class="mic' + (has && !recording ? ' done' : '') + '">' + (working ? '<span class="spin" style="width:18px;height:18px;border-width:2.5px;border-color:rgba(255,255,255,.3);border-top-color:#fff"></span>' : ic('mic', 22, 2)) + '</span>'
            + '<span class="grow"><span class="nt">' + esc(title) + '</span><span class="sub">' + esc(sub) + '</span></span></button>';
        }
        box += '<button type="button" data-save class="btn' + (ready ? '' : ' off') + '"' + (ready ? '' : ' aria-disabled="true"') + '>' + (st.busy ? 'Saving…' : 'Save') + '</button>';
      }
      $sheet.innerHTML = '<div class="dim" data-close></div><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(Q) + '">'
        + '<span class="grab"></span>'
        + '<div class="sheet-head"><span style="display:flex;flex-direction:column;gap:2px;min-width:0">'
        + '<span style="display:flex;align-items:center;gap:8px;font-size:14px;color:var(--muted)">' + AV(p.role, p.name, 26) + '<span class="ellip">' + esc(p.name) + '</span></span>'
        + '<span class="sheet-title">' + esc(Q) + '</span></span>'
        + '<button type="button" data-close class="pillbtn">Cancel</button></div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
        + '<button type="button" data-ans="yes" class="ansbtn' + (st.ans === 'yes' ? ' on' : '') + '" aria-pressed="' + (st.ans === 'yes') + '">' + YES + '</button>'
        + '<button type="button" data-ans="no" class="ansbtn' + (st.ans === 'no' ? ' on' : '') + '" aria-pressed="' + (st.ans === 'no') + '">' + NO + '</button></div>'
        + (st.ans ? '<div style="display:flex;flex-direction:column;gap:12px">' + box + '</div>' : '') + '</div>';
      if (st.typing && st.focus) { var ta = $sheet.querySelector('[data-note]'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); st.focus = false; } }
    }
    draw();
    var recorder = null, chunks = [], stream = null, tick = null;
    sheetCleanup = function () { clearInterval(tick); if (recorder && recorder.state !== 'inactive') recorder.stop(); if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); };
    function startRec() {
      if (!navigator.mediaDevices || !window.MediaRecorder) { st.typing = true; st.focus = true; draw(); return; }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
        stream = s; chunks = [];
        var mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find(function (m) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m); }) || '';
        recorder = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
        recorder.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
        recorder.onstop = function () {
          clearInterval(tick);
          s.getTracks().forEach(function (t) { t.stop(); });
          var blob = new Blob(chunks, { type: (recorder.mimeType || mime || 'audio/webm').split(';')[0] });
          st.rec = 'working'; draw();
          var fr = new FileReader();
          fr.onload = function () {
            act('voice', { contactId: p.id, audio: String(fr.result).split(',')[1], mime: blob.type, kind: st.kind, reached: st.ans ? st.ans === 'yes' : null }).then(function (r) {
              st.rec = null; st.aiOutputId = r.aiOutputId;
              var text = r.note + (r.nextStep ? '\nNext: ' + r.nextStep : '');
              st.note = (st.note ? st.note + '\n' : '') + text;
              if (r.followUpDate && r.followUpDate > ymd()) st.follow = r.followUpDate;
              if (!text.trim()) toast('Couldn’t hear that. Try again, or tap the note to type.');
              draw();
            }, function (err) { st.rec = null; draw(); toast(errText(err)); });
          };
          fr.readAsDataURL(blob);
        };
        recorder.start();
        st.rec = 'on'; st.secs = 0; draw();
        tick = setInterval(function () { st.secs++; var nt = $sheet.querySelector('.notebox .nt'); if (nt) nt.textContent = 'Listening… 0:' + String(st.secs % 60).padStart(2, '0'); }, 1000);
      }, function () { toast('Allow the microphone to talk, or type the note.'); st.typing = true; st.focus = true; draw(); });
    }
    sheetHandler = function (e, type) {
      if (type === 'input') {
        var ta = e.target.closest('[data-note]');
        if (ta) { st.note = ta.value; var sv = $sheet.querySelector('[data-save]'), ok = st.note.trim().length > 1; sv.classList.toggle('off', !ok); if (ok) sv.removeAttribute('aria-disabled'); else sv.setAttribute('aria-disabled', 'true'); }
        return;
      }
      if (type) return;
      var b;
      if ((b = e.target.closest('[data-ans]'))) { st.ans = b.getAttribute('data-ans'); draw(); return; }
      if (e.target.closest('[data-notebox]')) {
        if (st.rec === 'on') { recorder.stop(); return; }
        if (st.rec === 'working') return;
        if (st.note.trim() || !BOOT.voice) { st.typing = true; st.focus = true; draw(); return; }
        startRec(); return;
      }
      if (e.target.closest('[data-mic]')) { st.typing = false; startRec(); return; }
      if (e.target.closest('[data-save]')) {
        if (st.busy || !st.ans || st.note.trim().length < 2 || st.rec !== null) return;
        st.busy = true; draw();
        var missed = isV && st.ans === 'no' && ctx.pickId ? act('visit_missed', { pickId: ctx.pickId }).catch(function () {}) : Promise.resolve();
        missed.then(function () {
          return act('log', { contactId: p.id, kind: st.kind, reached: st.ans === 'yes', followUp: st.follow, note: st.note, aiOutputId: st.aiOutputId || undefined });
        }).then(function (r) { closeSheet(); afterLog(r, ctx, st.ans === 'yes'); }, function (err) { st.busy = false; draw(); toast(errText(err)); });
      }
    };
  }

  // After a log: on Today the "+1" toast, or a win card for a milestone (F2); anywhere else the win screen (F4).
  function afterLog(r, ctx, reached) {
    try { if (reached && r && r.contactId) document.dispatchEvent(new CustomEvent('pulse:logged', { detail: { id: r.contactId } })); } catch (e) { /* old browser */ }
    if (!ctx.today || location.pathname !== '/') { winMoment(r); nellAfterLog(r); return; }
    var before = todayData, tr = before ? todayRows(before) : null;
    var openBefore = tr ? tr.rows.visit.length + tr.rows.call.length : 0, doneBefore = tr ? tr.done.visit.length + tr.done.call.length : 0;
    var total = openBefore + doneBefore, nd = doneBefore + (reached ? 1 : 0);
    var day = r.day, win = null;
    if (reached && nd >= total && total > 1) win = { k: 'PERFECT DAY', t: 'Gold flame earned', s: 'Every visit and call on your list is done.', i: 'star' };
    else if (reached && day.done === day.goal) win = { k: 'STREAK SAVED', t: day.streak + ' day streak', s: day.done + ' logged today. Everything after this is a bonus.', i: 'star' };
    else if (reached && ctx.today.coldDays) win = { k: 'BACK IN TOUCH', t: r.name || ctx.today.name, s: 'First contact in ' + ctx.today.coldDays + ' days. Off the going-cold list.', i: 'heart' };
    else if (reached && total > 3 && nd === Math.ceil(total / 2)) win = { k: 'MILESTONE', t: 'Halfway there', s: (total - nd) + ' to go. Keep it rolling.', i: 'star' };
    screenToday();
    if (nellAfterLog(r)) return;
    if (win) showWinCard(win, '+1 · ' + nd + ' of ' + total);
    else toast(reached ? nd + ' of ' + total + ' logged' : 'Logged. No reply this time.', reached ? '+1' : '');
  }
  function showWinCard(w, pill) {
    var el = document.createElement('button');
    el.type = 'button'; el.className = 'wincard'; el.setAttribute('aria-label', w.k + ': ' + w.t + '. Tap to close');
    el.innerHTML = '<span class="box"><span class="medal">' + ic(w.i, 36, 2) + '</span><span class="k">' + esc(w.k) + '</span><span class="t">' + esc(w.t) + '</span>'
      + '<span class="s">' + esc(w.s) + '</span><span class="p">' + esc(pill) + '</span></span>';
    document.body.appendChild(el);
    var close = function () { if (el.parentNode) el.parentNode.removeChild(el); };
    el.addEventListener('click', close);
    setTimeout(close, 2600);
  }

  // ---- Nell's moments (Final Mockup (3) N0-N4, owner 2026-10-28) ------------------------------------------------
  // Full screen over whatever is open. Payday (order sent), Cheer (daily goal reached), Jackpot (a rare big win, from
  // api/_nell.js) and Nudge (after 3 pm, under the goal). A tap anywhere closes it (Nudge: its buttons only). The clip
  // is a 5 s video on the moment's own background; if the phone refuses to play it (Low Power Mode) or the rep has
  // Reduce Motion on, Nell's still picture shows instead (with a small hop, unless motion is reduced).
  var NELL_KINDS = ['payday', 'cheer', 'jackpot', 'nudge'];
  var nellCalm = function () { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  var nellSeen = function (k) { return localStorageGet('pulse-nell-' + k) === ymd(); };
  var nellMark = function (k) { localStorageSet('pulse-nell-' + k, ymd()); };
  var nellOpen = null, nellWarm = false;
  // The stills straight away; the four clips once Today has painted (spec: never before Today).
  function nellPreload() {
    if (nellWarm) return;
    nellWarm = true;
    NELL_KINDS.forEach(function (k) { var i = new Image(); i.src = '/nell/' + k + '.webp'; });
    setTimeout(function () { NELL_KINDS.forEach(function (k) { if (window.fetch) fetch('/nell/' + k + '.mp4').catch(function () {}); }); }, 1500);
  }
  // o: { kicker, title, sub, pill, big (Payday's amount), line (Payday's line under it), buttons (Nudge), onGo, onClose }
  function nellMoment(kind, o) {
    if (nellOpen) nellOpen.close(true);
    var el = document.createElement('div'), calm = nellCalm();
    el.className = 'nellm ' + kind;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', (o.kicker || '') + (o.title ? ': ' + o.title : ''));
    var still = '<img class="nm-still' + (calm ? '' : ' hop') + '" src="/nell/' + kind + '.webp" alt="">';
    el.innerHTML = '<div class="nm-top"><span class="nm-k">' + esc(o.kicker || '') + '</span>' + (o.title ? '<span class="nm-t">' + esc(o.title) + '</span>' : '') + '</div>'
      + '<div class="nm-stage">' + (calm ? still : '<video class="nm-clip" src="/nell/' + kind + '.mp4" muted playsinline preload="auto" aria-hidden="true"></video>') + '</div>'
      + '<div class="nm-foot">'
      + (o.big ? '<span class="nm-big num' + (calm ? ' in' : '') + '">' + esc(o.big) + '</span>' : '')
      + (o.line ? '<span class="nm-line">' + esc(o.line) + '</span>' : '')
      + (o.sub ? '<span class="nm-sub">' + esc(o.sub) + '</span>' : '')
      + (o.pill ? '<span class="nm-pill">' + esc(o.pill) + '</span>' : '')
      + (o.buttons ? '<button type="button" class="btn nm-go" data-nm="go">' + esc(o.buttons[0]) + '</button><button type="button" class="nm-later" data-nm="later">' + esc(o.buttons[1]) + '</button>'
        : '<span class="nm-tap">Tap anywhere to continue</span>')
      + '</div>';
    document.body.appendChild(el);
    var done = false;
    var key = function (e) { if (e.key === 'Escape') ctl.close(); };
    var ctl = { close: function (quiet) {
      if (done) return; done = true;
      if (el.parentNode) el.parentNode.removeChild(el);
      document.removeEventListener('keydown', key);
      if (nellOpen === ctl) nellOpen = null;
      if (!quiet && o.onClose) o.onClose();
    } };
    document.addEventListener('keydown', key);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-nm]');
      if (o.buttons && !b) return;   // Nudge closes only from its buttons
      if (b && b.getAttribute('data-nm') === 'go' && o.onGo) { ctl.close(true); o.onGo(); return; }
      ctl.close();
    });
    var v = el.querySelector('video'), big = el.querySelector('.nm-big');
    var fallback = function () { if (!v || !v.parentNode) return; v.insertAdjacentHTML('afterend', still); v.parentNode.removeChild(v); v = null; if (big) big.classList.add('in'); };
    if (v) {
      // Payday: "+$54" pops on the handoff beat, about 80% of the way through.
      v.addEventListener('timeupdate', function () { if (big && v && v.duration && v.currentTime >= v.duration * 0.8) big.classList.add('in'); });
      v.addEventListener('ended', function () { if (big) big.classList.add('in'); });
      v.addEventListener('error', fallback);
      var p = v.play();
      if (p && p.catch) p.catch(fallback);
    }
    nellOpen = ctl;
    var first = el.querySelector('button'); if (first) first.focus();
    return ctl;
  }
  // Local screen tests only (test/run/cdp-nell.js): open a moment by hand.
  if (location.hostname === 'localhost') window.__nellMoment = nellMoment;
  // Cheer or Jackpot from a log's answer (api/_nell.js). Jackpot is at most once a day (the server keeps it);
  // Cheer once a day on this phone. True when a moment showed.
  function nellAfterLog(r, onClose) {
    var n = r && r.nell;
    if (!n || (n.kind !== 'jackpot' && n.kind !== 'cheer')) return false;
    if (nellSeen(n.kind)) return false;
    nellMark(n.kind);
    if (n.kind === 'jackpot') nellMark('cheer');   // Jackpot replaces Cheer on the same log
    nellMoment(n.kind, { kicker: n.kicker, title: n.title, sub: n.sub, pill: '', onClose: onClose });
    return true;
  }
  // Nudge (N4): a workday, after 3 pm, fewer than the goal logged, once a day, never over a sheet or another moment.
  function torontoHour() { return Number(new Intl.DateTimeFormat('en-CA', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Toronto' }).format(new Date())); }
  function nellNudge(d) {
    var day = d.day;
    if (!day.workday || day.done >= day.goal || nellSeen('nudge') || nellOpen || $sheet.innerHTML || location.pathname !== '/') return;
    if (!(torontoHour() >= 15)) return;
    nellMark('nudge');
    var left = day.goal - day.done, t = todayRows(d), open = t.rows.visit.length + t.rows.call.length;
    nellMoment('nudge', { kicker: 'STILL TIME TODAY',
      title: day.streak ? left + ' more keeps your ' + day.streak + '-day streak alive' : left + ' more ' + (left === 1 ? 'starts' : 'start') + ' a new streak',
      sub: day.done + ' of ' + day.goal + ' logged · ' + open + (open === 1 ? ' contact' : ' contacts') + ' left on today’s list',
      buttons: ['Show me who’s left', 'Not now'],
      onGo: function () { var l = document.querySelector('.tlist'); if (l) l.scrollIntoView({ behavior: nellCalm() ? 'auto' : 'smooth', block: 'start' }); } });
  }

  // ---- F4 The win moment ---------------------------------------------------------------------------------
  function winMoment(r) {
    var day = r.day, left = Math.max(0, day.goal - day.done);
    var line = left ? left + ' more keeps your streak going.' : 'Your streak is safe for today.';
    $sheet.innerHTML = '<div class="moment win" role="dialog" aria-modal="true" aria-label="Nice work"><div class="inner">'
      + '<img src="/logo-white.png" alt="Renellence" width="132" height="18" style="height:18px;width:auto;margin-top:6px">'
      + '<div style="margin-top:56px"><svg width="180" height="180" viewBox="0 0 180 180" role="img" aria-label="' + day.done + ' of ' + day.goal + ' for today’s streak">'
      + '<defs><linearGradient id="w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D7E8FA"/></linearGradient></defs>'
      + '<circle cx="90" cy="90" r="70" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="16"/>'
      + (day.done ? '<circle class="ringfill" cx="90" cy="90" r="70" fill="none" stroke="url(#w)" stroke-width="16" stroke-linecap="round" stroke-dasharray="' + L.ringDash(70, day.done, day.goal) + '" transform="rotate(-90 90 90)"/>' : '')
      + '<text x="90" y="100" text-anchor="middle" font-family="Outfit, -apple-system, sans-serif" font-size="40" font-weight="800" fill="#fff">' + day.done + '/' + day.goal + '</text></svg></div>'
      + '<span class="h1" data-head style="margin-top:24px">Nice work!</span>'
      + '<span data-line style="font-size:17px;color:#E3EEFB;line-height:1.45;margin-top:10px">' + esc(line) + '</span>'
      + '<div style="margin-top:auto;width:100%;padding:0 20px calc(var(--safe-bottom) + 40px);display:flex;flex-direction:column;gap:10px">'
      + '<button type="button" data-done class="white">Done</button>'
      + '<button type="button" data-undo style="font-size:16px;font-weight:600;color:#E3EEFB;text-decoration:underline;min-height:44px;padding:0 16px;align-self:center">Undo</button>'
      + '</div></div></div>';
    sheetHandler = function (e) {
      if (e.target.closest('[data-done]')) { closeSheet(); render(); return; }
      var ub = e.target.closest('[data-undo]');
      if (ub) {
        if (ub.disabled) return;   // a second tap while the first is on its way would answer "Something went wrong"
        ub.disabled = true;
        act('undo', { interactionId: r.interactionId, closedTaskIds: r.closedTaskIds }).then(function () {
          $sheet.querySelector('[data-head]').textContent = 'Undone';
          $sheet.querySelector('[data-line]').textContent = 'Nothing was saved.';
          ub.classList.add('hide');
        }, function (err) { ub.disabled = false; toast(errText(err)); });
      }
    };
  }

  // ---- F5 Joined your Fifty --------------------------------------------------------------------------------
  function joinedMoment(j) {
    var dots = '';
    for (var i = 0; i < j.goal; i++) dots += '<span class="' + (i < j.count - 1 ? 'w' : i === j.count - 1 ? 'g newdot' : 'o') + '"></span>';
    localStorageSet('pulse-fifty-seen', String(j.count));   // this moment is the celebration; the tile behind it stays still
    $sheet.innerHTML = '<div class="moment joined" role="dialog" aria-modal="true" aria-label="' + esc(j.name) + ' joined your Fifty"><div class="inner">'
      + '<img src="/logo-white.png" alt="Renellence" width="132" height="18" style="height:18px;width:auto;margin-top:6px">'
      + '<span class="joinav" style="margin-top:30px">' + AV(j.role, j.name, 96, 'ring jump', j.id) + '</span>'
      + '<span class="headline display" style="font-size:32px;font-weight:800;letter-spacing:-1.1px;line-height:1.15;margin-top:18px">' + esc(j.name) + '<br>joined your Fifty!</span>'
      + '<div style="width:100%;margin-top:28px"><div class="dots" style="gap:9px">' + dots + '</div></div>'
      + '<span class="num" style="font-size:52px;font-weight:800;letter-spacing:-1.8px;margin-top:26px;line-height:1">' + j.count + '<span style="font-size:22px;color:#E3EEFB;font-weight:600"> of ' + j.goal + '</span></span>'
      + '<span style="font-size:17px;color:#E3EEFB;margin-top:8px">' + Math.max(0, j.next - j.count) + ' more to ' + j.next + '</span>'
      + '<div style="margin-top:auto;width:100%;padding-bottom:calc(var(--safe-bottom) + 50px)"><button type="button" data-keep class="white">Keep going</button></div></div></div>';
    sheetHandler = function (e) { if (e.target.closest('[data-keep]')) { closeSheet(); act('seen_fifty').catch(function () {}); } };
  }

  // ---- F6 People ---------------------------------------------------------------------------------------
  // The lead groups: colour, icon and name as F6 and F19-F22, F29 draw them.
  var GROUP = {
    onboarded: { label: 'Onboarded', rgb: '98,212,158', hex: '#62D49E', icon: 'onboarded', sub: 'Signed up, waiting for samples' },
    social: { label: 'Social Media', rgb: '242,138,192', hex: '#F28AC0', icon: 'social' },
    event: { label: 'Events and Training', rgb: '179,156,255', hex: '#B39CFF', icon: 'event' },
    warm: { label: 'Other Warm', rgb: '245,158,107', hex: '#F59E6B', icon: 'warm' },
    cold: { label: 'Cold', rgb: '127,219,242', hex: '#7FDBF2', icon: 'cold' },
  };
  // Candidates are ready to ask 5 days after their samples arrive (owner 2026-10-28; was 14).
  var ASK_DAYS = 5;
  var peopleView = 'fifty', peopleFilter = 'cold';
  function screenPeople() {
    return paint(read('people'), function (d) {
      var h = '<div class="scr">'
        + '<div class="head"><h1 class="h1">People</h1><button type="button" data-add-person class="pillbtn blue" style="margin-bottom:6px">' + ic('plus', 15, 2.2) + 'Add person</button></div>'
        + searchBox('people-search', 'Find a person', 'margin-bottom:12px')
        + '<div data-search-results></div><div data-people-body>'
        + '<div class="seg" role="tablist" style="margin-bottom:14px">'
        + [['fifty', 'My Fifty'], ['cand', 'Candidates'], ['leads', 'Leads']].map(function (t) {
          return '<button type="button" role="tab" data-pview="' + t[0] + '" aria-selected="' + (peopleView === t[0]) + '"' + (peopleView === t[0] ? ' class="on"' : '') + '>' + t[1] + '</button>';
        }).join('') + '</div>';
      if (peopleView === 'fifty') h += fiftyView(d.fifty);
      else if (peopleView === 'cand') h += candidatesView(d.candidates);
      else h += leadsView(d.leads, d.newWeek || []);
      return h + '</div></div>';
    }, 'people');
  }
  function searchBox(name, placeholder, style) {
    return '<label class="search" style="' + (style || '') + '">' + ic('search', 17, 1.8)
      + '<input type="search" data-search="' + name + '" placeholder="' + esc(placeholder) + '" aria-label="' + esc(placeholder) + '" autocomplete="off"></label>';
  }
  function fiftyView(f) {
    var dots = '';
    // Always the goal's 50 dots (F6); past 50 the going-cold share keeps its proportion of the filled dots.
    var filled = Math.min(f.goal, f.count), warmDots = f.count > f.goal ? Math.round(f.warmCount / f.count * f.goal) : f.warmCount;
    for (var i = 0; i < f.goal; i++) dots += '<span class="' + (i < warmDots ? 'w' : i < filled ? 'c' : 'o') + '"></span>';
    var h = '<section class="hero' + (fiftyUp(f.count) ? ' fifty-up' : '') + '" style="display:flex;flex-direction:column;gap:14px;margin-bottom:12px" aria-label="' + f.count + ' of ' + f.goal + ' in My Fifty">'
      + '<span style="display:flex;align-items:baseline;gap:6px"><span class="num" style="font-size:40px;font-weight:800;line-height:1;letter-spacing:-1.4px">' + f.count + '</span>'
      + '<span class="num" style="font-size:15px;font-weight:700;opacity:.85">of ' + f.goal + '</span></span>'
      + '<div class="dots" aria-hidden="true">' + dots + '</div></section>'
      + '<div style="display:flex;gap:6px;margin-bottom:12px">'
      + [['warm', f.warmCount, 'Warm'], ['cold', f.coldCount, 'Going cold']].map(function (x) {
        var on = peopleFilter === x[0];
        return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-pfilter="' + x[0] + '" aria-pressed="' + on + '">'
          + '<span class="dot ' + (x[0] === 'warm' ? 'warm' : 'cold') + '" style="width:10px;height:10px;' + (x[0] === 'warm' ? 'background:currentColor' : 'background:linear-gradient(90deg,currentColor 50%,transparent 50%);border:1.5px solid currentColor') + '"></span>'
          + x[2] + ' <span class="n">' + x[1] + '</span></button>';
      }).join('') + '</div>';
    var rows = peopleFilter === 'warm' ? f.warm : f.cold;
    if (!rows.length) return h + empty('people', peopleFilter === 'cold' ? 'Nobody is going cold.' : 'Nobody here yet.', peopleFilter === 'warm' ? 'Turn candidates into My Fifty with a first order.' : '');
    return h + '<section class="card">' + rows.map(function (r) {
      return '<a href="/person/' + r.id + '" data-nav class="row" style="min-height:64px">' + avDot(r.role, r.name, 42, peopleFilter === 'warm' ? 'warm' : 'cold', r.id)
        + '<span class="grow"><span class="t ellip">' + esc(r.name) + '</span><span class="sub ellip">' + nb(r.sub) + '</span></span>' + CHEV + '</a>';
    }).join('') + '</section>';
  }
  function candRing(r, days) {
    var R = 19.5, C = 2 * Math.PI * R, frac = days == null ? 0 : Math.min(1, days / ASK_DAYS);
    return '<span class="avwrap" style="width:44px;height:44px"><svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" style="position:absolute;inset:0">'
      + '<circle cx="22" cy="22" r="' + R + '" fill="none" stroke="#323E5C" stroke-width="3"/>'
      + (frac ? '<circle cx="22" cy="22" r="' + R + '" fill="none" stroke="#62B2F7" stroke-width="3" stroke-linecap="round" stroke-dasharray="' + (C * frac).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 22 22)"/>' : '')
      + '</svg><span style="position:absolute;inset:6px">' + AV(r.role, r.name, 32, 'st-cand', r.id) + '</span></span>';
  }
  function candidatesView(cands) {
    var ready = cands.filter(function (c) { return c.days != null && c.days >= ASK_DAYS; });
    var settling = cands.filter(function (c) { return !(c.days != null && c.days >= ASK_DAYS); });
    var h = '<section class="hero" style="margin-bottom:14px"><span aria-hidden="true" style="position:absolute;right:-40px;top:-50px;width:170px;height:170px;border-radius:50%;background:radial-gradient(circle,rgba(247,201,72,0.28),rgba(247,201,72,0) 65%)"></span>'
      + '<span style="position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px"><span style="display:flex;flex-direction:column;gap:2px">'
      + '<span class="kicker" style="color:#fff;opacity:.7">Have samples</span>'
      + '<span style="display:flex;align-items:baseline;gap:8px"><span class="num" style="font-size:44px;font-weight:800;line-height:1">' + cands.length + '</span><span style="font-size:15px;font-weight:700;opacity:.85">' + (cands.length === 1 ? 'candidate' : 'candidates') + '</span></span></span>'
      + (ready.length ? '<span class="num readypill">' + ready.length + ' ready to ask</span>' : '') + '</span></section>';
    if (!cands.length) return h + empty('gift', 'No candidates yet.', 'Samples make a lead a candidate.');
    if (ready.length) {
      h += sect('Ready to ask', '') + '<section class="card r20" style="margin-bottom:14px">' + ready.map(function (c) {
        return '<div class="row" style="min-height:68px;padding:8px 12px 8px 14px;gap:10px"><a href="/person/' + c.id + '" data-nav style="flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:12px">' + candRing(c, c.days)
          + '<span class="grow"><span class="t ellip">' + esc(c.name) + '</span><span class="sub ellip">' + (c.clinic ? nb(c.clinic) + ' · ' : '') + c.days + ' days</span></span></a>'
          + '<button type="button" class="ask" data-ask="' + c.id + '">Ask now</button></div>';
      }).join('') + '</section>';
    }
    if (settling.length) {
      h += sect('Samples settling in', '') + '<section class="card r20" style="margin-bottom:14px">' + settling.map(function (c) {
        var when = c.days == null ? 'Samples on the way' : 'Ask in ' + (ASK_DAYS - c.days) + (ASK_DAYS - c.days === 1 ? ' day' : ' days');
        return '<a href="/person/' + c.id + '" data-nav class="row" style="min-height:68px">' + candRing(c, c.days)
          + '<span class="grow"><span class="t ellip">' + esc(c.name) + '</span><span class="sub ellip">' + (c.clinic ? nb(c.clinic) + ' · ' : '') + when + '</span></span>' + CHEV + '</a>';
      }).join('') + '</section>';
    }
    return h;
  }
  function groupTile(g, wide) {
    var G = GROUP[g.key];
    var bg = 'background:radial-gradient(' + (wide ? '90% 120%' : '90% 80%') + ' at 0% 0%,rgba(' + G.rgb + ',' + (wide ? '0.22' : '0.2') + '),rgba(0,0,0,0) 70%),var(--card)';
    var icon = '<span class="gico" style="background:rgba(' + G.rgb + ',0.16);color:' + G.hex + (wide ? ';width:44px;height:44px;border-radius:13px' : '') + '">' + ic(G.icon, wide ? 22 : 20, 1.8) + '</span>';
    var fresh = g.fresh ? '<span class="tag new"' + (wide ? '' : ' style="position:absolute;top:12px;right:12px"') + '>' + g.fresh + ' new</span>' : '';
    if (wide) {
      return '<a href="/people/leads/' + g.key + '" data-nav class="gtile wide" style="' + bg + '">' + icon
        + '<span style="flex:1 1 auto;display:flex;flex-direction:column"><span style="display:flex;align-items:baseline;gap:8px"><span class="num gn">' + g.count + '</span><span style="font-size:15px;font-weight:700">' + G.label + '</span></span>'
        + '<span class="sub" style="margin-top:3px">' + G.sub + '</span></span>' + fresh + '</a>';
    }
    return '<a href="/people/leads/' + g.key + '" data-nav class="gtile" style="' + bg + '" aria-label="' + g.count + ' ' + G.label + ' leads' + (g.fresh ? ', ' + g.fresh + ' new' : '') + '">' + fresh + icon
      + '<span style="display:flex;flex-direction:column"><span class="num gn">' + g.count + '</span><span style="font-size:13px;font-weight:600;color:var(--muted);margin-top:3px">' + G.label + '</span></span></a>';
  }
  function leadsView(groups, newWeek) {
    var by = {}; groups.forEach(function (g) { by[g.key] = g; });
    var h = '';
    if (newWeek.length) {
      h += sect('New this week', '') + '<div class="stories noscroll">' + newWeek.map(function (p) {
        var G = GROUP[p.group] || GROUP.cold;
        return '<a href="/person/' + p.id + '" data-nav class="story"><span class="sring">' + AV(p.role, p.first, 45, 'st-new', p.id)
          + '<span class="sbadge" style="color:' + G.hex + '">' + ic(G.icon, 12, 2) + '</span></span><span class="sname">' + esc(p.first) + '</span></a>';
      }).join('') + '</div>';
    }
    h += sect('All leads', '');
    if (by.onboarded) h += groupTile(by.onboarded, true);
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' + ['social', 'event', 'warm', 'cold'].filter(function (k) { return by[k]; }).map(function (k) { return groupTile(by[k]); }).join('') + '</div>';
    return h;
  }
  $app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pview]');
    if (b) { peopleView = b.getAttribute('data-pview'); screenPeople(); return; }
    b = e.target.closest('[data-pfilter]');
    if (b) { peopleFilter = b.getAttribute('data-pfilter'); screenPeople(); return; }
    b = e.target.closest('[data-ask]');
    if (b) { callOrText(b.getAttribute('data-ask'), 'call'); return; }
    if (e.target.closest('[data-add-person]')) openAddPerson();
  });

  // Find a person (People and New order): results replace the list while typing.
  var searchTimer = null, searchSeq = 0;   // only the newest search may fill the results (a slow older answer is dropped)
  $app.addEventListener('input', function (e) {
    var inp = e.target.closest('[data-search]');
    if (!inp) return;
    clearTimeout(searchTimer);
    var where = inp.getAttribute('data-search');
    searchTimer = setTimeout(function () { runSearch(where, inp.value.trim()); }, 180);
  });
  function runSearch(where, q) {
    if (where === 'ready') return filterReady(q);
    var out = $app.querySelector('[data-search-results]'), body = $app.querySelector('[data-people-body]');
    var seq = ++searchSeq;
    if (!q) { out.innerHTML = ''; body.classList.remove('hide'); return; }
    read('search', { q: q }).then(function (d) {
      if (seq !== searchSeq) return;
      body.classList.add('hide');
      var STAGE = { fifty: 'My Fifty', candidate: 'Candidate', lead: 'Lead' };
      out.innerHTML = d.people.length ? '<section class="card" style="margin-bottom:12px">' + d.people.map(function (p) {
        return '<a href="/person/' + p.id + '" data-nav class="row">' + AV(p.role, p.name, 40, avState(p), p.id)
          + '<span class="grow"><span class="t ellip">' + esc(p.name) + '</span><span class="sub ellip">' + [p.clinic ? nb(p.clinic) : '', STAGE[p.stage]].filter(Boolean).join(' · ') + '</span></span>' + CHEV + '</a>';
      }).join('') + '</section>' : empty('search', 'Nobody in your book matches.', 'Check the spelling, or add them with Add person.', 'margin-bottom:12px');
    }).catch(function (err) { toast(errText(err)); });
  }

  // ---- F19-F22, F29 Lead lists ----------------------------------------------------------------------------
  var STATE_TONE = function (t) { return /^Visited/.test(t) ? 'background:rgba(98,212,158,0.14);color:#62D49E' : /^Called/.test(t) ? 'background:rgba(98,178,247,0.14);color:#62B2F7' : 'background:rgba(174,184,204,0.12);color:#AEB8CC'; };
  function screenLeads(group) {
    return paint(read('leads', { group: group }), function (d) {
      var G = GROUP[group], onb = group === 'onboarded';
      var fresh = d.leads.filter(function (l) { return onb ? l.newThisWeek : l.isNew; }), old = onb ? [] : d.leads.filter(function (l) { return !l.isNew; });
      var h = '<div class="scr">' + backLink('/people', 'People')
        + '<section class="hero" style="margin-bottom:12px;background:radial-gradient(100% 90% at 0% 0%,rgba(' + G.rgb + ',0.26),rgba(0,0,0,0) 65%),var(--hero)">'
        + '<span aria-hidden="true" style="position:absolute;right:-18px;top:-14px;color:rgba(' + G.rgb + ',0.22)">' + ic(G.icon, 130, 1.2) + '</span>'
        + '<span style="position:relative;display:flex;align-items:center;gap:10px"><span class="gico" style="width:42px;height:42px;border-radius:13px;background:rgba(' + G.rgb + ',0.2);color:' + G.hex + '">' + ic(G.icon, 22, 1.9) + '</span>'
        + '<h1 class="display" style="font-size:26px;font-weight:800;letter-spacing:-0.6px;line-height:1.1">' + G.label + '</h1></span>'
        + '<span class="hstats"><span><span class="num">' + d.leads.length + '</span><span class="hl">' + (onb ? 'Signed' : 'Leads') + '</span></span>'
        + '<span><span class="num" style="color:' + (onb ? '#62D49E' : '#62B2F7') + '">' + fresh.length + '</span><span class="hl">' + (onb ? 'New this week' : 'New') + '</span></span></span></section>';
      if (!d.leads.length) return h + empty(G.icon === 'onboarded' ? 'pen' : 'people', 'No leads here right now.', onb ? 'Signed onboardings with no order yet show here.' : '') + '</div>';
      if (onb) {
        return h + sect('Send samples', '', '#62D49E') + '<section class="card r20">' + d.leads.map(function (l) {
          return '<div class="row" style="min-height:68px;padding:8px 10px 8px 14px"><a href="/person/' + l.id + '" data-nav style="flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:12px">' + AV(l.role, l.name, 42, avState({ newThisWeek: l.newThisWeek }), l.id)
            + '<span class="grow"><span class="t ellip">' + esc(l.name) + '</span><span class="sub ellip">' + (l.signed ? 'Signed ' + esc(l.signed) : esc(l.sub)) + '</span></span></a>'
            + '<a href="/order/' + l.id + '" data-nav class="ask" style="font-family:var(--font);font-size:13px;font-weight:700;padding:0 13px">Send samples</a></div>';
        }).join('') + '</section></div>';
      }
      if (fresh.length) {
        h += sect('New', '', '#62B2F7') + '<section class="card r20" style="margin-bottom:14px;box-shadow:var(--edge),inset 3px 0 0 #1170C0;overflow:hidden">' + fresh.map(function (l) {
          return '<div class="row" style="min-height:66px;padding:8px 10px 8px 14px"><a href="/person/' + l.id + '" data-nav style="flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:12px">'
            + '<span class="avwrap">' + AV(l.role, l.name, 42, 'st-new', l.id) + '<span class="newpip"></span></span>'
            + '<span class="grow"><span class="t ellip" style="font-weight:700">' + esc(l.name) + '</span><span class="sub ellip">' + esc(l.sub) + '</span></span>'
            + '<span style="font-size:12px;color:var(--dim);flex:none">' + esc(l.age) + '</span></a>'
            + '<button type="button" class="round blue" style="width:42px;height:42px" data-ask="' + l.id + '" aria-label="Call ' + esc(l.name) + '">' + ic('phone', 18, 2.1) + '</button></div>';
        }).join('') + '</section>';
      }
      if (old.length) {
        h += sect('In progress', '') + '<section class="card r20">' + old.map(function (l) {
          var state = l.last || 'Not reached yet';
          return '<a href="/person/' + l.id + '" data-nav class="row">' + AV(l.role, l.name, 40, '', l.id)
            + '<span class="grow"><span class="t ellip">' + esc(l.name) + '</span><span class="sub ellip">' + esc(l.sub) + '</span></span>'
            + '<span style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:none"><span class="statepill" style="' + STATE_TONE(state) + '"><span></span>' + esc(state) + '</span>'
            + '<span style="font-size:11px;color:var(--faint)">' + esc(l.age) + '</span></span></a>';
        }).join('') + '</section>';
      }
      return h + '</div>';
    }, 'people');
  }

  // ---- F7 / F8 / F27 Person card -----------------------------------------------------------------------------
  // The lists as the Edge redesign agreed them (v2 part B; the server reads old names as these). 'None' is picked on its own.
  var FILLERS = [['saypha', 'saypha'], ['juvederm', 'Juvéderm'], ['restylane', 'Restylane'], ['teoxane_rha', 'Teoxane (RHA)'], ['belotero', 'Belotero'], ['revanesse', 'Revanesse'], ['stylage', 'Stylage'], ['yvoire', 'Yvoire'], ['other', 'Other'], ['none', 'None']];
  var PRPS = [['eclipse_prp', 'Eclipse PRP'], ['regenlab', 'RegenLab'], ['arthrex_prf', 'Arthrex PRF'], ['exprecell_prf', 'Exprecell PRF'], ['alyssamed', 'AlyssaMed'], ['cellenis', 'Cellenis'], ['world_prp', 'World PRP'], ['naturagel', 'NaturaGel'], ['other', 'Other'], ['none', 'None']];
  var RETIRED = { emcyte: 'EmCyte' };   // no longer offered, still shown if someone has it
  function names(list, keys) { var m = Object.assign({}, RETIRED); list.forEach(function (x) { m[x[0]] = x[1]; }); return keys.map(function (k) { return m[k] || k; }).join(' · '); }
  // A product's thumbnail colour and icon (F8, F9).
  function thumb(nameOrSku, size) {
    var s = String(nameOrSku || ''), z = size || 40;
    var t = /saypha|^SA/i.test(s) ? ['linear-gradient(145deg,#F7A8D0,#B5487F)', 'syringe'] : /magic|mesbio|needle|cannula|^MN|^MES/i.test(s) ? ['linear-gradient(145deg,#7FE3D8,#1F8A80)', 'needle']
      : /exprecell|prp/i.test(s) ? ['linear-gradient(145deg,#FFA49C,#C2413A)', 'syringe'] : /mask|serum|cream|skin|peptide/i.test(s) ? ['linear-gradient(145deg,#A8EEC4,#2E9E6B)', 'drop'] : ['linear-gradient(145deg,#8C98B2,#46536F)', 'gift'];
    return '<span class="thumb" style="width:' + z + 'px;height:' + z + 'px;border-radius:' + Math.round(z * 0.3) + 'px;background:' + t[0] + '">' + ic(t[1], Math.round(z * 0.45), 1.8) + '</span>';
  }
  var current = null;   // the person on screen
  function screenPerson(id) {
    return paint(read('person', { id: id }), function (p) {
      current = p;
      var lead = p.stage === 'lead';
      var dot = p.stage === 'fifty' ? (p.goingCold ? 'background:linear-gradient(90deg,#FFFFFF 50%,transparent 50%);border:1.5px solid #FFFFFF' : 'background:#FFFFFF')
        : 'background:transparent;border:1.5px dashed #FFFFFF';
      var label = p.label.toLowerCase().replace(/(^|·\s*)([a-z])/g, function (m, a, c) { return a + c.toUpperCase(); }).replace('My fifty', 'My Fifty');
      var back = lead ? '/people/leads/' + (p.leadGroup || 'cold') : '/people';
      var h = '<div class="scr">' + backLink(back, lead ? 'Leads' : 'People')
        + '<section class="hero pcard"><span class="pring" aria-hidden="true"></span>'
        + '<span style="position:relative;display:flex;align-items:center;gap:16px"><span data-avtap>' + AV(p.role, p.name, 88, 'ring card ' + avState(p), p.id) + '</span>'
        + '<span style="flex:1 1 auto;min-width:0;display:flex;flex-direction:column">'
        + '<span class="stagepill"><span style="width:11px;height:11px;border-radius:50%;box-sizing:border-box;' + dot + '"></span>' + esc(label) + '</span>'
        + '<h1 class="display" style="font-size:25px;font-weight:800;line-height:1.1;letter-spacing:-1px">' + esc(p.name) + '</h1>'
        + (p.clinic ? '<span style="margin-top:2px;font-size:15px;opacity:.75">' + nb(p.clinic) + '</span>' : '') + '</span></span>'
        + '<span class="pstats">' + p.stats.map(function (s) { return '<span><span class="num">' + esc(s[0]) + '</span><span class="pl">' + esc(s[1]) + '</span></span>'; }).join('') + '</span></section>';
      function act4(attr, icon, label, main) {
        return '<button type="button" ' + attr + ' class="act4"><span class="' + (main ? 'main' : '') + '">' + ic(icon, 20, 1.6) + '</span>' + label + '</button>';
      }
      h += '<div class="acts">' + act4('data-quo="call"', 'phone', 'Call', true) + act4('data-log="' + p.id + '" data-kind="visit"', 'pin', 'Visit')
        + act4('data-quo="text"', 'text', 'Text') + '</div>';
      if (p.status) {
        var s = p.status, href = s.kind === 'onboarding' ? '/person/' + p.id + '/onboarding' : s.kind === 'send' ? '/order/' + p.id : '/orders/' + s.id;
        var bars = [0, 1, 2].map(function (i) {
          var f = s.fill - i;
          return '<span style="' + (f >= 1 ? 'background:#1170C0' : f > 0 ? 'background:linear-gradient(90deg,#1170C0 50%,#0F1526 50%)' : 'background:#0F1526') + '"></span>';
        }).join('');
        var cur = Math.min(2, Math.floor(s.fill));
        var amber = s.kind !== 'send';
        h += '<a href="' + href + '" data-nav class="card r18 status">'
          + '<span style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="display:flex;align-items:center;gap:8px">'
          + '<span class="sdot" style="background:' + (amber ? '#F59E0B;box-shadow:0 0 0 4px rgba(245,158,11,0.18)' : '#62B2F7;box-shadow:0 0 0 4px rgba(98,178,247,0.18)') + '"></span>'
          + '<span class="display" style="font-size:15px;font-weight:700">' + esc(s.label) + '</span></span>'
          + '<span class="display" style="font-size:15px;font-weight:700">' + esc(s.value || '') + '<span style="color:var(--chev);margin-left:6px">›</span></span></span>'
          + '<span class="sbars">' + bars + '</span><span class="slabels">' + s.steps.map(function (x, i) { return '<span' + (i === cur ? ' class="on"' : '') + '>' + esc(x) + '</span>'; }).join('') + '</span></a>';
      }
      if (p.stage === 'candidate' && p.samples) {
        h += '<div class="sect" style="padding-top:2px"><span class="kicker">Samples they have</span><span class="r">Sent ' + esc(p.samples.sent) + '</span></div>'
          + '<section class="card" style="margin-bottom:10px">' + p.samples.lines.map(function (l) {
            return '<div class="row" style="min-height:54px">' + thumb(l.sku + ' ' + l.name, 34) + '<span style="flex:1;font-size:15px;font-weight:600">' + esc(l.name) + '</span><span class="tag green num" style="height:24px;padding:0 10px;font-size:13px;font-weight:800">' + l.qty + ' free</span></div>';
          }).join('') + '</section>';
      }
      var none = lead ? 'Unknown' : 'None yet';
      h += '<section class="card">'
        + kvBtn('data-followup', 'Next follow-up', p.followUp ? (p.followUp.date === ymd() ? 'Today' : p.followUp.label) : 'None', !p.followUp)
        + kvBtn('data-uses="fillers"', 'Filler they use', p.fillers.length ? names(FILLERS, p.fillers) : none, !p.fillers.length)
        + kvBtn('data-uses="prp"', 'PRP/PRF they use', p.prp.length ? names(PRPS, p.prp) : none, !p.prp.length)
        + '</section><input type="date" data-followup-input min="' + ymd() + '" value="' + (p.followUp ? p.followUp.date : '') + '" aria-label="Next follow-up date" style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px">'
        + '<a href="/person/' + p.id + '/history" data-nav class="card row" style="margin-top:10px;min-height:60px">'
        + '<span class="round" style="width:36px;height:36px;border-radius:10px">' + ic('clock', 18, 1.6) + '</span>'
        + '<span class="grow"><span style="font-size:15px;font-weight:600">History</span><span class="sub">' + esc(p.last) + '</span></span>' + CHEV + '</a>';
      return h + '</div>';
    }, 'people', 'card');
  }
  function kvBtn(attr, label, value, none) {
    return '<button type="button" ' + attr + ' class="kv"><span class="k">' + label + '</span><span class="v' + (none ? ' none' : '') + '">' + esc(value) + '</span></button>';
  }
  $app.addEventListener('click', function (e) {
    var lb = e.target.closest('[data-log]');
    if (lb) { openLog(lb.getAttribute('data-log'), lb.getAttribute('data-kind') || 'call'); return; }
    if (!current) return;
    var b = e.target.closest('[data-quo]');
    if (b) { callOrText(current.id, b.getAttribute('data-quo')); return; }
    if (e.target.closest('[data-followup]')) {
      var inp = $app.querySelector('[data-followup-input]');
      if (inp.showPicker) { try { inp.showPicker(); return; } catch (x) { /* fall through */ } }
      inp.focus(); inp.click();
      return;
    }
    b = e.target.closest('[data-uses]');
    if (b) openUses(current, b.getAttribute('data-uses'));
  });
  $app.addEventListener('change', function (e) {
    var inp = e.target.closest('[data-followup-input]');
    if (!inp || !inp.value || !current) return;
    act('set_follow_up', { contactId: current.id, date: inp.value }).then(function (r) { toast('Next follow-up: ' + r.label); screenPerson(current.id); }, function (err) { toast(errText(err)); });
  });

  // Call and Text open the Quo app (Yousef 2026-10-20: "Quo app + Gmail"). The Log sheet is only readied after a call,
  // not a text (owner 2026-10-28). Quo's links: openphone://dial?number=…&action=call and openphone://message?number=….
  function callOrText(contactId, what, ctx) {
    read('person', { id: contactId }).then(function (p) {
      if (!p.phone) { toast('No phone number for ' + (p.first || p.name) + ' yet.'); return; }
      var n = encodeURIComponent(p.phone);
      location.href = what === 'text' ? 'openphone://message?number=' + n : 'openphone://dial?number=' + n + '&action=call';
      if (what === 'text') return;
      setTimeout(function () { logSheet(p, 'call', ctx || {}); }, 700);
    }, function (err) { toast(errText(err)); });
  }

  // Filler / PRP they use: pick from the fixed lists.
  function openUses(p, which) {
    var list = which === 'fillers' ? FILLERS : PRPS;
    var picked = (which === 'fillers' ? p.fillers : p.prp).slice();
    function draw() {
      $sheet.innerHTML = '<div class="dim" data-close></div><div class="sheet" role="dialog" aria-modal="true"><span class="grab"></span>'
        + '<div class="sheet-head" style="align-items:center"><span class="sheet-title">' + (which === 'fillers' ? 'Filler they use' : 'PRP/PRF they use') + '</span>'
        + '<button type="button" data-close class="pillbtn">Cancel</button></div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:8px">' + list.map(function (x) {
          var on = picked.indexOf(x[0]) >= 0;
          return '<button type="button" data-pick="' + x[0] + '" class="pickchip' + (on ? ' on' : '') + '" aria-pressed="' + on + '">' + esc(x[1]) + '</button>';
        }).join('') + '</div><button type="button" data-save class="btn">Save</button></div>';
    }
    draw();
    sheetHandler = function (e, type) {
      if (type) return;
      var b = e.target.closest('[data-pick]');
      if (b) {
        var k = b.getAttribute('data-pick'), i = picked.indexOf(k);
        if (i >= 0) picked.splice(i, 1);
        else if (k === 'none') picked = ['none'];   // 'None' clears the rest, and anything else clears 'None'
        else { picked = picked.filter(function (x) { return x !== 'none'; }); picked.push(k); }
        draw(); return;
      }
      if (e.target.closest('[data-save]')) {
        var body = { contactId: p.id }; body[which === 'fillers' ? 'fillers' : 'prp'] = picked;
        act('set_uses', body).then(function () { closeSheet(); screenPerson(p.id); }, function (err) { toast(errText(err)); });
      }
    };
  }

  // ---- sheets ------------------------------------------------------------------------------------------
  var sheetHandler = null, sheetCleanup = null;
  function closeSheet() {
    if (sheetCleanup) { try { sheetCleanup(); } catch (e) { /* ignore */ } }
    sheetCleanup = null; sheetHandler = null; $sheet.innerHTML = '';
  }
  $sheet.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) { closeSheet(); return; }
    if (sheetHandler) sheetHandler(e);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $sheet.innerHTML) closeSheet(); });
  // Swipe a sheet down to close it: from its handle or header, or anywhere once it is scrolled to the top. A short
  // pull springs back; past 90px (or a quick flick) it closes.
  var drag = null;
  $sheet.addEventListener('touchstart', function (e) {
    var s = e.target.closest('.sheet');
    if (!s || e.touches.length !== 1 || e.target.closest('input, textarea, select')) { drag = null; return; }
    drag = { s: s, y: e.touches[0].clientY, t: Date.now(), dy: 0, on: false, top: s.scrollTop <= 0 };
  }, { passive: true });
  $sheet.addEventListener('touchmove', function (e) {
    if (!drag) return;
    var dy = e.touches[0].clientY - drag.y;
    if (!drag.on) {
      if (dy > 8 && drag.top && drag.s.scrollTop <= 0) { drag.on = true; drag.s.classList.add('dragging'); }
      else if (Math.abs(dy) > 8) { drag = null; return; }
      else return;
    }
    drag.dy = Math.max(0, dy);
    drag.s.style.transform = 'translate(-50%, ' + drag.dy + 'px)';
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  $sheet.addEventListener('touchend', function () {
    if (!drag || !drag.on) { drag = null; return; }
    var s = drag.s, fast = drag.dy > 40 && drag.dy / Math.max(1, Date.now() - drag.t) > 0.6;
    s.classList.remove('dragging');
    s.classList.add('closing');
    if (drag.dy > 90 || fast) { s.style.transform = 'translate(-50%, 100%)'; setTimeout(closeSheet, 150); }
    else { s.style.transform = ''; setTimeout(function () { s.classList.remove('closing'); }, 200); }
    drag = null;
  });
  $sheet.addEventListener('input', function (e) { if (sheetHandler) sheetHandler(e, 'input'); });
  $sheet.addEventListener('change', function (e) { if (sheetHandler) sheetHandler(e, 'change'); });
  // Keyboard and screen readers (UI audit 2026-10-27): focus moves into a sheet when it opens and back when it closes.
  var sheetOpener = null;
  new MutationObserver(function () {
    var box = $sheet.querySelector('.sheet, .moment');
    if (!box) { if (sheetOpener && document.body.contains(sheetOpener)) sheetOpener.focus({ preventScroll: true }); sheetOpener = null; return; }
    if (box.contains(document.activeElement)) return;
    if (!sheetOpener) sheetOpener = document.activeElement;
    box.setAttribute('tabindex', '-1'); box.focus({ preventScroll: true });
  }).observe($sheet, { childList: true });

  // ---- F13 Add a person -------------------------------------------------------------------------------------
  // The mockup's five characters. v2 has no clinic owner role any more (v2-008 merged clinic_owner into manager), so
  // "Clinic owner" is saved as manager until the database has it again. Dentists are added as Other.
  var ROLES = [['physician', 'Physician', 'physician'], ['injector', 'Nurse injector', 'injector'], ['owner', 'Clinic owner', 'manager'], ['manager', 'Manager', 'manager'], ['other', 'Other', 'other']];
  function openAddPerson() {
    var st = { role: null, warm: true, busy: false };
    $sheet.innerHTML = '<div class="dim" data-close></div><div class="sheet tall" role="dialog" aria-modal="true" aria-label="Add a person">'
      + '<span class="grab"></span>'
      + '<div class="sheet-head" style="align-items:center;margin-bottom:4px"><span class="sheet-title">Add a person</span><button type="button" data-close class="pillbtn">Cancel</button></div>'
      + '<span class="field-lbl">Name</span>'
      + '<div class="well"><div style="display:flex"><input type="text" name="firstName" placeholder="First name" aria-label="First name" autocomplete="off"><span class="split"></span>'
      + '<input type="text" name="lastName" placeholder="Last name" aria-label="Last name" autocomplete="off"></div></div>'
      + '<span class="field-lbl">Role</span><div data-roles style="display:flex;flex-wrap:wrap;gap:8px"></div>'
      + '<span class="field-lbl">Clinic</span><div class="well"><input type="text" name="clinic" placeholder="Clinic name" aria-label="Clinic name" autocomplete="off"></div>'
      + '<span class="field-lbl">Contact</span><div class="well"><input type="tel" name="phone" placeholder="Phone" aria-label="Phone" autocomplete="off"><span class="hr"></span>'
      + '<input type="email" spellcheck="false" autocapitalize="off" name="email" placeholder="Email" aria-label="Email" autocomplete="off"></div>'
      + '<span class="field-lbl">Warm or cold?</span><div data-warm class="seg flat" style="background:var(--line);border-radius:12px;padding:3px"></div>'
      + '<button type="button" data-save class="btn" style="margin-top:auto;height:54px;border-radius:14px;font-weight:600">Save person</button></div>';
    function chips() {
      $sheet.querySelector('[data-roles]').innerHTML = ROLES.map(function (r) {
        var on = st.role === r[0];
        return '<button type="button" data-role="' + r[0] + '" class="rolechip' + (on ? ' on' : '') + '" aria-pressed="' + on + '">' + AV(r[0] === 'owner' ? 'owner' : r[2], '', 34) + r[1] + '</button>';
      }).join('');
      $sheet.querySelector('[data-warm]').innerHTML = [[true, 'Warm'], [false, 'Cold']].map(function (x) {
        var on = st.warm === x[0];
        return '<button type="button" data-w="' + (x[0] ? 1 : 0) + '"' + (on ? ' class="on"' : '') + ' aria-pressed="' + on + '" style="height:40px;border-radius:9px;font-size:15px">' + x[1] + '</button>';
      }).join('');
    }
    chips();
    sheetHandler = function (e, type) {
      if (type) return;
      var b;
      if ((b = e.target.closest('[data-role]'))) { var r = b.getAttribute('data-role'); st.role = st.role === r ? null : r; chips(); return; }
      if ((b = e.target.closest('[data-w]'))) { st.warm = b.getAttribute('data-w') === '1'; chips(); return; }
      if ((b = e.target.closest('[data-save]'))) {
        if (st.busy) return;
        var v = function (n) { return $sheet.querySelector('[name="' + n + '"]').value.trim(); };
        var role = st.role ? ROLES.filter(function (x) { return x[0] === st.role; })[0][2] : null;
        st.busy = true; b.textContent = 'Saving…';
        act('add_person', { firstName: v('firstName'), lastName: v('lastName'), clinic: v('clinic'), phone: v('phone'), email: v('email'), role: role, warm: st.warm, sharedEmailOk: st.sharedEmailOk })
          .then(function (r) { closeSheet(); toast('Saved'); go('/person/' + r.id); },
            function (err) {
              st.busy = false; b.textContent = 'Save person';
              // Someone already has this email (clinics may share one, v2 part B): warn, and let the rep save anyway.
              if (err.message === 'email_yours' || err.message === 'email_someones') { showEmailWarning(err); return; }
              toast(errText(err));
              if (err.message === 'already_yours' && err.detail) { closeSheet(); go('/person/' + err.detail); }
            });
        return;
      }
      if ((b = e.target.closest('[data-open-dupe]'))) { closeSheet(); go('/person/' + b.getAttribute('data-open-dupe')); return; }
      if (e.target.closest('[data-save-anyway]')) { st.sharedEmailOk = true; var s = $sheet.querySelector('[data-save]'); if (s) s.click(); }
    };
    function showEmailWarning(err) {
      var box = $sheet.querySelector('[data-email-warn]');
      if (!box) { box = document.createElement('div'); box.setAttribute('data-email-warn', ''); $sheet.querySelector('[data-save]').insertAdjacentElement('beforebegin', box); }
      box.innerHTML = '<div class="warnbox"><span>' + esc(errText(err)) + ' Clinics can share an email, so you can still save this person.</span>'
        + '<span style="display:flex;gap:8px;flex-wrap:wrap">'
        + (err.message === 'email_yours' && err.detail ? '<button type="button" data-open-dupe="' + esc(err.detail) + '" class="pillbtn" style="height:40px">Open them</button>' : '')
        + '<button type="button" data-save-anyway class="pillbtn" style="height:40px;background:#F5C04A;color:#3A2400">Save anyway</button></span></div>';
    }
  }

  // ---- Email (F7 Email): sent from the rep's Gmail ------------------------------------------------------------
  function openEmail(p) {
    if (!p.email) { toast('No email address for ' + (p.first || p.name) + ' yet.'); return; }
    if (BOOT.gmail !== 'connected') {
      $sheet.innerHTML = '<div class="dim" data-close></div><div class="sheet" role="dialog" aria-modal="true"><span class="grab"></span>'
        + '<span class="sheet-title">Connect Gmail</span>'
        + '<span style="font-size:16px;color:var(--muted);line-height:1.4">Emails go from your own Renellence Gmail. Sign in once more with Google and allow Gmail.</span>'
        + '<button type="button" data-connect class="btn">Connect Gmail</button>'
        + '<button type="button" data-close class="btn soft" style="height:48px">Not now</button></div>';
      sheetHandler = function (e) { if (e.target.closest('[data-connect]')) signIn(location.pathname); };
      return;
    }
    $sheet.innerHTML = '<div class="dim" data-close></div><div class="sheet tall" role="dialog" aria-modal="true" aria-label="Email"><span class="grab"></span>'
      + '<div class="sheet-head"><span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span style="display:flex;align-items:center;gap:8px;font-size:14px;color:var(--muted)">' + AV(p.role, p.name, 26) + '<span class="ellip">' + esc(p.name) + '</span></span>'
      + '<span class="sheet-title">Email</span></span><button type="button" data-close class="pillbtn">Cancel</button></div>'
      + '<div class="well"><div style="display:flex;align-items:center;min-height:50px;padding:0 14px;gap:10px"><span style="width:62px;font-size:15px;color:var(--muted);flex:none">To</span><span style="font-size:16px;font-weight:600;min-width:0;overflow-wrap:anywhere">' + esc(p.email) + '</span></div>'
      + '<span class="hr"></span><label style="display:flex;align-items:center;padding-left:14px;gap:10px"><span style="width:62px;font-size:15px;color:var(--muted);flex:none">Subject</span><input name="subject" aria-label="Subject" style="padding-left:0;font-size:16px;font-weight:600"></label></div>'
      + '<div class="well" style="padding:12px 14px;flex:1"><textarea class="note" name="text" placeholder="Message" aria-label="Message" style="flex:1;min-height:180px"></textarea></div>'
      + '<button type="button" data-send class="btn">Send from Gmail</button></div>';
    sheetHandler = function (e, type) {
      if (type) return;
      var b = e.target.closest('[data-send]');
      if (!b || b.disabled) return;
      b.disabled = true; b.textContent = 'Sending…';
      act('email', { contactId: p.id, to: p.email, subject: $sheet.querySelector('[name="subject"]').value, text: $sheet.querySelector('[name="text"]').value })
        .then(function () { closeSheet(); toast('Sent'); render(); }, function (err) {
          b.disabled = false; b.textContent = 'Send from Gmail'; toast(errText(err));
          if (err.message === 'gmail_reconnect' || err.message === 'gmail_not_connected') BOOT.gmail = 'broken';
        });
    };
  }

  // ---- F14 History and notes ----------------------------------------------------------------------------------
  var historyTab = 'all';
  var TONE = { amber: 'background:#3F3214;color:#F5C04A', green: 'background:#173D2A;color:#62D49E', blue: 'background:#1D3A62;color:#62B2F7', grey: 'background:#2D3856;color:#AEB8CC' };
  // A long note or email shows three lines with "More"; "Less" folds it again (RD12, Yousef 2026-10-23).
  function historyBody(text) {
    var long = L.longText(text);
    return '<span data-body' + (long ? ' class="clamp3"' : '') + ' style="font-size:15px;line-height:1.35;white-space:pre-line">' + esc(text) + '</span>'
      + (long ? '<button type="button" data-hmore class="link" style="align-self:flex-start;min-height:36px">More</button>' : '');
  }
  function screenHistory(id) {
    return paint(read('history', { id: id }), function (d) {
      var entries = d.entries.filter(function (e) {
        return historyTab === 'all' || (historyTab === 'notes' ? (e.type === 'touch' || e.type === 'note') : (e.type === 'order' || e.type === 'samples'));
      });
      var h = '<div class="scr">' + backLink('/person/' + d.id, d.name) + '<div class="head"><h1 class="h1">History</h1></div>'
        + '<div class="seg flat" role="tablist" style="margin-bottom:6px">'
        + [['all', 'All'], ['notes', 'Notes'], ['orders', 'Orders']].map(function (t) {
          return '<button type="button" role="tab" data-htab="' + t[0] + '" aria-selected="' + (historyTab === t[0]) + '"' + (historyTab === t[0] ? ' class="on"' : '') + ' style="height:32px">' + t[1] + '</button>';
        }).join('') + '</div><div style="padding-bottom:12px">';
      var month = '', thisYear = ymd().slice(0, 4);
      entries.forEach(function (e, i) {
        var m = e.month + (e.year !== thisYear ? ' ' + e.year : '');
        if (m !== month) { month = m; h += '<span class="label" style="display:block;padding:8px 2px">' + esc(m) + '</span>'; }
        var line = '<span style="flex:1 1 auto;width:2px;background:' + (i === entries.length - 1 ? 'transparent' : '#3A4664') + '"></span>';
        var badge, card;
        if (e.type === 'touch') {
          badge = '<span class="hb" style="background:#1D3A62;color:#62B2F7">' + ic({ call: 'phone', meeting: 'pin', text: 'text', email: 'mail', note: 'pen' }[e.kind] || 'pen', 16) + '</span>';
          card = '<div class="card hcard"><span class="hhead"><span class="display" style="font-size:15px;font-weight:700">' + esc(e.title) + '</span><span class="hwhen">' + esc(e.when) + '</span></span>'
            + (e.subject ? '<span style="font-size:14px;font-weight:600;color:#C9D1E0">' + esc(e.subject) + '</span>' : '')
            + (e.body ? historyBody(e.kind === 'email' ? e.body : L.stripNext(e.body)) : '')
            + (e.full ? '<button type="button" data-hfull class="link" style="align-self:flex-start;min-height:36px;font-size:13px">Show the whole email</button>'
              + '<span data-fullmail hidden style="font-size:13px;line-height:1.4;white-space:pre-line;color:var(--muted);overflow-wrap:anywhere">' + esc(e.full) + '</span>' : '')
            + (e.next ? '<span style="font-size:15px;line-height:1.35"><b>Next:</b> ' + esc(e.next) + '</span>' : '')
            + '<span style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;color:var(--muted)">' + (e.by === 'You' ? '' : esc(e.by)) + '</span>'
            + (e.editable ? '<button type="button" data-edit="' + e.id + '" data-text="' + esc(e.body) + '" class="link" style="font-size:13px;min-height:36px">Edit</button>' : '') + '</span></div>';
        } else if (e.type === 'note') {
          badge = '<span class="hb" style="background:#3D3318;color:#F5C963">' + ic('pinned', 16) + '</span>';
          card = '<div class="card hcard" style="background:#2A2A2C"><span class="hhead"><span class="display" style="font-size:15px;font-weight:700">' + esc(e.title) + '</span><span class="hwhen">' + esc(e.when) + '</span></span>'
            + historyBody(e.body) + '<span style="font-size:12px;color:var(--muted)">' + esc(e.by) + '</span></div>';
        } else if (e.type === 'order' || e.type === 'samples') {
          badge = '<span class="hb" style="background:#1170C0;color:#FFFFFF">' + ic(e.type === 'order' ? 'box' : 'gift', 16) + '</span>';
          card = '<a href="/orders/' + e.id + '" data-nav class="card hcard" style="gap:6px;box-shadow:var(--edge),inset 3px 0 0 #1170C0">'
            + '<span class="hhead" style="align-items:center"><span class="display" style="font-size:17px;font-weight:700">' + esc(e.title) + '</span><span class="hwhen">' + esc(e.when) + '</span></span>'
            + '<span style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:14px;color:#C9D1E0">' + esc(e.body) + '</span>'
            + '<span class="tag" style="height:22px;padding:0 9px;font-size:12px;' + (TONE[e.tone] || TONE.grey) + '">' + esc(e.status) + '</span></span></a>';
        } else {
          badge = '<span class="hb" style="background:#2D3856;color:#AEB8CC">' + ic('flag', 16) + '</span>';
          card = '<span style="flex:1 1 auto;display:flex;justify-content:space-between;align-items:center;min-height:34px;margin-bottom:10px;font-size:14px;font-weight:600;color:#C9D1E0">' + esc(e.title)
            + '<span style="font-size:13px;font-weight:500;color:var(--muted)">' + esc(e.when) + '</span></span>';
        }
        h += '<div style="display:flex;gap:10px"><span style="width:34px;flex:none;display:flex;flex-direction:column;align-items:center">' + badge + line + '</span>' + card + '</div>';
      });
      if (!entries.length) h += empty('clock', 'Nothing here yet.', historyTab === 'orders' ? 'Orders and samples show here once placed.' : 'Calls, visits and notes show here once logged.');
      return h + '</div></div>';
    }, 'people');
  }
  $app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-htab]');
    if (b) { historyTab = b.getAttribute('data-htab'); render(); return; }
    b = e.target.closest('[data-hfull]');
    if (b) { var full = b.nextElementSibling; full.hidden = !full.hidden; b.textContent = full.hidden ? 'Show the whole email' : 'Hide the whole email'; return; }
    b = e.target.closest('[data-hmore]');
    if (b) { var body = b.previousElementSibling; var open = body.classList.toggle('clamp3') === false; b.textContent = open ? 'Less' : 'More'; return; }
    b = e.target.closest('[data-edit]');
    if (b) {
      var id = b.getAttribute('data-edit'), text = b.getAttribute('data-text');
      $sheet.innerHTML = '<div class="dim" data-close></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Edit note"><span class="grab"></span>'
        + '<div class="sheet-head" style="align-items:center"><span class="sheet-title">Edit note</span><button type="button" data-close class="pillbtn">Cancel</button></div>'
        + '<div class="well" style="padding:12px 14px"><textarea class="note" data-note aria-label="Note" style="min-height:140px">' + esc(text) + '</textarea></div>'
        + '<button type="button" data-save class="btn">Save</button></div>';
      sheetHandler = function (ev, type) {
        if (type || !ev.target.closest('[data-save]')) return;
        act('edit_note', { interactionId: id, body: $sheet.querySelector('[data-note]').value }).then(function () { closeSheet(); render(); }, function (err) { toast(errText(err)); });
      };
    }
  });

  // ---- F16 order, F18 samples, F17 onboarding progress ---------------------------------------------
  function steps(list) {
    return '<section class="card" style="border-radius:22px;padding:20px 18px;margin-bottom:12px">' + list.map(function (s, i) {
      var last = i === list.length - 1;
      var dot = s.done ? '<span class="sdone">' + ic('check', 14, 3.4) + '</span>'
        : s.current ? '<span class="snow"><span></span></span>' : '<span class="snext"></span>';
      var lineColor = s.done && list[i + 1] && (list[i + 1].done || list[i + 1].current) ? '#1170C0' : '#D6DCE6';
      var color = s.done ? 'var(--ink)' : s.current ? 'var(--sky)' : 'var(--faint)', sub = s.done ? 'var(--muted)' : color;
      return '<div style="display:flex;gap:14px"><span style="display:flex;flex-direction:column;align-items:center;width:28px;flex:none">' + dot
        + (last ? '' : '<span style="flex:1 1 auto;width:3px;background:' + lineColor + ';min-height:30px"></span>') + '</span>'
        + '<span style="display:flex;flex-direction:column;padding:3px 0 ' + (last ? '0' : '18px') + '"><span class="display" style="font-size:17px;font-weight:700;color:' + color + '">' + esc(s.label) + '</span>'
        + '<span style="font-size:14px;font-weight:500;color:' + sub + '">' + esc(s.when || '') + '</span></span></div>';
    }).join('') + '</section>';
  }
  function bigButton(attr, label) { return '<button type="button" ' + attr + ' class="btn" style="height:54px;border-radius:14px;font-weight:600">' + esc(label) + '</button>'; }
  function doneRow(label, value, ok) {
    return '<div class="card r18" style="margin-top:14px;min-height:52px;padding:0 14px;display:flex;align-items:center;gap:10px">'
      + (ok ? '<span class="sdone" style="width:22px;height:22px">' + ic('check', 13, 3) + '</span>' : '<span class="snext" style="width:22px;height:22px"></span>')
      + '<span style="font-size:15px;font-weight:600;flex:1 1 auto">' + esc(label) + '</span><span style="font-size:14px;color:var(--muted)">' + esc(value) + '</span></div>';
  }
  function screenOrderStatus(id) {
    return paint(read('order', { id: id }), function (o) {
      var h = '<div class="scr">' + backLink('/person/' + o.contactId, o.name)
        + '<div class="head"><h1 class="h1">' + (o.sample ? 'Samples' : 'Order') + '</h1><span style="font-size:17px;font-weight:600;color:var(--muted);padding-bottom:6px">' + esc(o.total) + '</span></div>'
        + steps(o.steps);
      if (o.action === 'resend_pay_link') h += bigButton('data-nudge="resend_pay_link" data-order="' + o.id + '"', 'Resend pay link');
      if (o.action === 'remind_md') h += bigButton('data-nudge="remind_md" data-order="' + o.id + '"', 'Remind MD to sign');
      if (o.onboarding) h += doneRow(o.onboarding.label, o.onboarding.value, o.onboarding.done);
      if (o.lines.length) {
        h += '<section class="card r18" style="margin-top:14px;padding:4px 0">' + o.lines.map(function (l, i) {
          return '<div style="display:flex;justify-content:space-between;align-items:center;min-height:46px;padding:0 14px' + (i ? ';border-top:0.5px solid var(--line)' : '') + '"><span style="font-size:15px">' + esc(l.name) + '</span>'
            + '<span class="tag free">' + l.qty + ' · Free</span></div>';
        }).join('') + '</section>';
      }
      return h + '</div>';
    }, 'people');
  }
  function screenOnboarding(id) {
    return paint(read('onboarding', { id: id }), function (o) {
      var h = '<div class="scr">' + backLink('/person/' + o.id, o.name) + '<div class="head"><h1 class="h1">Onboarding</h1></div>';
      if (o.none) return h + empty('pen', 'No onboarding form yet.', 'It shows here once the clinic fills in the form.') + '</div>';
      h += steps(o.steps);
      if (o.action === 'remind_md') h += bigButton('data-nudge="remind_md" data-onboarding="' + o.onboardingId + '"', 'Remind MD to sign');
      return h + doneRow('Card on file', o.card, o.cardDone) + '</div>';
    }, 'people');
  }
  $app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-nudge]');
    if (!b || b.disabled) return;
    b.disabled = true;
    var op = b.getAttribute('data-nudge');
    act(op, { orderId: b.getAttribute('data-order') || undefined, onboardingId: b.getAttribute('data-onboarding') || undefined }).then(function (r) {
      if (r.ok) { b.textContent = 'Sent ✓'; b.style.background = 'var(--raised)'; b.style.color = 'var(--green)'; }
      else {
        b.disabled = false;
        toast({ no_open_link: 'No open pay link for this order. Ask an admin to send a new one.', not_waiting: 'This one isn’t waiting on a signature any more.',
          nobody_to_remind: 'Everyone has signed, or the email bounced. Ask an admin.' }[r.reason] || 'Couldn’t send it yet. Ask an admin to check the order connection.');
      }
    }, function (err) { b.disabled = false; toast(errText(err)); });
  });

  // ---- F9 New order: who is it for? -------------------------------------------------------------------------
  var readyPeople = [];
  function screenWho() {
    return paint(read('ready'), function (d) {
      readyPeople = d.people;
      return '<div class="scr"><h1 class="h1" style="padding:0 4px 10px">New order</h1>'
        + '<h2 class="h2" style="padding:0 4px 10px">Who is it for?</h2>'
        + searchBox('ready', 'Find a person', 'margin-bottom:10px')
        + '<section data-ready class="card r18">' + readyRows(readyPeople) + '</section></div>';
    }, 'order');
  }
  function readyRows(list) {
    if (!list.length) return '<div class="row" style="min-height:76px"><span class="round">' + ic('box', 18) + '</span><span class="grow"><span class="t">Nobody is ready to order yet</span><span class="sub">People show here once they are onboarded or have ordered before.</span></span></div>';
    return list.map(function (p) {
      var tag = p.tag === 'Going cold' ? 'cold' : p.tag === 'Reorder due' ? 'due' : 'quiet';
      return '<a href="/order/' + p.id + '" data-nav class="row" style="min-height:66px">' + AV(p.role, p.name, 42, avState({ stage: 'fifty', tag: p.tag }), p.id)
        + '<span class="grow"><span class="t ellip">' + esc(p.name) + '</span><span class="sub ellip">' + nb(p.clinic) + '</span></span>'
        + '<span style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:none">' + (p.last ? '<span class="num" style="font-size:15px;font-weight:700">' + esc(p.last) + '</span>' : '')
        + '<span class="tag ' + tag + '">' + esc(p.tag) + '</span></span></a>';
    }).join('');
  }
  function filterReady(q) {
    var t = q.toLowerCase();
    $app.querySelector('[data-ready]').innerHTML = readyRows(readyPeople.filter(function (p) { return !t || (p.name + ' ' + p.clinic).toLowerCase().indexOf(t) >= 0; }));
  }

  // ---- F9 New order: the products ----------------------------------------------------------------------------
  // The draft order lives here until it is sent: { contactId, qty: { sku: n }, free: { sku: n }, price: { sku: $ },
  // payment, approvalNote, shippingNote, mdName, mdEmail }. Only free units = a sample order (MD signs; Review samples).
  // F9 groups the products: saypha one row each; Magic Needle and Mesbio one row each with a size; the rest under More.
  var draft = null;
  function draftFor(contactId) {
    if (!draft || draft.contactId !== contactId) draft = { contactId: contactId, qty: {}, free: {}, price: {}, payment: 'card_on_file', approvalNote: '', shippingNote: '', mdName: '', mdEmail: '' };
    return draft;
  }
  var money2 = function (n) { return '$' + (Math.round(n * 100) / 100).toLocaleString('en-CA', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
  function productGroups(products) {
    var by = function (c) { return products.filter(function (p) { return p.cat === c; }); };
    var fam = function (key, name, list) {
      if (!list.length) return null;
      var prices = list.map(function (p) { return p.price; }), lo = Math.min.apply(null, prices), hi = Math.max.apply(null, prices);
      return { key: key, name: name, family: true, items: list, base: list.length + ' sizes · ' + (lo === hi ? money2(lo) : money2(lo) + '–' + money2(hi)), icon: 'needle' };
    };
    var one = function (p) { return { key: p.sku, name: p.fullName || p.name, items: [p], base: p.unavailable ? 'Unavailable right now' : p.freeOnly ? 'Free item' : p.cat === 'saypha' ? '' : money2(p.price) }; };
    return [
      ['saypha', by('saypha').map(one)],
      ['Needles and cannulas', [fam('cannula', 'Magic Needle cannula', by('cannula')), fam('mesbio', 'Mesbio needle', by('mesbio'))].filter(Boolean)],
      ['More', by('skin').concat(by('prp'), by('other')).map(one)],
    ].filter(function (g) { return g[1].length; });
  }
  function lineText(p, dft) {
    var q = dft.qty[p.sku] || 0, f = dft.free[p.sku] || 0, pr = L.priceOf(p, dft);
    if (!q && !f) return '';
    return (p.cat === 'cannula' || p.cat === 'mesbio' ? p.name + ' · ' : '') + (q ? (p.freeOnly || !(pr > 0) ? q + ' free' : q + ' × ' + money2(pr)) : '') + (q && f ? ' + ' : '') + (f ? f + ' free' : '');
  }
  function screenProducts(contactId) {
    var dft = draftFor(contactId);
    return paint(read('products', { id: contactId }), function (d) {
      dft.products = d;
      var sum = L.draftSummary(d.products, dft);
      var h = '<div class="scr" style="padding-bottom:calc(var(--safe-bottom) + 176px)"><h1 class="h1" style="padding:0 4px 10px">New order</h1>'
        + '<div class="card" style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:4px">' + AV(d.person.role, d.person.name, 36)
        + '<span class="grow" style="display:flex;flex-direction:column;flex:1;min-width:0"><span class="ellip" style="font-size:16px;font-weight:700">' + esc(d.person.name) + '</span><span class="ellip" style="font-size:12px;color:var(--muted)">' + nb(d.person.clinic) + '</span></span>'
        + '<a href="/order" data-nav class="link" style="padding-left:8px">Change</a></div>';
      productGroups(d.products).forEach(function (g) {
        h += '<div class="kicker" style="padding:16px 4px 8px">' + esc(g[0]) + '</div><section class="card r18 plist">';
        g[1].forEach(function (r) {
          var n = 0, subs = [];
          r.items.forEach(function (p) { n += (dft.qty[p.sku] || 0) + (dft.free[p.sku] || 0); var t = lineText(p, dft); if (t) subs.push(t); });
          var na = r.items.length === 1 && r.items[0].unavailable;
          h += '<div class="prow' + (n ? ' added' : '') + '">'
            + '<button type="button" class="pmain" data-prow="' + esc(r.key) + '"' + (na ? ' disabled' : '') + '>' + (na ? '<span style="opacity:.4;display:flex">' : '') + thumb(r.family ? 'needle' : r.items[0].freeOnly ? 'free item' : (r.items[0].sku + ' ' + r.name), 40) + (na ? '</span>' : '')
            + '<span class="grow"><span class="t">' + esc(r.name) + '</span>' + (n ? '<span class="sub ellip" style="color:var(--sky);font-weight:600">' + esc(subs.join(' · ')) + '</span>' : r.base ? '<span class="sub ellip">' + esc(r.base) + '</span>' : '') + '</span>'
            + (n ? '<span class="pcount num">' + n + '</span>' : '') + '</button>'
            + (n ? '<button type="button" class="pclear" data-pclear="' + esc(r.key) + '" aria-label="Remove ' + esc(r.name) + '"><span>✕</span></button>'
              : na ? '' : '<button type="button" class="padd" data-prow="' + esc(r.key) + '" aria-label="Add ' + esc(r.name) + '"><span>+</span></button>') + '</div>';
        });
        h += '</section>';
      });
      h += '<div class="orderbar">' + (sum.empty ? '' : '<button type="button" data-clear-order class="clearorder">Clear order</button>')
        + (sum.empty ? '<span class="sumbar off"><span style="display:flex;flex-direction:column"><span class="num" style="font-size:16px;font-weight:700">Nothing added yet</span><span style="font-size:12px;color:var(--muted)">Tap a product to add it</span></span><span class="go" aria-disabled="true">Review</span></span>'
          : '<a href="/order/' + contactId + '/review" data-nav class="sumbar"><span style="display:flex;flex-direction:column"><span class="num" style="font-size:16px;font-weight:700">' + esc(sum.line) + '</span><span style="font-size:12px;color:var(--muted)">' + esc(sum.sub) + '</span></span><span class="go num">Review</span></a>')
        + '</div></div>';
      return h;
    }, 'order');
  }
  // The product sheet (F9): size (Magic Needle, Mesbio), quantity, free, and for saypha the price each.
  // saypha's price each (owner 2026-10-27): $135, $155, the product's list price ($225; $245 for volume plus), or Custom.
  var TIERS = function (p) { return [135, 155, p.price].filter(function (v, i, a) { return a.indexOf(v) === i; }); };
  // after: the screen to show once saved (Review edits its items in place, owner 2026-10-27); default the products list.
  function productSheet(row, after) {
    var dft = draft, fam = row.family;
    var pickSku = fam ? (row.items.filter(function (p) { return (dft.qty[p.sku] || dft.free[p.sku]); })[0] || row.items[0]).sku : row.items[0].sku;
    var st = { sku: pickSku, op: null };
    function prod() { return row.items.filter(function (p) { return p.sku === st.sku; })[0]; }
    function load() { var p = prod(); st.q = dft.qty[p.sku] || (fam || p.freeOnly ? 0 : 0); st.f = dft.free[p.sku] || 0; st.price = dft.price[p.sku] != null ? dft.price[p.sku] : p.price; st.had = !!(dft.qty[p.sku] || dft.free[p.sku]); st.custom = TIERS(p).indexOf(st.price) < 0; if (!st.had && !p.freeOnly) st.q = 1; if (!st.had && p.freeOnly) st.f = 1; }
    load();
    function field(op, label, value) {
      return '<button type="button" class="pfield' + (st.op === op ? ' on' : '') + '" data-op="' + op + '" aria-expanded="' + (st.op === op) + '"><span class="pl">' + label + '</span><span class="pv num">' + esc(value) + '</span>'
        + '<svg class="pchev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="' + (st.op === op ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6') + '"/></svg></button>';
    }
    function opts() {
      var p = prod();
      if (st.op === 'size') return row.items.map(function (x) { return [x.sku, x.name + (row.key === 'mesbio' ? ' · ' + money2(x.price) : '')]; });
      if (st.op === 'price') return TIERS(p).map(function (v) { return [String(v), money2(v)]; }).concat([['custom', 'Custom']]);
      var a = []; for (var i = 0; i <= 100; i++) a.push([String(i), String(i)]); return a;
    }
    function cur() { return st.op === 'size' ? st.sku : st.op === 'price' ? (st.custom ? 'custom' : String(st.price)) : String(st.op === 'q' ? st.q : st.f); }
    function draw() {
      var p = prod(), say = p.cat === 'saypha', unit = p.freeOnly ? 0 : st.price, total = (st.q || 0) * unit;
      var h = '<div class="dim" data-close></div><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(row.name) + '"><span class="grab"></span>'
        + '<div class="sheet-head" style="align-items:center"><span class="display" style="font-size:24px;font-weight:800;letter-spacing:-0.6px">' + esc(row.name) + '</span><button type="button" data-close class="pillbtn">Cancel</button></div>';
      if (fam) h += field('size', 'Size', p.name);
      h += '<div style="display:grid;grid-template-columns:' + (p.freeOnly ? '1fr' : '1fr 1fr') + ';gap:10px">' + (p.freeOnly ? '' : field('q', 'Quantity', String(st.q))) + field('f', 'Free', String(st.f)) + '</div>';
      if (say) h += field('price', 'Price each', st.custom ? 'Custom' : money2(st.price));
      if (say && st.custom) h += '<label class="pfield on" style="display:flex;align-items:center"><span class="pl">Custom price each</span><span style="padding:18px 0 0 0;font-size:17px;font-weight:600">$</span>'
        + '<input type="text" inputmode="decimal" data-custom value="' + (st.price ? String(st.price) : '') + '" placeholder="0" aria-label="Custom price each" class="num" style="flex:1;min-width:0;border:0;background:transparent;color:var(--ink);font-size:17px;font-weight:600;padding:18px 0 0 2px;outline:none"></label>';
      if (!say && !p.freeOnly) h += '<span style="font-size:14px;color:var(--muted);padding:0 2px">' + money2(p.price) + ' each</span>';
      if (st.op) {
        var c = cur();
        h += '<div class="picker"><div class="pscroll noscroll" role="listbox">' + opts().map(function (o) {
          var on = o[0] === c;
          return '<button type="button" role="option" aria-selected="' + on + '" data-opt="' + esc(o[0]) + '" class="popt num' + (on ? ' on' : '') + '">' + esc(o[1]) + (on ? '<span>✓</span>' : '') + '</button>';
        }).join('') + '</div><span class="pfade"></span></div>';
      }
      var any = (st.q || 0) + (st.f || 0) > 0;
      h += '<div style="display:flex;gap:10px;margin-top:4px">' + (st.had ? '<button type="button" data-premove class="btn soft" style="width:auto;padding:0 18px;color:var(--danger);height:54px">Remove</button>' : '')
        + '<button type="button" data-psave class="btn num' + (any || st.had ? '' : ' off') + '" style="flex:1;height:54px">' + (st.had ? 'Update' : 'Add to order') + (total ? ' · ' + money2(total) : '') + '</button></div></div>';
      $sheet.innerHTML = h;
      if (st.op) { var on = $sheet.querySelector('.popt.on'); if (on) on.scrollIntoView({ block: 'center' }); }
    }
    draw();
    function save(remove) {
      var p = prod();
      if (remove) { delete dft.qty[p.sku]; delete dft.free[p.sku]; delete dft.price[p.sku]; }
      else {
        if (st.q) dft.qty[p.sku] = st.q; else delete dft.qty[p.sku];
        if (st.f) dft.free[p.sku] = st.f; else delete dft.free[p.sku];
        if (p.cat === 'saypha' && st.price !== p.price) dft.price[p.sku] = st.price; else delete dft.price[p.sku];
      }
      closeSheet(); keepScroll(after || function () { return screenProducts(dft.contactId); });
    }
    sheetHandler = function (e, type) {
      if (type === 'input' || type === 'change') { var c = e.target.closest('[data-custom]'); if (c) st.price = L.parsePrice(c.value); if (type === 'change' && c) draw(); return; }
      if (type) return;
      var b;
      if ((b = e.target.closest('[data-op]'))) { var op = b.getAttribute('data-op'); st.op = st.op === op ? null : op; draw(); return; }
      if ((b = e.target.closest('[data-opt]'))) {
        var v = b.getAttribute('data-opt');
        if (st.op === 'size') { st.sku = v; load(); }
        else if (st.op === 'price') { st.custom = v === 'custom'; if (!st.custom) st.price = +v; }
        else if (st.op === 'q') st.q = +v; else st.f = +v;
        st.op = null; draw();
        if (st.custom) { var ci = $sheet.querySelector('[data-custom]'); if (ci) ci.focus(); }
        return;
      }
      if (e.target.closest('[data-premove]')) { save(true); return; }
      if (e.target.closest('[data-psave]')) { if ((st.q || 0) + (st.f || 0) === 0 && !st.had) return;
        if (!L.priceChoiceOk(st.custom && prod().cat === 'saypha', st.q, st.price)) { toast('Enter a price above $0, or pick another price.'); var ci = $sheet.querySelector('[data-custom]'); if (ci) ci.focus(); return; } save((st.q || 0) + (st.f || 0) === 0); }
    };
  }
  $app.addEventListener('click', function (e) {
    if (!draft || !draft.products) return;
    var b = e.target.closest('[data-prow]');
    if (b) {
      var key = b.getAttribute('data-prow');
      productGroups(draft.products.products).forEach(function (g) { g[1].forEach(function (r) { if (r.key === key) productSheet(r); }); });
      return;
    }
    if ((b = e.target.closest('[data-pclear]'))) {
      var k = b.getAttribute('data-pclear');
      productGroups(draft.products.products).forEach(function (g) { g[1].forEach(function (r) { if (r.key === k) r.items.forEach(function (p) { delete draft.qty[p.sku]; delete draft.free[p.sku]; delete draft.price[p.sku]; }); }); });
      keepScroll(function () { return screenProducts(draft.contactId); });
      return;
    }
    if (e.target.closest('[data-clear-order]')) { draft.qty = {}; draft.free = {}; draft.price = {}; screenProducts(draft.contactId); }
  });
  function keepScroll(fn) { var y = window.scrollY; Promise.resolve(fn()).then(function () { window.scrollTo(0, y); }); }

  // ---- F10 / F15 Review and send ------------------------------------------------------------------------------
  function orderLines(d, dft) {
    var out = [];
    d.products.forEach(function (p) {
      var q = dft.qty[p.sku] || 0, f = dft.free[p.sku] || 0, pr = L.priceOf(p, dft);
      if (q) out.push(p.freeOnly || !(pr > 0) ? { p: p, qty: q, free: true, price: 0 } : { p: p, qty: q, free: false, price: pr });
      if (f) out.push({ p: p, qty: f, free: true, price: 0 });
    });
    return out.filter(function (l) { return !l.free; }).concat(out.filter(function (l) { return l.free; }));
  }
  var sentOrder = null;
  // The product row (one product, or a size family) a sku belongs to.
  function rowOf(d, sku) {
    var hit = null;
    productGroups(d.products).forEach(function (g) { g[1].forEach(function (r) { if (r.items.some(function (p) { return p.sku === sku; })) hit = r; }); });
    return hit || { key: sku };
  }
  // Review's "Add a product": the products list in a sheet; picking one opens its own sheet.
  function addItemSheet(after) {
    var groups = productGroups(draft.products.products);
    var h = '<div class="dim" data-close></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Add a product"><span class="grab"></span>'
      + '<div class="sheet-head" style="align-items:center"><span class="display" style="font-size:24px;font-weight:800;letter-spacing:-0.6px">Add a product</span><button type="button" data-close class="pillbtn">Cancel</button></div>'
      + '<div style="max-height:60dvh;overflow-y:auto;overscroll-behavior:contain">';
    groups.forEach(function (g) {
      h += '<div class="kicker" style="padding:10px 4px 6px">' + esc(g[0]) + '</div><section class="card r18 plist">';
      g[1].forEach(function (r) {
        var na = r.items.length === 1 && r.items[0].unavailable;
        h += '<div class="prow"><button type="button" class="pmain" data-addrow="' + esc(r.key) + '"' + (na ? ' disabled' : '') + '>' + thumb(r.family ? 'needle' : r.items[0].freeOnly ? 'free item' : (r.items[0].sku + ' ' + r.name), 36)
          + '<span class="grow"><span class="t">' + esc(r.name) + '</span>' + (r.base ? '<span class="sub ellip">' + esc(r.base) + '</span>' : '') + '</span></button></div>';
      });
      h += '</section>';
    });
    $sheet.innerHTML = h + '</div></div>';
    sheetHandler = function (e, type) {
      if (type) return;
      var b = e.target.closest('[data-addrow]');
      if (!b || b.disabled) return;
      var k = b.getAttribute('data-addrow');
      groups.forEach(function (g) { g[1].forEach(function (r) { if (r.key === k) { closeSheet(); productSheet(r, after); } }); });
    };
  }
  function screenReview(contactId) {
    var dft = draftFor(contactId);
    return paint(read('products', { id: contactId }), function (d) {
      dft.products = d;
      var lines = orderLines(d, dft);
      if (!lines.length) { setTimeout(function () { go('/order/' + contactId, true); }, 0); return loading(); }
      var sum = L.draftSummary(d.products, dft), samples = sum.samples, who = d.person;
      function info(label, value, first) { return '<div class="kv" style="min-height:48px' + (first ? '' : '') + '"><span class="k">' + label + '</span><span class="v">' + value + '</span></div>'; }
      var noShip = dft.noShip = !(who.shipping.street && who.shipping.city);
      var h = '<div class="scr">' + backLink('/order/' + contactId, 'Edit order')
        + '<h1 class="display" style="font-size:30px;font-weight:800;letter-spacing:-1.1px;padding:0 4px 8px">Review</h1>'
        + '<div class="sect" style="padding:6px 4px"><span class="label">' + esc(who.name + (who.clinic ? ' · ' + who.clinic : '')) + '</span></div>'
        + '<section class="card" style="margin-bottom:10px">' + info('Email', esc(who.email || 'None'), true)
        + info('Ship to', noShip ? '<span style="color:var(--danger)">No address yet</span>' : esc(who.shipping.line))
        + info('Billing', L.billingSame(who) ? 'Same as shipping' : esc(who.billing.line)) + (who.secondaryEmail ? info('Invoice email', esc(who.secondaryEmail)) : '') + '</section>'
        + (noShip ? '<button type="button" data-ship-address class="link" style="margin:-8px 0 -2px;padding:0 4px">' + ic('plus', 14) + ' Add a shipping address</button>' : '')
        + (who.secondaryEmail ? '' : '<button type="button" data-invoice-email class="link" style="margin:-8px 0 -2px;padding:0 4px">' + ic('plus', 14) + ' Add an invoice email</button>')
        + '<div class="sect" style="padding:6px 4px"><span class="label">Items</span><button type="button" data-items-edit class="link" style="min-height:32px">' + (dft.editItems ? 'Done' : 'Edit') + '</button></div>'
        + '<section class="card" style="margin-bottom:10px">' + lines.map(function (l, i) {
          var v = l.free ? '<span class="tag free">Free</span>' : money2(l.qty * l.price);
          if (dft.editItems) return '<button type="button" class="kv" data-item-row="' + esc(rowOf(d, l.p.sku).key) + '" style="min-height:48px' + (i ? ';border-top:0.5px solid var(--line)' : '') + '"><span class="k" style="flex:0 1 auto">' + esc(l.p.fullName || l.p.name) + ' · ' + l.qty + '</span><span class="v" style="display:flex;align-items:center;gap:6px">' + v + CHEV + '</span></button>';
          return info(esc(l.p.fullName || l.p.name) + ' · ' + l.qty, v, !i).replace('class="k"', 'class="k" style="flex:0 1 auto"');
        }).join('')
          + (dft.editItems ? '<button type="button" class="kv" data-item-add style="min-height:48px;border-top:0.5px solid var(--line);color:var(--sky);font-weight:600;justify-content:flex-start;gap:8px">' + ic('plus', 15, 2.2) + 'Add a product</button>' : '')
          + (samples ? '' : '<div class="kv" style="min-height:48px"><b style="font-size:15px">Total</b><b style="font-size:17px">' + money2(sum.total) + '</b></div>') + '</section>';
      if (samples) {
        h += '<div class="sect" style="padding:6px 4px"><span class="label">Medical director</span></div>'
          + '<section class="card" style="margin-bottom:4px">'
          + '<label class="kv" style="min-height:48px;justify-content:flex-start"><span class="k" style="width:52px">Name</span><input type="text" data-md="mdName" value="' + esc(dft.mdName) + '" placeholder="Dr. name" aria-label="Medical director name" class="mdin"></label>'
          + '<label class="kv" style="min-height:48px;justify-content:flex-start"><span class="k" style="width:52px">Email</span><input type="email" spellcheck="false" autocapitalize="off" data-md="mdEmail" value="' + esc(dft.mdEmail) + '" placeholder="md@clinic.ca" aria-label="Medical director email" class="mdin"></label></section>'
          + '<span style="display:block;font-size:13px;color:var(--muted);padding:0 4px 12px">Signs after approval. Ships once signed.</span>';
      } else {
        h += '<div class="sect" style="padding:6px 4px"><span class="label">Payment</span></div>'
          + '<div class="seg flat" style="margin-bottom:6px">' + [['card_on_file', 'Card on file'], ['wire', 'Wire / e-transfer']].map(function (x) {
            return '<button type="button" data-pay="' + x[0] + '" aria-pressed="' + (dft.payment === x[0]) + '"' + (dft.payment === x[0] ? ' class="on"' : '') + '>' + x[1] + '</button>';
          }).join('') + '</div>'
          + '<span style="display:block;font-size:13px;color:var(--muted);padding:0 4px 12px;line-height:1.35">' + (dft.payment === 'wire' ? 'They get an invoice with wire and e-transfer details, due within their payment terms (usually net 30). It counts as ordered now and as paid once the money is marked received.'
            : d.card.saved ? esc(d.card.text) + ' · charged once approved. No card or declined? They get a pay link.' : 'No card on file. They get a pay link once approved.') + '</span>';
      }
      function noteRow(key, label, ph) {
        var open = !!(dft[key] || dft['open_' + key]);
        return '<div><button type="button" data-notebtn="' + key + '" aria-expanded="' + open + '" class="kv" style="min-height:48px;font-size:15px;font-weight:600">' + label
          + '<span class="num" style="color:var(--sky);font-size:20px;font-weight:500">' + (open ? '–' : '+') + '</span></button>'
          + (open ? '<textarea rows="2" data-notefield="' + key + '" aria-label="' + label + '" placeholder="' + ph + '" class="mdnote">' + esc(dft[key]) + '</textarea>' : '') + '</div>';
      }
      h += '<div class="sect" style="padding:6px 4px"><span class="label">Notes</span></div><section class="card notes" style="margin-bottom:12px">'
        + noteRow('approvalNote', 'Note for approval', 'Only management sees this') + noteRow('shippingNote', 'Shipping note', 'Goes to the warehouse') + '</section>'
        + '<div class="sendbar">' + (noShip ? '<span style="display:block;font-size:14px;font-weight:600;color:var(--danger);text-align:center;padding:0 4px 8px">Add a shipping address to send this order.</span>' : '')
        + '<button type="button" data-send-order class="btn' + (noShip ? ' off' : '') + '"' + (noShip ? ' aria-disabled="true"' : '') + ' style="border-radius:14px;font-weight:600">Send for approval</button></div>';
      return h + '</div>';
    }, 'order');
  }
  function sentScreen(r, samples) {
    $app.innerHTML = '<div class="scr" style="align-items:center;text-align:center;padding-top:calc(var(--safe-top) + 90px)">'
      + '<span class="sentok">' + ic('check', 46, 2.2) + '</span>'
      + '<h1 class="display" style="font-size:30px;font-weight:800;letter-spacing:-1.1px;margin-top:20px">Sent for approval</h1>'
      + '<span style="font-size:17px;color:#C9D1E0;margin-top:8px;max-width:320px">' + (!r.sentToN8n ? 'Saved. It goes for approval as soon as the order connection answers.' : samples ? 'The MD signs once it’s approved.' : 'You’ll get a text when it’s approved.') + '</span>'
      + '<div style="margin-top:auto;width:100%;padding-bottom:12px"><a href="/orders/' + r.orderId + '" data-nav class="btn" style="border-radius:14px;font-weight:600">See status</a></div></div>' + tabs('order');
  }
  $app.addEventListener('input', function (e) {
    if (!draft) return;
    var t = e.target.closest('[data-md]');
    if (t) { draft[t.getAttribute('data-md')] = t.value; return; }
    t = e.target.closest('[data-notefield]');
    if (t) draft[t.getAttribute('data-notefield')] = t.value;
  });
  $app.addEventListener('click', function (e) {
    if (!draft) return;
    var b = e.target.closest('[data-pay]');
    if (b) { draft.payment = b.getAttribute('data-pay'); keepScroll(function () { return screenReview(draft.contactId); }); return; }
    if ((b = e.target.closest('[data-notebtn]'))) {
      var k = b.getAttribute('data-notebtn');
      if (draft[k]) return;
      draft['open_' + k] = !draft['open_' + k];
      keepScroll(function () { return screenReview(draft.contactId); });
      setTimeout(function () { var f = $app.querySelector('[data-notefield="' + k + '"]'); if (f) f.focus(); }, 80);
      return;
    }
    // Items edited on Review itself (owner 2026-10-27): tap a line for its sheet, or add a product; saving comes back here.
    if (e.target.closest('[data-items-edit]')) { draft.editItems = !draft.editItems; keepScroll(function () { return screenReview(draft.contactId); }); return; }
    var back = function () { return screenReview(draft.contactId); };
    if ((b = e.target.closest('[data-item-row]'))) {
      var rk = b.getAttribute('data-item-row');
      productGroups(draft.products.products).forEach(function (g) { g[1].forEach(function (r) { if (r.key === rk) productSheet(r, back); }); });
      return;
    }
    if (e.target.closest('[data-item-add]')) { addItemSheet(back); return; }
    if (e.target.closest('[data-invoice-email]')) { invoiceEmailSheet(draft.contactId); return; }
    if (e.target.closest('[data-ship-address]')) { shippingSheet(draft.contactId); return; }
    if ((b = e.target.closest('[data-send-order]'))) {
      if (b.disabled) return;
      if (draft.noShip) { toast(errText({ message: 'no_shipping_address' })); shippingSheet(draft.contactId); return; }
      b.disabled = true; b.textContent = 'Sending…';
      var d = draft, samples = L.draftSummary(d.products.products, d).samples;
      act('order', { contactId: d.contactId, payment: d.payment, approvalNote: d.approvalNote, shippingNote: d.shippingNote, mdName: d.mdName, mdEmail: d.mdEmail,
        lines: orderLines(d.products, d).map(function (l) { return l.free ? { sku: l.p.sku, qty: l.qty, free: true } : { sku: l.p.sku, qty: l.qty, price: l.price }; }) })
        .then(function (r) {
          draft = null; sentScreen(r, samples);
          // Payday (N1): every order with money on it; the amount is the server's, never an estimate.
          var pd = r.payday, who = d.products && d.products.person;
          if (pd) nellMoment('payday', { kicker: 'PAYDAY', big: '+' + pd.amount, line: 'On its way to you',
            sub: 'Commission on ' + ((who && (who.clinic || who.name)) || 'this') + '’s order, counted once it’s paid', pill: 'Rewards balance · ' + pd.balance });
        },
          function (err) { b.disabled = false; b.textContent = 'Send for approval'; toast(errText(err)); if (err && err.message === 'no_shipping_address') shippingSheet(d.contactId); });
    }
  });
  // RD11: the shipping address, added from Review (billing copies it when they have none yet).
  function shippingSheet(contactId) {
    var s = (draft && draft.products && draft.products.person && draft.products.person.shipping) || {};
    var field = function (k, label, ph, first) {
      return (first ? '' : '<span class="hr"></span>') + '<label style="display:flex;align-items:center;gap:10px;padding-left:14px"><span style="width:72px;font-size:15px;color:var(--muted);flex:none">' + label + '</span>'
        + '<input type="text" data-addr="' + k + '" value="' + esc(s[k] || '') + '" placeholder="' + ph + '" aria-label="' + label + '" style="padding-left:0"></label>';
    };
    $sheet.innerHTML = '<div class="dim" data-close></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Shipping address"><span class="grab"></span>'
      + '<div class="sheet-head" style="align-items:center"><span class="sheet-title">Shipping address</span><button type="button" data-close class="pillbtn">Cancel</button></div>'
      + '<div class="well">' + field('street', 'Street', '12 Main St', true) + field('city', 'City', 'Toronto') + field('province', 'Province', 'ON') + field('postal', 'Postal', 'M5V 1A1') + '</div>'
      + '<button type="button" data-save class="btn">Save</button></div>';
    setTimeout(function () { var i = $sheet.querySelector('[data-addr="street"]'); if (i) i.focus(); }, 60);
    sheetHandler = function (e, type) {
      if (type || !e.target.closest('[data-save]')) return;
      var v = function (k) { return $sheet.querySelector('[data-addr="' + k + '"]').value; };
      act('shipping_address', { contactId: contactId, street: v('street'), city: v('city'), province: v('province'), postal: v('postal') })
        .then(function () { closeSheet(); screenReview(contactId); }, function (err) { toast(errText(err)); });
    };
  }
  function invoiceEmailSheet(contactId) {
    $sheet.innerHTML = '<div class="dim" data-close></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Invoice email"><span class="grab"></span>'
      + '<div class="sheet-head" style="align-items:center"><span class="sheet-title">Invoice email</span><button type="button" data-close class="pillbtn">Cancel</button></div>'
      + '<div class="well"><input type="email" spellcheck="false" autocapitalize="off" data-inv placeholder="accounts@clinic.ca" aria-label="Invoice email"></div>'
      + '<button type="button" data-save class="btn">Save</button></div>';
    setTimeout(function () { var i = $sheet.querySelector('[data-inv]'); if (i) i.focus(); }, 60);
    sheetHandler = function (e, type) {
      if (type || !e.target.closest('[data-save]')) return;
      act('invoice_email', { contactId: contactId, email: $sheet.querySelector('[data-inv]').value }).then(function () { closeSheet(); screenReview(contactId); }, function (err) { toast(errText(err)); });
    };
  }

  // ---- F11 Rewards ------------------------------------------------------------------------------------------
  var rewardsData = null;
  function winRow(w) {
    return '<div class="row" style="min-height:58px"><span class="coinwrap">' + coin(34) + '</span>'
      + '<span class="grow"><span style="font-size:15px;font-weight:600">' + esc(w.kind) + '</span><span class="sub ellip">' + esc(w.name) + ' · ' + esc(w.when) + '</span></span>'
      + '<span class="goldtext num">+' + esc(w.earned) + '</span></div>';
  }
  function podium(t) {
    var rows = t.rows.slice(0, 3), order = [rows[1], rows[0], rows[2]].filter(Boolean);
    // A podium (owner 2026-10-28): fixed steps for 1st, 2nd and 3rd with the place on each, not bars sized by accounts,
    // and no account counts under the reps.
    var STEP = { 1: 84, 2: 60, 3: 44 };
    return '<div class="podium">' + order.map(function (x) {
      var place = rows.indexOf(x) + 1, first = place === 1, hgt = STEP[place];
      var avs = x.you ? 'background:#FFFFFF;color:#1170C0;box-shadow:0 0 0 3px #3596EA' : first ? 'background:var(--gold);color:#3A2400;box-shadow:0 0 0 3px rgba(247,201,72,0.35),0 6px 14px rgba(227,162,26,0.4)' : 'background:rgba(255,255,255,0.16);color:#FFFFFF';
      var bar = x.you && !first ? 'background:linear-gradient(180deg,#3596EA,#1170C0);color:#fff' : first ? 'background:linear-gradient(180deg,#F7C948,#C98612);color:#3A2400' : 'background:linear-gradient(180deg,rgba(255,255,255,0.22),rgba(255,255,255,0.08));color:#fff';
      return '<span class="pod"><span style="height:20px;color:#F7C948">' + (first ? '<svg width="20" height="16" viewBox="0 0 24 18" aria-hidden="true"><path d="M2 16l2-12 5 5 3-7 3 7 5-5 2 12z" fill="#F7C948"/></svg>' : '') + '</span>'
        + '<span class="podav num" style="' + avs + '">' + esc(x.initials || '') + '</span><span style="font-size:13px;font-weight:700">' + esc(x.name) + '</span>'
        + '<span class="podbar" style="height:' + hgt + 'px;' + bar + '"><span class="num" aria-label="' + ['', 'First', 'Second', 'Third'][place] + ' place">' + place + '</span></span></span>';
    }).join('') + '</div>';
  }
  function screenRewards() {
    return paint(read('rewards'), function (r) {
      rewardsData = r;
      var t = r.trip, share = Math.round((r.split.newShare || 0) * 100);
      var h = '<div class="scr">' + COIN_DEFS
        + '<div class="head" style="align-items:center;padding-top:2px"><h1 class="h1" style="letter-spacing:-1px">Rewards</h1>'
        + '<span class="streakpill num" aria-label="' + r.streak + ' day streak">' + flame(18, '#F7A21A') + r.streak + '</span></div>'
        + '<section class="gold earned">'
        + '<span class="sunburst" aria-hidden="true"></span><span class="bigcoin" aria-hidden="true">' + coin(56) + '</span>'
        + '<span class="kicker" style="position:relative;color:var(--gold-ink)">Earned this quarter</span>'
        + '<span style="position:relative;display:flex;align-items:baseline;gap:10px;margin-top:6px;flex-wrap:wrap"><span class="num" style="font-size:56px;font-weight:800;letter-spacing:-2px;line-height:1">' + esc(r.earned) + '</span>'
        + (r.hasToday ? '<span class="todaypill num">▲ ' + esc(r.earnedToday) + ' today</span>' : '') + '</span>'
        + '<span class="splitbar"><span style="width:' + share + '%;background:#3A2400"></span><span style="width:' + (100 - share) + '%;background:linear-gradient(90deg,#FFFFFF,#FFF6D6)"></span></span>'
        + '<span style="position:relative;display:flex;justify-content:space-between;margin-top:8px;font-size:12.5px;font-weight:700"><span>' + esc(r.split.onNew) + ' new orders</span><span>' + esc(r.split.onReorders) + ' reorders</span></span></section>'
        + '<div class="head" style="align-items:baseline;padding:0 4px 8px"><h2 class="h2">Cha-ching</h2>' + (r.wins.length ? '<a href="/rewards/wins" data-nav class="link" style="padding-left:12px">See all</a>' : '') + '</div>';
      h += r.wins.length ? '<section class="card r20" style="margin-bottom:14px">' + r.wins.slice(0, 2).map(winRow).join('') + '</section>'
        : empty('trophy', 'No wins yet this quarter.', 'Every paid order earns you ' + r.booster.newText + ' and ' + r.booster.reorderText + '.', 'margin-bottom:14px;border-radius:20px');
      // Big days (Nell's jackpots) are no longer shown on Rewards (owner 2026-10-28: "keep the info, it's important, but
      // don't show it to the rep"). They are still saved and still come back in r.moments.
      h += '<section class="hero race" style="background:var(--hero-deep)">'
        + '<span style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2 class="h2">Race to Vienna ✈︎</h2><span class="glass">' + t.daysLeft + ' days left</span></span>'
        + podium(t) + '</section>';
      return h + '</div>';
    }, 'rewards');
  }
  // ---- F26 Cha-ching: every win this quarter, by week ------------------------------------------------------
  function screenWins() {
    return paint(read('rewards'), function (r) {
      var today = ymd(), dow = new Date(today + 'T12:00:00Z').getUTCDay(), monday = addDays(today, -((dow + 6) % 7)), lastMonday = addDays(monday, -7);
      var month = today.slice(0, 7), MONTH = L.longDate(today).split(', ')[1].split(' ')[0].toUpperCase();
      var groups = [['This week', []], ['Last week', []], ['Earlier in ' + MONTH.charAt(0) + MONTH.slice(1).toLowerCase(), []]], rest = [];
      r.wins.forEach(function (w) {
        if (w.date >= monday) groups[0][1].push(w); else if (w.date >= lastMonday) groups[1][1].push(w); else if (w.date.slice(0, 7) === month) groups[2][1].push(w); else rest.push(w);
      });
      var sum = function (l) { return l.reduce(function (a, w) { return a + w.amount; }, 0); };
      var h = '<div class="scr">' + COIN_DEFS + backLink('/rewards', 'Rewards') + '<h1 class="h1" style="letter-spacing:-1px;padding:0 4px 12px">Cha-ching</h1>'
        + '<section class="gold" style="border-radius:24px;padding:14px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;box-shadow:inset 0 1px 0 rgba(255,255,255,0.6),0 12px 26px rgba(227,162,26,0.3)">'
        + '<span style="display:flex;flex-direction:column"><span class="kicker" style="color:var(--gold-ink)">This quarter</span><span class="num" style="font-size:38px;font-weight:800;letter-spacing:-1.2px;line-height:1.05">' + esc(r.earned) + '</span></span>'
        + '<span style="display:flex;flex-direction:column;align-items:flex-end"><span class="num" style="font-size:28px;font-weight:800;line-height:1">' + r.wins.length + '</span><span class="kicker" style="color:var(--gold-ink)">Wins</span></span></section>';
      if (!r.wins.length) return h + empty('trophy', 'No wins yet this quarter.', 'Paid orders show here with what each one earned you.') + '</div>';
      groups.forEach(function (g) {
        if (!g[1].length) return;
        h += '<div class="sect" style="padding:2px 4px 8px"><span class="kicker">' + esc(g[0]) + '</span><span class="num" style="font-size:13px;font-weight:800;color:#F7C948">+' + money2(sum(g[1])) + '</span></div>'
          + '<section class="card r20" style="margin-bottom:14px">' + g[1].map(winRow).join('') + '</section>';
      });
      if (rest.length) h += '<div class="card r18" style="display:flex;justify-content:space-between;align-items:center;min-height:52px;padding:0 16px;background:var(--field)"><span style="font-size:14px;color:var(--muted)">Earlier this quarter · ' + rest.length + (rest.length === 1 ? ' win' : ' wins') + '</span><span class="num" style="font-size:16px;font-weight:800;color:#F7C948">+' + money2(sum(rest)) + '</span></div>';
      return h + '</div>';
    }, 'rewards');
  }

  // ---- F1 Reminders: turning on phone notifications -----------------------------------------------------------
  // Web push needs the person to say yes once, from a tap. On iPhone it only works once Pulse is on the Home Screen.
  function pushState() {
    var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!('serviceWorker' in navigator) || !CONFIG.vapidPublicKey) return 'unavailable';
    if (ios && !standalone) return 'install';
    if (!('PushManager' in window) || !('Notification' in window)) return 'unavailable';
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission === 'granted' && localStorageGet('mf-push') === 'on') return 'on';
    return 'ask';
  }
  function pushPrompt() {
    var s = pushState();
    if (s === 'on' || s === 'unavailable' || s === 'denied' || localStorageGet('mf-push-hide') === ymd()) return '';
    var text = s === 'install' ? 'Add Pulse to your Home Screen (Share, then Add to Home Screen) to get reminders.' : 'Get your morning list and new leads on your phone.';
    return '<section class="card" style="margin-top:14px;display:flex;align-items:center;gap:12px;padding:12px 14px">'
      + '<span class="round" style="width:34px;height:34px;border-radius:10px">' + ic('bell', 16) + '</span>'
      + '<span style="flex:1 1 auto;font-size:14px;color:var(--muted);line-height:1.3">' + text + '</span>'
      + (s === 'ask' ? '<button type="button" data-push-on class="pillbtn blue">Turn on</button>' : '<button type="button" data-push-hide class="pillbtn">OK</button>')
      + '</section>';
  }
  $app.addEventListener('click', function (e) {
    if (e.target.closest('[data-push-hide]')) { localStorageSet('mf-push-hide', ymd()); screenToday(); return; }
    var b = e.target.closest('[data-push-on]');
    if (!b) return;
    b.disabled = true;
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') throw new Error('denied');
      return navigator.serviceWorker.ready;
    }).then(function (reg) {
      return reg.pushManager.getSubscription().then(function (s) { return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: L.b64ToBytes(CONFIG.vapidPublicKey) }); });
    }).then(function (sub) {
      return act('push_subscribe', { subscription: sub.toJSON() });
    }).then(function () { localStorageSet('mf-push', 'on'); toast('Reminders are on'); screenToday(); }, function () { b.disabled = false; toast('Reminders are off. You can allow them in your phone’s settings.'); });
  });

  // ---- sign-in and start ------------------------------------------------------------------------------------
  // Supabase Auth with Google, @renellence.com only. Signing in also asks for Gmail (send + read) so the Email
  // button and the email feed work; Google hands over a refresh token once, which goes to the server.
  var GMAIL_SCOPES = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';
  function signIn(back) {
    try { sessionStorage.setItem('mf-back', back || '/'); } catch (e) { /* ignore */ }
    sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/', scopes: GMAIL_SCOPES,
      queryParams: { access_type: 'offline', prompt: 'consent', hd: 'renellence.com' } } });
  }
  var signInMessage = '';
  function signOutLocal() { session = null; ME = null; showSignIn(); }
  function showSignIn(message) {
    closeSheet();
    message = message || signInMessage;
    $app.innerHTML = '<div class="scr full" style="justify-content:center;align-items:center;text-align:center;gap:18px">'
      + '<img src="/logo-white.png" alt="Renellence" width="161" height="22" style="height:22px;width:auto">'
      + '<h1 class="h1">Pulse</h1>'
      + (message ? '<span style="font-size:15px;color:var(--muted);max-width:300px;line-height:1.4">' + esc(message) + '</span>' : '')
      + '<button type="button" data-signin class="btn" style="max-width:340px">Sign in with Google</button>'
      + '<span style="font-size:13px;color:var(--muted)">Use your @renellence.com account.</span></div>';
  }
  $app.addEventListener('click', function (e) { if (e.target.closest('[data-signin]')) signIn(location.pathname); });
  // Head office signed in (Yousef 2026-10-23): a polite screen instead of a book. Sign out goes back to sign-in.
  function showRepsOnly() {
    closeSheet();
    $app.innerHTML = '<div class="scr full" style="justify-content:center;align-items:center;text-align:center;gap:18px">'
      + '<img src="/logo-white.png" alt="Renellence" width="161" height="22" style="height:22px;width:auto">'
      + '<h1 class="display" style="font-size:30px;font-weight:800;letter-spacing:-0.7px">Pulse is for reps</h1>'
      + '<span style="font-size:15px;color:var(--muted);max-width:300px;line-height:1.4">' + esc(errText({ message: 'reps_only' })) + '</span>'
      + '<button type="button" data-repsout class="btn soft" style="max-width:340px">Sign out</button></div>';
  }
  // Tapping your initials on Today (owner 2026-10-27): who is signed in, and Sign out.
  function meSheet() {
    $sheet.innerHTML = '<div class="dim" data-close></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Your account"><span class="grab"></span>'
      + '<div style="display:flex;align-items:center;gap:12px;padding:6px 2px 18px"><span class="me num" style="width:48px;height:48px;font-size:17px;margin:0">' + esc((ME && ME.initials) || '') + '</span>'
      + '<span class="grow"><span class="t" style="display:block;font-size:18px;font-weight:700">' + esc((ME && ME.name) || '') + '</span><span class="sub" style="display:block;font-size:14px;color:var(--muted);overflow-wrap:anywhere">' + esc((ME && ME.email) || '') + '</span></span></div>'
      + '<div style="display:flex;flex-direction:column;gap:10px"><button type="button" data-signout class="btn soft" style="color:var(--danger)">Sign out</button>'
      + '<button type="button" data-close class="btn soft">Cancel</button></div></div>';
    sheetHandler = function (e, type) {
      if (type) return;
      var b = e.target.closest('[data-signout]');
      if (!b) return;
      b.disabled = true; b.textContent = 'Signing out…';
      sb.auth.signOut().catch(function () {}).then(function () { closeSheet(); history.replaceState({}, '', '/'); signOutLocal(); });
    };
  }
  $app.addEventListener('click', function (e) { if (e.target.closest('[data-me]')) meSheet(); });
  $app.addEventListener('click', function (e) { if (e.target.closest('[data-repsout]')) { signInMessage = ''; sb.auth.signOut().catch(function () {}).then(function () { showSignIn(); }); } });

  function start() {
    fetch('/api/data?op=config').then(function (r) { return r.json(); }).then(function (cfg) {
      CONFIG = cfg;
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
      sb.auth.onAuthStateChange(function (event, s) {
        session = s;
        if (event === 'SIGNED_OUT') signOutLocal();
      });
      return sb.auth.getSession();
    }).then(function (res) {
      session = res.data.session;
      if (!session) return showSignIn();
      // Right after sign-in Google's refresh token is in the session once: keep it for Gmail.
      var rt = session.provider_refresh_token, sentKey = rt ? 'mf-gmail-' + rt.slice(-12) : '';
      var gmail = rt && localStorageGet('mf-gmail') !== sentKey
        ? act('gmail_connect', { refreshToken: rt }).then(function () { localStorageSet('mf-gmail', sentKey); }, function () {}) : Promise.resolve();
      return gmail.then(function () { return api('boot'); }).then(function (b) {
        BOOT = b; ME = b.me;
        var back = null; try { back = sessionStorage.getItem('mf-back'); sessionStorage.removeItem('mf-back'); } catch (e) { /* ignore */ }
        if (back && back !== location.pathname) history.replaceState({}, '', back);
        else if (location.search || location.hash) history.replaceState({}, '', location.pathname);
        render();
        if (b.joined) joinedMoment(b.joined);
        if (b.firstVisit) act('seen_fifty').catch(function () {});
      });
    }).catch(function (e) {
      if (e && e.message === 'signed_out') return;
      if (e && e.message === 'reps_only') return showRepsOnly();
      if (e && (e.message === 'not_set_up' || e.message === 'not_renellence')) { signInMessage = errText(e); sb.auth.signOut().catch(function () {}); return showSignIn(); }
      $app.innerHTML = failed(e);
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
  start();
})();
