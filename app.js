/* My Fifty: the phone app. Screens follow "Edge – Final Mockup" (L1-L25, without L12 and L16-L18; the
   product picker is the original #12). Plain JS, no build step. Every read is GET /api/data?op=..., every write
   POST /api/act { op }. Sign-in is Supabase Auth with Google (@renellence.com). */
(function () {
  'use strict';

  // ---- basics ------------------------------------------------------------------------------------
  var $app = document.getElementById('app');
  var $sheet = document.getElementById('sheet');
  var sb = null, session = null, ME = null, BOOT = null, CONFIG = null;
  var cache = {};

  // Pure helpers live in lib.js (unit tested in test/unit/lib.test.js).
  var L = window.MFLib;
  var esc = L.esc, nb = L.nb, MONTHS = L.MONTHS, ymd = L.ymd, addDays = L.addDays, shortDate = L.shortDate, errText = L.errText, initials = L.initials, money = L.money;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('on'); }, 2600);
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
  // Read with a short-lived cache so going back is instant; any write clears it.
  function read(op, params) {
    var k = op + JSON.stringify(params || {});
    if (cache[k]) return Promise.resolve(cache[k]);
    return api(op, params).then(function (j) { cache[k] = j; return j; });
  }

  // ---- icons (paths from the mockup) ---------------------------------------------------------------
  var P = {
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    text: '<path d="M4 5h16v11H9l-5 4z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    arrow: '<path d="M5 12h12M13 7l5 5-5 5"/>',
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
  };
  function ic(name, size, width, extra) {
    return '<svg width="' + (size || 16) + '" height="' + (size || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (width || 2.2)
      + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + P[name] + '</svg>';
  }
  var FLAME = '<svg width="14" height="14" viewBox="0 0 24 24" fill="#3D2A00" aria-hidden="true"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-6 1-9.5z"/></svg>';
  var LOGO = '<img src="/logo.png" alt="Renellence" style="height:15px;width:auto;align-self:flex-start;margin:0 4px 12px">';

  // ---- shared pieces ---------------------------------------------------------------------------------
  var MUTED = 'color:#6B7486';
  function tabs(on) {
    function t(href, key, icon, label) {
      return '<a href="' + href + '" data-nav class="' + (on === key ? 'on' : '') + '">' + icon + label + '</a>';
    }
    return '<nav class="tabs">'
      + t('/', 'today', ic('today', 25, 2), 'Today')
      + t('/people', 'people', ic('people', 25, 2), 'People')
      + t('/order', 'order', '<span class="plus">' + ic('plus', 18, 2.6) + '</span>', 'Order')
      + t('/rewards', 'rewards', ic('trophy', 25, 2), 'Rewards')
      + '</nav>';
  }
  function backLink(href, label) {
    return '<a href="' + esc(href) + '" data-nav style="display:flex;align-items:center;gap:4px;font-size:17px;color:#1170C0;padding:0 0 10px;align-self:flex-start">'
      + ic('back', 18, 2.4) + esc(label) + '</a>';
  }
  function bigTitle(text, right) {
    return '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:0 4px 14px">'
      + '<span style="font-size:34px;font-weight:700;letter-spacing:-0.8px">' + esc(text) + '</span>' + (right || '') + '</div>';
  }
  function sectionLabel(left, right) {
    return '<span style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;color:#6B7486;letter-spacing:0.3px;padding:0 4px 8px">'
      + '<span>' + esc(left) + '</span><span style="letter-spacing:0;font-weight:500">' + esc(right || '') + '</span></span>';
  }
  function smallLabel(left, right) {
    return '<span style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 4px">'
      + '<span style="font-size:13px;font-weight:700;color:#6B7486;letter-spacing:0.4px">' + esc(left) + '</span>' + (right || '') + '</span>';
  }
  var CHEV = '<span style="color:#C4C7CE;display:flex">' + ic('chev', 15, 2.4) + '</span>';
  function loading() { return '<div class="scr" style="align-items:center;justify-content:center"><span class="spin"></span></div>'; }
  function failed(e) {
    return '<div class="scr" style="align-items:center;justify-content:center;gap:12px;text-align:center"><span style="font-size:17px;font-weight:600">'
      + esc(errText(e)) + '</span><button type="button" data-reload style="height:44px;padding:0 18px;border-radius:14px;border:0;background:#1170C0;color:#fff;font-size:16px;font-weight:600">Try again</button></div>';
  }
  // The two kinds of dot used for My Fifty people (L6): solid = warm, half = going cold, dashed = open.
  var DOT = {
    warm: '<span style="width:14px;height:14px;border-radius:50%;background:#062064;flex:none"></span>',
    cold: '<span style="width:14px;height:14px;border-radius:50%;background:linear-gradient(90deg,#8A97AE 50%,#FFFFFF 50%);border:2px solid #8A97AE;box-sizing:border-box;flex:none"></span>',
    open: '<span style="width:14px;height:14px;border-radius:50%;border:1.5px dashed #062064;box-sizing:border-box;flex:none"></span>',
  };

  // ---- router ------------------------------------------------------------------------------------------
  var ROUTES = [
    [/^\/$/, function () { return screenToday(); }],
    [/^\/people$/, function () { return screenPeople(); }],
    [/^\/people\/leads\/(social|event|warm|cold)$/, function (m) { return screenLeads(m[1]); }],
    [/^\/person\/([0-9a-f-]{36})$/, function (m) { return screenPerson(m[1]); }],
    [/^\/person\/([0-9a-f-]{36})\/history$/, function (m) { return screenHistory(m[1]); }],
    [/^\/person\/([0-9a-f-]{36})\/onboarding$/, function (m) { return screenOnboarding(m[1]); }],
    [/^\/order$/, function () { return screenWho(); }],
    [/^\/order\/([0-9a-f-]{36})$/, function (m) { return screenProducts(m[1]); }],
    [/^\/order\/([0-9a-f-]{36})\/review$/, function (m) { return screenReview(m[1]); }],
    [/^\/orders\/([0-9a-f-]{36})$/, function (m) { return screenOrderStatus(m[1]); }],
    [/^\/rewards$/, function () { return screenRewards(); }],
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
  // Paints a screen: shows a spinner only if loading is slow, then the HTML.
  // Only the newest screen asked for may paint: a slow answer for a screen the rep already left is dropped.
  var paintSeq = 0;
  function paint(promise, view, tab) {
    var shown = false, mine = ++paintSeq;
    var t = setTimeout(function () { if (mine !== paintSeq) return; shown = true; $app.innerHTML = loading() + (tab ? tabs(tab) : ''); }, 120);
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
      void shown;
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

  // ---- L2 Today ------------------------------------------------------------------------------------------
  var todayFirst = null;   // "Tap one to do it first" moves a row up to Suggested next
  function screenToday() {
    return paint(read('today'), function (d) {
      var now = new Date();
      var date = d.date;
      var day = d.day, goal = day.goal, done = day.done;
      var list = d.list.slice();
      if (todayFirst) {
        var at = list.findIndex(function (x) { return x.id === todayFirst; });
        if (at > 0) list.unshift(list.splice(at, 1)[0]);
      }
      var next = list[0], then = list.slice(1);
      var fifty = d.fifty, tile = L.fiftyTile(fifty.count, fifty.next), toNext = tile.toNext, filled = tile.filled;
      var dots = '';
      for (var i = 0; i < 10; i++) {
        dots += i < filled ? '<span style="width:10px;height:10px;border-radius:50%;box-sizing:border-box;background:#FFFFFF"></span>'
          : '<span style="width:10px;height:10px;border-radius:50%;box-sizing:border-box;border:1.5px dashed rgba(255,255,255,0.65)"></span>';
      }
      void now;
      var h = '<div class="scr">' + LOGO
        + '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:0 4px 10px">'
        + '<span style="display:flex;flex-direction:column"><span style="font-size:13px;font-weight:600;color:#6B7486;letter-spacing:0.3px">' + L.longDate(date) + '</span>'
        + '<span style="font-size:34px;font-weight:700;letter-spacing:-0.8px">Today</span></span>'
        + '<span style="width:36px;height:36px;border-radius:50%;background:#EEF2F8;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;margin-bottom:4px">' + esc(ME.initials) + '</span></div>'
        // tiles
        + '<div style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:80px 80px;gap:10px;margin-bottom:14px">'
        + '<div style="grid-row:1 / span 2;background:#FFFFFF;border-radius:22px;padding:14px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 1px 2px rgba(0,0,0,0.04)">'
        + '<span style="font-size:13px;font-weight:600;color:#6B7486">TODAY</span>'
        + '<svg width="92" height="92" viewBox="0 0 92 92" role="img" aria-label="done today"><defs><linearGradient id="gt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4FA3EE"/><stop offset="1" stop-color="#1170C0"/></linearGradient></defs>'
        + '<circle cx="46" cy="46" r="38" fill="none" stroke="#EEF2F8" stroke-width="11"/>'
        + (done ? '<circle cx="46" cy="46" r="38" fill="none" stroke="url(#gt)" stroke-width="11" stroke-linecap="round" stroke-dasharray="' + L.ringDash(38, done, goal) + '" transform="rotate(-90 46 46)"/>' : '')
        + '<text x="46" y="49" text-anchor="middle" font-family="-apple-system, Inter, sans-serif" font-size="22" font-weight="700" fill="#062064">' + done + '/' + goal + '</text>'
        + '<text x="46" y="64" text-anchor="middle" font-family="-apple-system, Inter, sans-serif" font-size="11" font-weight="500" fill="#6B7486">done</text></svg>'
        + '<span style="font-size:15px;font-weight:600;line-height:1.2">' + L.dayLeftText(done, goal) + '</span></div>'
        + '<div style="background:linear-gradient(135deg,#FFD86B,#F5B21F);border-radius:22px;padding:12px 14px;display:flex;flex-direction:column;justify-content:space-between;color:#3D2A00">'
        + '<span style="display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600">STREAK ' + FLAME + '</span>'
        + '<span style="display:flex;align-items:baseline;gap:4px"><span style="font-size:30px;font-weight:700;letter-spacing:-0.8px">' + day.streak + '</span>'
        + '<span style="font-size:13px;font-weight:600">' + (day.streak === 1 ? 'day' : 'days') + ' · plan done</span></span></div>'
        + '<a href="/people" data-nav style="background:linear-gradient(135deg,#1A80D6,#1170C0);border-radius:22px;padding:12px 14px;display:flex;flex-direction:column;justify-content:space-between;color:#FFFFFF">'
        + '<span style="display:flex;justify-content:space-between;font-size:13px;font-weight:600"><span>MY FIFTY</span><span>' + fifty.count + '</span></span>'
        + '<span style="display:flex;justify-content:space-between">' + dots + '</span>'
        + '<span style="font-size:13px;font-weight:600">' + toNext + ' more to reach ' + fifty.next + '</span></a></div>';
      if (next) {
        h += sectionLabel('SUGGESTED NEXT', '')
          + '<section style="background:#FFFFFF;border-radius:22px;padding:14px;box-shadow:0 1px 2px rgba(0,0,0,0.04);margin-bottom:14px">'
          + '<a href="/person/' + next.id + '" data-nav style="display:flex;align-items:center;gap:12px">'
          + '<span style="width:44px;height:44px;border-radius:12px;background:#EEF2F8;display:flex;align-items:center;justify-content:center;flex:none;color:#062064">' + ic(next.action === 'visit' ? 'pin' : 'phone', 16) + '</span>'
          + '<span style="display:flex;flex-direction:column;gap:2px"><span style="font-size:20px;font-weight:600;letter-spacing:-0.3px">' + esc(next.name) + '</span>'
          + '<span style="font-size:14px;color:#6B7486">' + [next.clinic ? nb(next.clinic) : '', esc(next.detail)].filter(Boolean).join(' · ') + '</span></span></a>'
          + '<div style="display:grid;grid-template-columns:1fr 1fr 1.1fr;gap:8px;margin-top:12px">'
          + '<button type="button" data-log="' + next.id + '" data-kind="' + (next.action === 'visit' ? 'visit' : 'call') + '" style="height:48px;border-radius:14px;border:0;background:#1170C0;color:#FFFFFF;display:flex;align-items:center;justify-content:center;gap:6px;font-size:17px;font-weight:600">' + ic('check', 18, 2.6) + 'Log</button>'
          + '<button type="button" data-call="' + next.id + '" style="height:48px;width:100%;border-radius:14px;border:0;background:#EEF2F8;color:#062064;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:5px">' + ic('phone', 16) + 'Call</button>'
          + '<button type="button" data-snooze="' + next.id + '"' + (next.taskId ? ' data-task="' + next.taskId + '"' : '') + ' style="height:48px;border-radius:14px;border:0;background:#EEF2F8;color:#062064;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:5px">' + ic('arrow', 16) + 'Tomorrow</button>'
          + '</div></section>';
      } else {
        h += sectionLabel('SUGGESTED NEXT', '')
          + '<section style="background:#FFFFFF;border-radius:22px;padding:18px 14px;box-shadow:0 1px 2px rgba(0,0,0,0.04);margin-bottom:14px;font-size:16px;font-weight:600">Nothing on your list right now.'
          + '<span style="display:block;font-size:14px;font-weight:400;color:#6B7486;margin-top:4px">New leads, follow-ups and people going cold show up here.</span></section>';
      }
      if (then.length) {
        h += sectionLabel('THEN', 'Tap one to do it first') + '<section style="background:#FFFFFF;border-radius:16px">';
        then.forEach(function (x, i) {
          h += '<button type="button" data-first="' + x.id + '" style="width:100%;border:0;' + (i ? 'border-top:0.5px solid #E3E6EC;' : '') + 'background:transparent;color:#062064;display:flex;align-items:center;gap:12px;height:54px;padding:0 14px;text-align:left">'
            + '<span style="width:32px;height:32px;border-radius:9px;background:#EEF2F8;display:flex;align-items:center;justify-content:center;flex:none">' + ic(x.action === 'visit' ? 'pin' : 'phone', 16) + '</span>'
            + '<span style="flex:1 1 auto;display:flex;flex-direction:column;min-width:0"><span style="font-size:16px;font-weight:600">' + esc(x.name) + '</span>'
            + '<span style="font-size:13px;color:#6B7486;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + nb(x.clinic) + '</span></span>'
            + '<span style="font-size:15px;color:#6B7486">' + (x.action === 'visit' ? 'Visit' : 'Call') + '</span></button>';
        });
        h += '</section>';
      }
      h += pushPrompt() + '</div>';
      return h;
    }, 'today');
  }

  $app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-first]');
    if (b) { todayFirst = b.getAttribute('data-first'); screenToday(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    b = e.target.closest('[data-snooze]');
    if (b) {
      b.disabled = true;
      act('snooze', { contactId: b.getAttribute('data-snooze'), taskId: b.getAttribute('data-task') || undefined })
        .then(function () { todayFirst = null; toast('Moved to tomorrow'); screenToday(); }, function (err) { b.disabled = false; toast(errText(err)); });
      return;
    }
    b = e.target.closest('[data-log]');
    if (b) { openLog(b.getAttribute('data-log'), b.getAttribute('data-kind') || 'call'); return; }
    b = e.target.closest('[data-call]');
    if (b) { callOrText(b.getAttribute('data-call'), 'call'); return; }
  });

  // ---- L6 People ---------------------------------------------------------------------------------------
  var peopleView = 'fifty', peopleFilter = 'cold';
  var SEG_ON = 'background:#FFFFFF;color:#062064;box-shadow:0 1px 3px rgba(0,0,0,0.12)', SEG_OFF = 'color:#6B7486';
  function screenPeople() {
    return paint(read('people'), function (d) {
      var h = '<div class="scr">'
        + '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:0 4px 14px">'
        + '<span style="font-size:34px;font-weight:700;letter-spacing:-0.8px">People</span>'
        + '<button type="button" data-add-person style="height:34px;padding:0 14px;border-radius:17px;border:0;background:#1170C0;color:#FFFFFF;font-size:15px;font-weight:600;display:flex;align-items:center;gap:4px;margin-bottom:6px">' + ic('plus', 15, 2.6) + 'Add person</button></div>'
        + searchBox('people-search', 'Find a person', 42, 12)
        + '<div data-search-results></div><div data-people-body>'
        + '<div style="display:grid;grid-auto-flow:column;grid-auto-columns:1fr;background:#E4E8EF;border-radius:12px;padding:3px;gap:3px;margin-bottom:14px">'
        + [['fifty', 'My Fifty'], ['cand', 'Candidates'], ['leads', 'Leads']].map(function (t) {
          return '<button type="button" data-pview="' + t[0] + '" style="height:36px;border-radius:9px;border:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;' + (peopleView === t[0] ? SEG_ON : SEG_OFF + ';background:transparent') + '">' + t[1] + '</button>';
        }).join('') + '</div>';
      if (peopleView === 'fifty') h += fiftyView(d.fifty);
      else if (peopleView === 'cand') h += candidatesView(d.fifty.count, d.candidates);
      else h += leadsView(d.leads);
      return h + '</div></div>';
    }, 'people');
  }
  function searchBox(name, placeholder, height, mb) {
    return '<label style="height:' + height + 'px;border-radius:12px;background:#FFFFFF;display:flex;align-items:center;gap:8px;padding:0 12px;color:#6B7486;font-size:16px;margin-bottom:' + mb + 'px;flex:none">'
      + ic('search', 17) + '<input class="bare" type="search" data-search="' + name + '" placeholder="' + esc(placeholder) + '" autocomplete="off" style="flex:1;min-width:0;font-size:16px;height:100%"></label>';
  }
  function fiftyView(f) {
    var dots = '';
    for (var i = 0; i < Math.max(f.goal, f.count); i++) {
      dots += i < f.warmCount ? '<span style="display:block;aspect-ratio:1 / 1;border-radius:50%;box-sizing:border-box;background:#FFFFFF"></span>'
        : i < f.count ? '<span style="display:block;aspect-ratio:1 / 1;border-radius:50%;box-sizing:border-box;background:linear-gradient(90deg,rgba(255,255,255,0.6) 50%,transparent 50%);border:2px solid rgba(255,255,255,0.6)"></span>'
          : '<span style="display:block;aspect-ratio:1 / 1;border-radius:50%;box-sizing:border-box;border:1.5px dashed rgba(255,255,255,0.4)"></span>';
    }
    var h = '<div style="display:flex;flex-direction:column">'
      + '<section style="background:linear-gradient(135deg,#1A80D6,#1170C0);color:#FFFFFF;border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:12px;margin-bottom:12px">'
      + '<span style="display:flex;justify-content:space-between;font-size:15px;font-weight:600"><span>' + f.count + ' in My Fifty</span><span style="opacity:0.85">' + f.open + ' open spots</span></span>'
      + '<div style="display:grid;grid-template-columns:repeat(10,1fr);gap:6px">' + dots + '</div></section>'
      + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">'
      + [['warm', f.warmCount, 'Warm'], ['cold', f.coldCount, 'Going cold'], ['open', f.open, 'Open']].map(function (x) {
        return '<button type="button" data-pfilter="' + x[0] + '" style="height:62px;border-radius:14px;border:0;padding:0 12px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;color:#062064;background:#FFFFFF' + (peopleFilter === x[0] ? ';box-shadow:inset 0 0 0 2px #1170C0' : '') + '">'
          + '<span style="display:flex;align-items:center;gap:6px;font-size:20px;font-weight:700">' + DOT[x[0]] + x[1] + '</span>'
          + '<span style="font-size:12px;font-weight:600;color:#6B7486">' + x[2] + '</span></button>';
      }).join('') + '</div>';
    var rows = peopleFilter === 'warm' ? f.warm : peopleFilter === 'cold' ? f.cold : null;
    if (rows) {
      h += rows.length ? '<section style="background:#FFFFFF;border-radius:16px">' + rows.map(function (r, i) {
        return '<a href="/person/' + r.id + '" data-nav style="display:flex;align-items:center;gap:12px;min-height:56px;padding:0 14px' + (i ? ';border-top:0.5px solid #E3E6EC' : '') + '">'
          + DOT[peopleFilter] + '<span style="flex:1 1 auto;display:flex;flex-direction:column;min-width:0"><span style="font-size:16px;font-weight:600">' + esc(r.name) + '</span>'
          + '<span style="font-size:13px;color:#6B7486">' + nb(r.sub) + '</span></span>' + CHEV + '</a>';
      }).join('') + '</section>'
        : '<section style="background:#FFFFFF;border-radius:16px;padding:16px 14px;font-size:15px;color:#6B7486">' + (peopleFilter === 'cold' ? 'Nobody is going cold.' : 'Nobody here yet.') + '</section>';
    } else {
      h += '<section style="background:#FFFFFF;border-radius:16px"><button type="button" data-pview="cand" style="width:100%;border:0;background:transparent;color:#062064;text-align:left;display:flex;align-items:center;gap:12px;min-height:56px;padding:0 14px">'
        + DOT.open + '<span style="flex:1 1 auto;display:flex;flex-direction:column"><span style="font-size:16px;font-weight:600">' + f.open + ' open spots</span>'
        + '<span style="font-size:13px;color:#6B7486">Turn candidates into My Fifty</span></span>' + CHEV + '</button></section>';
    }
    return h + '</div>';
  }
  function candidatesView(now, cands) {
    var faces = cands.slice(0, 4).map(function (c) {
      return '<span style="width:34px;height:34px;border-radius:50%;border:2px dashed rgba(255,255,255,0.85);box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;margin-left:5px;background:rgba(255,255,255,0.12)">' + esc(c.initials) + '</span>';
    }).join('');
    var h = '<div style="display:flex;flex-direction:column;gap:12px">'
      + '<div style="background:linear-gradient(135deg,#1A80D6,#1170C0);color:#FFFFFF;border-radius:20px;padding:18px;display:flex;align-items:center;justify-content:space-between">'
      + '<span style="display:flex;flex-direction:column;align-items:center;gap:2px"><span style="font-size:34px;font-weight:700;letter-spacing:-1px;line-height:1">' + now + '</span><span style="font-size:12px;opacity:0.85">now</span></span>'
      + '<span style="display:flex">' + faces + '</span><span style="font-size:22px;opacity:0.85">→</span>'
      + '<span style="display:flex;flex-direction:column;align-items:center;gap:4px"><span style="width:58px;height:58px;border-radius:50%;background:#FFFFFF;color:#1170C0;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;letter-spacing:-0.5px">' + (now + cands.length) + '</span>'
      + '<span style="font-size:12px;opacity:0.85">one order each</span></span></div>';
    if (!cands.length) return h + '<section style="background:#FFFFFF;border-radius:16px;padding:16px 14px;font-size:15px;color:#6B7486">No candidates yet. Samples make a lead a candidate.</section></div>';
    var R = 2 * Math.PI * 20;
    h += '<section style="background:#FFFFFF;border-radius:16px">' + cands.map(function (c, i) {
      // Yousef 2026-10-20: no "Ask now"; every candidate shows how long since their samples arrived.
      var pill = L.candidatePill(c.days);
      return '<a href="/person/' + c.id + '" data-nav style="display:flex;align-items:center;gap:12px;min-height:64px;padding:8px 14px;box-sizing:border-box' + (i ? ';border-top:0.5px solid #E3E6EC' : '') + '">'
        + '<span style="position:relative;width:44px;height:44px;flex:none"><svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" style="position:absolute;inset:0">'
        + '<circle cx="22" cy="22" r="20" fill="none" stroke="#E2E6ED" stroke-width="3.5"/>'
        + (c.ring ? '<circle cx="22" cy="22" r="20" fill="none" stroke="#1170C0" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="' + (R * c.ring).toFixed(1) + ' ' + R.toFixed(1) + '" transform="rotate(-90 22 22)"/>' : '')
        + '</svg><span style="position:absolute;inset:6px;border-radius:50%;background:#EEF2F8;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700">' + esc(c.initials) + '</span></span>'
        + '<span style="flex:1 1 auto;display:flex;flex-direction:column;min-width:0"><span style="font-size:16px;font-weight:600">' + esc(c.name) + '</span><span style="font-size:13px;color:#6B7486">' + nb(c.clinic) + '</span></span>'
        + '<span style="height:26px;padding:0 10px;border-radius:13px;font-size:13px;font-weight:700;display:flex;align-items:center;background:#EEF2F8;color:#6B7486;white-space:nowrap">' + pill + '</span></a>';
    }).join('') + '</section>';
    return h + '</div>';
  }
  function leadsView(groups) {
    return '<div style="display:flex;flex-direction:column">' + sectionLabel('START AT THE TOP · SAMPLES MAKE THEM A CANDIDATE', '')
      + '<section style="background:#FFFFFF;border-radius:16px">' + groups.map(function (g, i) {
        var dim = g.key === 'cold';
        return '<a href="/people/leads/' + g.key + '" data-nav style="display:flex;align-items:center;gap:12px;min-height:56px;padding:0 14px' + (i ? ';border-top:0.5px solid #E3E6EC' : '') + '">'
          + '<span style="width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex:none;' + (dim ? 'border:1.5px solid #C4C7CE;color:#6B7486;box-sizing:border-box' : 'background:#1170C0;color:#FFFFFF') + '">' + (i + 1) + '</span>'
          + '<span style="flex:1 1 auto;font-size:16px;font-weight:600">' + esc(g.label) + '</span>'
          + (g.fresh ? '<span style="height:24px;padding:0 9px;border-radius:12px;background:#1170C0;color:#FFFFFF;font-size:12px;font-weight:700;display:flex;align-items:center">' + g.fresh + ' new</span>' : '')
          + '<span style="font-size:17px;font-weight:700;min-width:26px;text-align:right">' + g.count + '</span>' + CHEV + '</a>';
      }).join('') + '</section></div>';
  }
  $app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pview]');
    if (b) { peopleView = b.getAttribute('data-pview'); screenPeople(); return; }
    b = e.target.closest('[data-pfilter]');
    if (b) { peopleFilter = b.getAttribute('data-pfilter'); screenPeople(); return; }
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
      out.innerHTML = d.people.length ? '<section style="background:#FFFFFF;border-radius:16px;margin-bottom:12px">' + d.people.map(function (p, i) {
        return '<a href="/person/' + p.id + '" data-nav style="display:flex;align-items:center;gap:12px;min-height:60px;padding:0 14px' + (i ? ';border-top:0.5px solid #E3E6EC' : '') + '">'
          + '<span style="width:36px;height:36px;border-radius:50%;background:#EEF2F8;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex:none">' + esc(p.initials) + '</span>'
          + '<span style="flex:1 1 auto;display:flex;flex-direction:column;min-width:0"><span style="font-size:16px;font-weight:600">' + esc(p.name) + '</span>'
          + '<span style="font-size:13px;color:#6B7486">' + [p.clinic ? nb(p.clinic) : '', STAGE[p.stage]].filter(Boolean).join(' · ') + '</span></span>' + CHEV + '</a>';
      }).join('') + '</section>' : '<section style="background:#FFFFFF;border-radius:16px;padding:16px 14px;font-size:15px;color:#6B7486;margin-bottom:12px">Nobody in your book matches.</section>';
    }).catch(function (err) { toast(errText(err)); });
  }

  // ---- L22-L25 Lead lists ----------------------------------------------------------------------------
  function screenLeads(group) {
    return paint(read('leads', { group: group }), function (d) {
      var h = '<div class="scr">' + backLink('/people', 'People')
        + '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:0 4px 4px"><span style="font-size:34px;font-weight:700;letter-spacing:-0.8px">' + esc(d.title) + '</span></div>'
        + '<span style="flex:none;font-size:14px;color:#6B7486;padding:0 4px 8px">' + d.leads.length + (d.leads.length === 1 ? ' lead' : ' leads') + ' · newest first</span>';
      if (!d.leads.length) return h + '<section style="background:#FFFFFF;border-radius:16px;padding:16px 14px;font-size:15px;color:#6B7486">No leads here right now.</section></div>';
      h += '<section style="background:#FFFFFF;border-radius:16px">' + d.leads.map(function (l, i) {
        return '<a href="/person/' + l.id + '" data-nav style="display:flex;align-items:center;gap:12px;min-height:64px;padding:8px 14px;box-sizing:border-box' + (i ? ';border-top:0.5px solid #E3E6EC' : '') + '">'
          + '<span style="width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex:none;' + (l.isNew ? 'background:#1170C0;color:#FFFFFF' : 'background:#EEF2F8;color:#062064') + '">' + esc(l.initials) + '</span>'
          + '<span style="flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px"><span style="font-size:16px;font-weight:600">' + esc(l.name) + '</span>'
          + '<span style="font-size:13px;color:#6B7486;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + nb(l.sub) + '</span></span>'
          + '<span style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:none"><span style="font-size:12px;color:#6B7486">' + esc(l.age) + '</span>'
          + (l.isNew ? '<span style="height:22px;padding:0 8px;border-radius:11px;font-size:12px;font-weight:700;display:flex;align-items:center;background:#1170C0;color:#FFFFFF">New</span>'
            : l.last ? '<span style="height:22px;padding:0 8px;border-radius:11px;font-size:12px;font-weight:700;display:flex;align-items:center;background:#EEF2F8;color:#062064">' + esc(l.last) + '</span>' : '')
          + '</span></a>';
      }).join('') + '</section>';
      return h + '</div>';
    }, 'people');
  }

  // ---- L7 / L8 Person card -----------------------------------------------------------------------------
  var FILLERS = [['saypha', 'saypha'], ['juvederm', 'Juvéderm'], ['restylane', 'Restylane'], ['teoxane_rha', 'Teoxane (RHA)'], ['belotero', 'Belotero'], ['revanesse', 'Revanesse'], ['stylage', 'Stylage'], ['other', 'Other']];
  var PRPS = [['eclipse_prp', 'Eclipse PRP'], ['regenlab', 'RegenLab'], ['arthrex_angel', 'Arthrex Angel'], ['emcyte', 'EmCyte'], ['exprecell', 'Exprecell'], ['other', 'Other']];
  function names(list, keys) { var m = {}; list.forEach(function (x) { m[x[0]] = x[1]; }); return keys.map(function (k) { return m[k] || k; }).join(' · '); }
  var STATUS_ICON = { order: 'box', samples: 'gift', onboarding: 'pen' };
  var current = null;   // the person on screen (for the Log sheet header etc.)
  function screenPerson(id) {
    return paint(read('person', { id: id }), function (p) {
      current = p;
      var dot = p.stage === 'fifty' ? (p.goingCold ? '<span style="width:13px;height:13px;border-radius:50%;background:linear-gradient(90deg,#8A97AE 50%,#FFFFFF 50%);border:2px solid #8A97AE;box-sizing:border-box;flex:none"></span>'
        : '<span style="width:13px;height:13px;border-radius:50%;background:#062064;flex:none"></span>')
        : p.stage === 'candidate' ? '<span style="width:13px;height:13px;border-radius:50%;border:3px solid #1170C0;box-sizing:border-box"></span>'
          : '<span style="width:13px;height:13px;border-radius:50%;border:1.5px dashed #062064;box-sizing:border-box"></span>';
      var h = '<div class="scr">' + backLink('/people', 'People')
        + '<section style="background:#FFFFFF;border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:6px;margin-bottom:10px">'
        + '<span style="display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:#6B7486">' + dot + esc(p.label) + '</span>'
        + '<span style="font-size:28px;font-weight:700;letter-spacing:-0.6px">' + esc(p.name) + '</span>'
        + (p.clinic ? '<span style="font-size:15px;color:#6B7486">' + nb(p.clinic) + '</span>' : '') + '</section>';
      if (p.totalBought) {
        h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'
          + '<div style="background:linear-gradient(135deg,#1A80D6,#1170C0);border-radius:20px;padding:14px;color:#FFFFFF"><span style="display:block;font-size:26px;font-weight:700;letter-spacing:-0.6px">' + esc(p.totalBought) + '</span><span style="font-size:13px;font-weight:600;opacity:0.85">Total bought</span></div>'
          + '<div style="background:#FFFFFF;border-radius:20px;padding:14px"><span style="display:block;font-size:26px;font-weight:700;letter-spacing:-0.6px">' + esc(p.lastOrder ? p.lastOrder.total : '$0') + '</span><span style="font-size:13px;font-weight:600;color:#6B7486">Last order' + (p.lastOrder ? ' · ' + esc(p.lastOrder.date) : '') + '</span></div></div>';
      }
      if (p.status) {
        var href = p.status.kind === 'onboarding' ? '/person/' + p.id + '/onboarding' : '/orders/' + p.status.id;
        h += '<a href="' + href + '" data-nav style="background:#FFFFFF;border-radius:18px;min-height:64px;padding:0 14px;margin-bottom:10px;display:flex;align-items:center;gap:12px">'
          + '<span style="width:40px;height:40px;border-radius:12px;background:#1170C0;color:#FFFFFF;display:flex;align-items:center;justify-content:center;flex:none">' + ic(STATUS_ICON[p.status.kind], 20, 2) + '</span>'
          + '<span style="flex:1 1 auto;display:flex;flex-direction:column"><span style="font-size:16px;font-weight:700">' + esc(p.status.label) + '</span><span style="font-size:13px;color:#6B7486">' + esc(p.status.sub) + '</span></span>'
          + '<span style="color:#9AA1AD;display:flex">' + ic('chev', 16, 2.4) + '</span></a>';
      }
      function btn(attr, icon, label) {
        return '<button type="button" ' + attr + ' style="height:68px;border-radius:16px;border:0;background:#FFFFFF;color:#062064;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;font-size:14px;font-weight:600">' + ic(icon, 21) + label + '</button>';
      }
      h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">'
        + btn('data-quo="call"', 'phone', 'Call') + btn('data-log="' + p.id + '" data-kind="visit"', 'pin', 'Visit')
        + btn('data-quo="text"', 'text', 'Text') + btn('data-email', 'mail', 'Email') + '</div>';
      function row(attr, label, value, first) {
        return '<button type="button" ' + attr + ' style="width:100%;border:0;background:transparent;color:#062064;text-align:left;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px;padding:0 14px' + (first ? '' : ';border-top:0.5px solid #E3E6EC') + '">'
          + '<span style="font-size:15px;color:#6B7486">' + label + '</span><span style="font-size:15px;font-weight:600;text-align:right">' + esc(value) + '</span></button>';
      }
      h += '<section style="background:#FFFFFF;border-radius:16px">'
        + row('data-followup', 'Next follow-up', p.followUp ? p.followUp.label : 'None', true)
        + row('data-uses="fillers"', 'Filler they use', p.fillers.length ? names(FILLERS, p.fillers) : 'None yet')
        + row('data-uses="prp"', 'PRP/PRF they use', p.prp.length ? names(PRPS, p.prp) : 'None yet')
        + '</section><input type="date" data-followup-input min="' + ymd() + '" value="' + (p.followUp ? p.followUp.date : '') + '" style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px">'
        + '<a href="/person/' + p.id + '/history" data-nav style="margin-top:10px;background:#FFFFFF;border-radius:16px;min-height:60px;padding:0 14px;display:flex;align-items:center;gap:12px">'
        + '<span style="width:36px;height:36px;border-radius:10px;background:#EAF3FC;color:#1170C0;display:flex;align-items:center;justify-content:center;flex:none">' + ic('clock', 18) + '</span>'
        + '<span style="flex:1 1 auto;display:flex;flex-direction:column"><span style="font-size:15px;font-weight:600">History</span><span style="font-size:13px;color:#6B7486">' + esc(p.last) + '</span></span>' + CHEV + '</a>';
      return h + '</div>';
    }, 'people');
  }
  $app.addEventListener('click', function (e) {
    if (!current) return;
    var b = e.target.closest('[data-quo]');
    if (b) { callOrText(current.id, b.getAttribute('data-quo')); return; }
    if (e.target.closest('[data-email]')) { openEmail(current); return; }
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

  // Call and Text open the Quo app (Yousef 2026-10-20: "Quo app + Gmail"), then the Log sheet is ready for when
  // they come back. Quo's links: openphone://dial?number=…&action=call and openphone://message?number=….
  function callOrText(contactId, what) {
    read('person', { id: contactId }).then(function (p) {
      current = current && current.id === p.id ? current : p;
      if (!p.phone) { toast('No phone number for ' + p.first + ' yet.'); return; }
      var n = encodeURIComponent(p.phone);
      location.href = what === 'text' ? 'openphone://message?number=' + n : 'openphone://dial?number=' + n + '&action=call';
      setTimeout(function () { openLog(p.id, what === 'text' ? 'text' : 'call'); }, 700);
    }, function (err) { toast(errText(err)); });
  }

  // Filler / PRP they use: pick from the fixed lists.
  function openUses(p, which) {
    var list = which === 'fillers' ? FILLERS : PRPS;
    var picked = (which === 'fillers' ? p.fillers : p.prp).slice();
    function draw() {
      $sheet.innerHTML = '<div class="dim" data-close></div><div class="sheet">' + '<span class="grab"></span>'
        + '<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:26px;font-weight:700;letter-spacing:-0.5px">' + (which === 'fillers' ? 'Filler they use' : 'PRP/PRF they use') + '</span>'
        + '<button type="button" data-close style="height:34px;padding:0 14px;border-radius:17px;border:0;background:#EEF2F8;color:#062064;font-size:15px;font-weight:600">Cancel</button></div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:8px">' + list.map(function (x) {
          var on = picked.indexOf(x[0]) >= 0;
          return '<button type="button" data-pick="' + x[0] + '" style="height:40px;padding:0 14px;border-radius:20px;border:0;font-size:15px;font-weight:600;' + (on ? 'background:#1170C0;color:#FFFFFF' : 'background:#EEF2F8;color:#062064') + '">' + esc(x[1]) + '</button>';
        }).join('') + '</div>'
        + '<button type="button" data-save style="height:54px;border-radius:14px;border:0;background:#1170C0;color:#FFFFFF;font-size:17px;font-weight:600">Save</button></div>';
    }
    draw();
    sheetHandler = function (e) {
      var b = e.target.closest('[data-pick]');
      if (b) { var k = b.getAttribute('data-pick'), i = picked.indexOf(k); if (i >= 0) picked.splice(i, 1); else picked.push(k); draw(); return; }
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
  $sheet.addEventListener('input', function (e) { if (sheetHandler) sheetHandler(e, 'input'); });
  $sheet.addEventListener('change', function (e) { if (sheetHandler) sheetHandler(e, 'change'); });

  // ---- L3 Log it -----------------------------------------------------------------------------------------
  function openLog(contactId, kind) {
    read('person', { id: contactId }).then(function (p) { logSheet(p, kind); }, function (err) { toast(errText(err)); });
  }
  function logSheet(p, kind) {
    var st = { kind: kind || 'call', reached: true, follow: 'tomorrow', date: '', note: '', typing: false, rec: null, busy: false, aiOutputId: null };
    var tomorrow = addDays(ymd(), 1);
    var KIND_BTN = 'height:62px;border-radius:14px;border:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:13px;font-weight:600;';
    var ON = 'background:#1170C0;color:#FFFFFF', OFF = 'background:#EEF2F8;color:#062064';
    function draw() {
      var canSave = st.note.trim().length > 1 && !st.busy && st.rec === null;
      var noteBox;
      if (st.typing || st.note) {
        noteBox = '<div style="background:#EEF2F8;border-radius:16px;padding:12px;box-shadow:inset 0 0 0 1.5px #C4C7CE">'
          + '<textarea class="note" data-note placeholder="What happened? Then a line starting Next: for the next step">' + esc(st.note) + '</textarea>'
          + (BOOT.voice ? '<div style="display:flex;justify-content:flex-end"><button type="button" data-mic style="height:34px;padding:0 12px;border-radius:17px;border:0;background:#FFFFFF;color:#062064;font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px">' + ic('mic', 15) + 'Talk instead</button></div>' : '')
          + '</div>';
      } else {
        var recording = st.rec !== null && st.rec !== 'working';
        noteBox = '<div style="background:#EEF2F8;border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:10px;box-shadow:inset 0 0 0 1.5px #C4C7CE">'
          + '<div style="display:flex;align-items:center;gap:12px">'
          + '<button type="button" data-mic aria-label="Say the follow-up note" class="' + (recording ? 'rec' : '') + '" style="width:48px;height:48px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;background:' + (recording ? '#D64545' : '#1170C0') + ';color:#FFFFFF;border:0">'
          + (st.rec === 'working' ? '<span class="spin" style="border-color:rgba(255,255,255,.3);border-top-color:#fff"></span>' : recording ? '<span style="width:16px;height:16px;border-radius:3px;background:#fff"></span>' : ic('mic', 22)) + '</button>'
          + '<span style="flex:1 1 auto;display:flex;flex-direction:column;gap:2px"><span style="font-size:15px;font-weight:600">'
          + (st.rec === 'working' ? 'Writing it up…' : recording ? 'Listening… tap to stop' : 'Say what happened and the next step') + '</span>'
          + '<span style="font-size:14px;color:#6B7486">' + (st.rec === 'working' ? 'One moment' : recording ? 'Talk normally' : BOOT.voice ? 'Tap the mic and talk' : 'Tap Type to write it') + '</span></span>'
          + '<button type="button" data-type style="height:34px;padding:0 12px;border-radius:17px;border:0;background:#FFFFFF;color:#062064;font-size:13px;font-weight:600;flex:none">Type</button>'
          + '</div></div>';
      }
      function fbtn(key, top, sub) {
        var on = st.follow === key;
        // As in L3: "Pick a date" is always outlined in blue, and filled once a date is picked.
        var style = on ? ON : key === 'pick' ? 'background:#E7F1FA;color:#1170C0;box-shadow:inset 0 0 0 2px #1170C0' : OFF;
        return '<button type="button" data-follow="' + key + '" style="height:54px;border-radius:12px;border:0;display:flex;flex-direction:column;align-items:center;justify-content:center;' + style + '">'
          + '<span style="font-size:14px;font-weight:600">' + top + '</span><span style="font-size:11px;opacity:0.75">' + sub + '</span></button>';
      }
      $sheet.innerHTML = '<div class="dim" data-close></div><div class="sheet">'
        + '<span class="grab"></span>'
        + '<div style="display:flex;justify-content:space-between;align-items:flex-start"><span style="display:flex;flex-direction:column;gap:2px">'
        + '<span style="font-size:15px;color:#6B7486">' + esc(p.name) + (p.clinic ? ' · ' + nb(p.clinic) : '') + '</span>'
        + '<span style="font-size:26px;font-weight:700;letter-spacing:-0.5px">Did you reach them?</span></span>'
        + '<button type="button" data-close style="height:34px;padding:0 14px;border-radius:17px;border:0;background:#EEF2F8;color:#062064;font-size:15px;font-weight:600;display:flex;align-items:center;flex:none">Cancel</button></div>'
        + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">'
        + [['call', 'phone', 'Call'], ['visit', 'pin', 'Visit'], ['text', 'text', 'Text']].map(function (k) {
          return '<button type="button" data-kind="' + k[0] + '" style="' + KIND_BTN + (st.kind === k[0] ? ON : OFF) + '">' + ic(k[1], 19) + k[2] + '</button>';
        }).join('') + '</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'
        + '<button type="button" data-reached="1" style="height:58px;border-radius:14px;border:0;font-size:17px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;' + (st.reached ? ON : OFF) + '">' + (st.reached ? '✓ ' : '') + 'Reached them</button>'
        + '<button type="button" data-reached="0" style="height:58px;border-radius:14px;border:0;font-size:17px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;' + (!st.reached ? ON : OFF) + '">' + (!st.reached ? '✓ ' : '') + 'No reply</button></div>'
        + '<div style="display:flex;flex-direction:column;gap:8px"><span style="font-size:17px;font-weight:600">Next follow-up</span>'
        + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">' + fbtn('eod', 'EOD', 'Today') + fbtn('tomorrow', 'Tomorrow', shortDate(tomorrow))
        + fbtn('pick', 'Pick a date', st.date ? shortDate(st.date) : 'Choose') + '</div>'
        + '<input type="date" data-date min="' + ymd() + '" value="' + st.date + '" style="position:absolute;opacity:0;pointer-events:none;width:1px;height:1px"></div>'
        + '<div style="display:flex;flex-direction:column;gap:8px"><span style="display:flex;justify-content:space-between;align-items:baseline">'
        + '<span style="font-size:17px;font-weight:600">What happened and the next step</span><span style="font-size:13px;font-weight:600;color:#6B7486">Required</span></span>' + noteBox + '</div>'
        + '<button type="button" data-save' + (canSave ? '' : ' disabled') + ' style="height:52px;border-radius:14px;border:0;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:600;'
        + (canSave ? 'background:#1170C0;color:#FFFFFF' : 'background:#E3E6EC;color:#A3A9B6') + '">' + (st.busy ? 'Saving…' : 'Save') + '</button></div>';
      if (st.typing) { var ta = $sheet.querySelector('[data-note]'); if (ta && document.activeElement !== ta && st.focus) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); st.focus = false; } }
    }
    draw();
    var recorder = null, chunks = [], stream = null;
    sheetCleanup = function () { if (recorder && recorder.state !== 'inactive') recorder.stop(); if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); };
    function startRec() {
      if (!BOOT.voice) { toast(errText({ message: 'voice_not_set_up' })); return; }
      if (!navigator.mediaDevices || !window.MediaRecorder) { toast('This phone can’t record here. Tap Type.'); return; }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
        stream = s; chunks = [];
        var mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find(function (m) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m); }) || '';
        recorder = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
        recorder.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
        recorder.onstop = function () {
          s.getTracks().forEach(function (t) { t.stop(); });
          var blob = new Blob(chunks, { type: (recorder.mimeType || mime || 'audio/webm').split(';')[0] });
          st.rec = 'working'; draw();
          var fr = new FileReader();
          fr.onload = function () {
            act('voice', { contactId: p.id, audio: String(fr.result).split(',')[1], mime: blob.type }).then(function (r) {
              st.rec = null; st.aiOutputId = r.aiOutputId;
              var text = r.note + (r.nextStep ? '\nNext: ' + r.nextStep : '');
              st.note = (st.note ? st.note + '\n' : '') + text; st.typing = true;
              if (r.followUpDate && r.followUpDate > ymd()) { st.follow = 'pick'; st.date = r.followUpDate; }
              if (!text.trim()) toast('Couldn’t hear that. Try again or tap Type.');
              draw();
            }, function (err) { st.rec = null; draw(); toast(errText(err)); });
          };
          fr.readAsDataURL(blob);
        };
        recorder.start();
        st.rec = 'on'; draw();
      }, function () { toast('Allow the microphone to talk, or tap Type.'); });
    }
    sheetHandler = function (e, type) {
      if (type === 'input') { var ta = e.target.closest('[data-note]'); if (ta) { st.note = ta.value; var sv = $sheet.querySelector('[data-save]'); var ok = st.note.trim().length > 1;
        sv.disabled = !ok; sv.style.background = ok ? '#1170C0' : '#E3E6EC'; sv.style.color = ok ? '#FFFFFF' : '#A3A9B6'; } return; }
      if (type === 'change') { var d = e.target.closest('[data-date]'); if (d && d.value) { st.follow = 'pick'; st.date = d.value; draw(); } return; }
      var b;
      if ((b = e.target.closest('[data-kind]'))) { st.kind = b.getAttribute('data-kind'); draw(); return; }
      if ((b = e.target.closest('[data-reached]'))) { st.reached = b.getAttribute('data-reached') === '1'; draw(); return; }
      if ((b = e.target.closest('[data-follow]'))) {
        var k = b.getAttribute('data-follow');
        if (k === 'pick') { var inp = $sheet.querySelector('[data-date]'); if (inp.showPicker) { try { inp.showPicker(); return; } catch (x) { /* fall through */ } } inp.focus(); inp.click(); return; }
        st.follow = k; draw(); return;
      }
      if (e.target.closest('[data-type]')) { st.typing = true; st.focus = true; draw(); return; }
      if (e.target.closest('[data-mic]')) {
        if (st.rec === 'on') { recorder.stop(); return; }
        if (st.rec === 'working') return;
        st.typing = false; startRec(); return;
      }
      if (e.target.closest('[data-save]')) {
        if (st.busy) return;
        st.busy = true; draw();
        act('log', { contactId: p.id, kind: st.kind, reached: st.reached, followUp: st.follow === 'pick' ? st.date : st.follow, note: st.note, aiOutputId: st.aiOutputId || undefined })
          .then(function (r) { closeSheet(); todayFirst = null; winMoment(r); }, function (err) { st.busy = false; draw(); toast(errText(err)); });
      }
    };
  }

  // ---- L4 The win moment ---------------------------------------------------------------------------------
  function winMoment(r) {
    var day = r.day;
    var line = L.winLine(r.name, r.followUp, day.done, day.goal);
    $sheet.innerHTML = '<div class="moment"><div class="inner">'
      + '<img src="/logo-white.png" alt="Renellence" style="height:18px;width:auto;margin-top:6px">'
      + '<div style="margin-top:56px"><svg width="180" height="180" viewBox="0 0 180 180" role="img" aria-label="' + day.done + ' of ' + day.goal + '">'
      + '<defs><linearGradient id="w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D7E8FA"/></linearGradient></defs>'
      + '<circle cx="90" cy="90" r="70" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="16"/>'
      + (day.done ? '<circle cx="90" cy="90" r="70" fill="none" stroke="url(#w)" stroke-width="16" stroke-linecap="round" stroke-dasharray="' + L.ringDash(70, day.done, day.goal) + '" transform="rotate(-90 90 90)"/>' : '')
      + '<text x="90" y="100" text-anchor="middle" font-family="-apple-system, Inter, sans-serif" font-size="40" font-weight="700" fill="#fff">' + day.done + '/' + day.goal + '</text></svg></div>'
      + '<span style="font-size:34px;font-weight:700;letter-spacing:-0.8px;margin-top:24px">Nice work!</span>'
      + '<span style="font-size:17px;color:#E3EEFB;line-height:1.45;margin-top:10px">' + esc(line) + '</span>'
      + '<div style="margin-top:auto;width:100%;padding:0 20px calc(var(--safe-bottom) + 40px);box-sizing:border-box;display:flex;flex-direction:column;gap:10px">'
      + (r.next ? '<button type="button" data-next="' + r.next.id + '" style="height:56px;border-radius:14px;border:0;background:#FFFFFF;color:#062064;display:flex;align-items:center;justify-content:center;gap:7px;font-size:17px;font-weight:600">Next: ' + esc(r.next.name) + '</button>'
        : '<button type="button" data-done style="height:56px;border-radius:14px;border:0;background:#FFFFFF;color:#062064;font-size:17px;font-weight:600">Back to Today</button>')
      + '<button type="button" data-undo style="border:0;background:transparent;font-size:16px;font-weight:600;color:#E3EEFB;text-decoration:underline;padding:6px">Undo</button>'
      + '</div></div></div>';
    sheetHandler = function (e) {
      var b = e.target.closest('[data-next]');
      if (b) { closeSheet(); go('/person/' + b.getAttribute('data-next')); return; }
      if (e.target.closest('[data-done]')) { closeSheet(); go('/'); return; }
      if (e.target.closest('[data-undo]')) {
        act('undo', { interactionId: r.interactionId, closedTaskIds: r.closedTaskIds }).then(function () { closeSheet(); toast('Undone'); render(); }, function (err) { toast(errText(err)); });
      }
    };
  }

  // ---- L5 Joined your Fifty --------------------------------------------------------------------------------
  function joinedMoment(j) {
    var dots = '';
    for (var i = 0; i < j.goal; i++) {
      dots += i < j.count - 1 ? '<span style="display:block;aspect-ratio:1 / 1;border-radius:50%;box-sizing:border-box;background:#FFFFFF"></span>'
        : i === j.count - 1 ? '<span style="display:block;aspect-ratio:1 / 1;border-radius:50%;box-sizing:border-box;background:#FFC94A;box-shadow:0 0 0 4px rgba(255,201,74,0.3)"></span>'
          : '<span style="display:block;aspect-ratio:1 / 1;border-radius:50%;box-sizing:border-box;border:1.5px dashed rgba(255,255,255,0.4)"></span>';
    }
    var toNext = j.next - j.count;
    $sheet.innerHTML = '<div class="moment"><div class="inner">'
      + '<img src="/logo-white.png" alt="Renellence" style="height:18px;width:auto;margin-top:6px">'
      + '<span style="margin-top:28px;font-size:13px;font-weight:700;letter-spacing:1.2px;color:#FFC94A">NEW IN MY FIFTY</span>'
      + '<span style="font-size:32px;font-weight:700;letter-spacing:-0.8px;line-height:1.15;margin-top:10px">' + esc(j.name) + '<br>joined your Fifty!</span>'
      + '<div style="width:100%;margin-top:28px"><div style="display:grid;grid-template-columns:repeat(10,1fr);gap:9px">' + dots + '</div></div>'
      + '<span style="font-size:52px;font-weight:700;letter-spacing:-1.5px;margin-top:26px;line-height:1">' + j.count + '<span style="font-size:22px;color:#E3EEFB;font-weight:600"> of ' + j.goal + '</span></span>'
      + '<span style="font-size:17px;color:#E3EEFB;margin-top:8px">' + toNext + ' more to your next milestone: ' + j.next + '</span>'
      + '<div style="margin-top:auto;width:100%;padding-bottom:calc(var(--safe-bottom) + 40px)">'
      + '<button type="button" data-keep style="width:100%;height:56px;border-radius:14px;border:0;background:#FFFFFF;color:#062064;font-size:17px;font-weight:600">Keep going</button></div></div></div>';
    sheetHandler = function (e) { if (e.target.closest('[data-keep]')) { closeSheet(); act('seen_fifty').catch(function () {}); } };
  }

  // ---- L13 Add a person -------------------------------------------------------------------------------------
  var ROLES = [['physician', 'Physician'], ['nurse_injector', 'Nurse injector'], ['clinic_owner', 'Clinic owner'], ['manager', 'Manager'], ['other', 'Other']];
  function openAddPerson() {
    var st = { role: null, warm: true, busy: false };
    var IN = 'flex:1 1 auto;min-width:0;height:50px;border:0;background:transparent;padding:0 14px;font-size:17px;color:#062064;outline:none';
    var LBL = 'font-size:13px;font-weight:700;color:#6B7486;letter-spacing:0.4px;padding:0 4px';
    $sheet.innerHTML = '<div class="dim" data-close></div><div class="sheet tall" style="gap:10px">'
      + '<span class="grab"></span>'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span style="font-size:26px;font-weight:700;letter-spacing:-0.5px">Add a person</span>'
      + '<button type="button" data-close style="height:34px;padding:0 14px;border-radius:17px;border:0;background:#EEF2F8;color:#062064;font-size:15px;font-weight:600;display:flex;align-items:center">Cancel</button></div>'
      + '<span style="' + LBL + '">NAME</span>'
      + '<div style="background:#EEF2F8;border-radius:14px;display:flex;flex-direction:column"><div style="display:flex">'
      + '<input type="text" name="firstName" placeholder="First name" aria-label="First name" autocomplete="off" style="' + IN + '"><span style="width:0.5px;background:#DDE2EA;margin:10px 0"></span>'
      + '<input type="text" name="lastName" placeholder="Last name" aria-label="Last name" autocomplete="off" style="' + IN + '"></div></div>'
      + '<span style="' + LBL + '">ROLE</span><div data-roles style="display:flex;flex-wrap:wrap;gap:8px"></div>'
      + '<span style="' + LBL + '">CLINIC</span>'
      + '<div style="background:#EEF2F8;border-radius:14px;display:flex;flex-direction:column"><input type="text" name="clinic" placeholder="Clinic name" aria-label="Clinic name" autocomplete="off" style="' + IN + '"></div>'
      + '<span style="' + LBL + '">CONTACT</span>'
      + '<div style="background:#EEF2F8;border-radius:14px;display:flex;flex-direction:column"><input type="tel" name="phone" placeholder="Phone" aria-label="Phone" autocomplete="off" style="' + IN + '">'
      + '<span style="display:block;height:0.5px;background:#DDE2EA;margin-left:14px"></span><input type="email" name="email" placeholder="Email" aria-label="Email" autocomplete="off" style="' + IN + '"></div>'
      + '<span style="' + LBL + '">DO THEY KNOW YOU OR RENELLENCE?</span><div data-warm style="display:grid;grid-template-columns:1fr 1fr;background:#E3E6EC;border-radius:12px;padding:3px"></div>'
      + '<button type="button" data-save style="margin-top:auto;height:54px;border-radius:14px;border:0;background:#1170C0;color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:600;flex:none">Save person</button></div>';
    function chips() {
      $sheet.querySelector('[data-roles]').innerHTML = ROLES.map(function (r) {
        var on = st.role === r[0];
        return '<button type="button" data-role="' + r[0] + '" style="height:40px;padding:0 14px;border-radius:20px;border:0;font-size:15px;font-weight:600;' + (on ? 'background:#1170C0;color:#FFFFFF' : 'background:#EEF2F8;color:#062064') + '">' + r[1] + '</button>';
      }).join('');
      $sheet.querySelector('[data-warm]').innerHTML = [[true, 'Yes · warm lead'], [false, 'No · cold lead']].map(function (x) {
        var on = st.warm === x[0];
        return '<button type="button" data-w="' + (x[0] ? 1 : 0) + '" style="height:40px;border-radius:9px;border:0;font-size:15px;font-weight:600;' + (on ? 'background:#FFFFFF;color:#062064;box-shadow:0 1px 2px rgba(0,0,0,0.08)' : 'background:transparent;color:#6B7486') + '">' + x[1] + '</button>';
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
        st.busy = true; b.textContent = 'Saving…';
        act('add_person', { firstName: v('firstName'), lastName: v('lastName'), clinic: v('clinic'), phone: v('phone'), email: v('email'), role: st.role, warm: st.warm })
          .then(function (r) { closeSheet(); toast('Saved'); go('/person/' + r.id); },
            function (err) { st.busy = false; b.textContent = 'Save person'; toast(errText(err)); if (err.message === 'already_yours' && err.detail) { closeSheet(); go('/person/' + err.detail); } });
      }
    };
  }

  // ---- Email (L7 Email): sent from the rep's Gmail ------------------------------------------------------------
  function openEmail(p) {
    if (!p.email) { toast('No email address for ' + p.first + ' yet.'); return; }
    if (BOOT.gmail !== 'connected') {
      $sheet.innerHTML = '<div class="dim" data-close></div><div class="sheet"><span class="grab"></span>'
        + '<span style="font-size:26px;font-weight:700;letter-spacing:-0.5px">Connect Gmail</span>'
        + '<span style="font-size:16px;color:#6B7486;line-height:1.4">Emails go from your own Renellence Gmail. Sign in once more with Google and allow Gmail.</span>'
        + '<button type="button" data-connect style="height:54px;border-radius:14px;border:0;background:#1170C0;color:#FFFFFF;font-size:17px;font-weight:600">Connect Gmail</button>'
        + '<button type="button" data-close style="height:48px;border-radius:14px;border:0;background:#EEF2F8;color:#062064;font-size:16px;font-weight:600">Not now</button></div>';
      sheetHandler = function (e) { if (e.target.closest('[data-connect]')) signIn(location.pathname); };
      return;
    }
    $sheet.innerHTML = '<div class="dim" data-close></div><div class="sheet tall" style="gap:12px"><span class="grab"></span>'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start"><span style="display:flex;flex-direction:column;gap:2px">'
      + '<span style="font-size:15px;color:#6B7486">' + esc(p.name) + (p.clinic ? ' · ' + nb(p.clinic) : '') + '</span>'
      + '<span style="font-size:26px;font-weight:700;letter-spacing:-0.5px">Email</span></span>'
      + '<button type="button" data-close style="height:34px;padding:0 14px;border-radius:17px;border:0;background:#EEF2F8;color:#062064;font-size:15px;font-weight:600;flex:none">Cancel</button></div>'
      + '<div style="background:#EEF2F8;border-radius:14px;display:flex;flex-direction:column">'
      + '<div style="display:flex;align-items:center;min-height:50px;padding:0 14px;gap:10px"><span style="width:62px;font-size:15px;color:#6B7486">To</span><span style="font-size:16px;font-weight:600">' + esc(p.email) + '</span></div>'
      + '<span style="display:block;height:0.5px;background:#DDE2EA;margin-left:14px"></span>'
      + '<label style="display:flex;align-items:center;min-height:50px;padding:0 14px;gap:10px"><span style="width:62px;font-size:15px;color:#6B7486">Subject</span><input class="bare" name="subject" style="flex:1;min-width:0;font-size:16px;font-weight:600;height:48px"></label></div>'
      + '<div style="background:#EEF2F8;border-radius:14px;padding:12px 14px;flex:1;display:flex"><textarea class="note" name="text" placeholder="Message" style="flex:1;min-height:180px"></textarea></div>'
      + '<button type="button" data-send style="height:54px;border-radius:14px;border:0;background:#1170C0;color:#FFFFFF;font-size:17px;font-weight:600;flex:none">Send from Gmail</button></div>';
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

  // ---- L14 History and notes ----------------------------------------------------------------------------------
  var historyTab = 'all';
  var TONE = { amber: 'background:#FFF1D6;color:#8A5A00', green: 'background:#E6F4EA;color:#1E7B3C', blue: 'background:#EAF3FC;color:#1170C0', grey: 'background:#EEF2F8;color:#6B7486' };
  function screenHistory(id) {
    return paint(read('history', { id: id }), function (d) {
      var entries = d.entries.filter(function (e) {
        return historyTab === 'all' || (historyTab === 'notes' ? (e.type === 'touch' || e.type === 'note') : (e.type === 'order' || e.type === 'samples'));
      });
      var h = '<div class="scr">' + backLink('/person/' + d.id, d.name)
        + '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:0 4px 14px"><span style="font-size:34px;font-weight:700;letter-spacing:-0.8px">History</span></div>'
        + '<div style="flex:none;display:grid;grid-template-columns:repeat(3,1fr);background:#E3E6EC;border-radius:10px;padding:2px;margin-bottom:6px">'
        + [['all', 'All'], ['notes', 'Notes'], ['orders', 'Orders']].map(function (t) {
          return '<button type="button" data-htab="' + t[0] + '" style="height:32px;border:0;border-radius:8px;font-size:14px;font-weight:600;' + (historyTab === t[0] ? 'background:#FFFFFF;color:#062064;box-shadow:0 1px 2px rgba(0,0,0,0.08)' : 'background:transparent;color:#6B7486') + '">' + t[1] + '</button>';
        }).join('') + '</div><div style="padding-bottom:12px">';
      var month = '';
      var thisYear = ymd().slice(0, 4);
      entries.forEach(function (e, i) {
        var m = e.month + (e.year !== thisYear ? ' ' + e.year : '');
        if (m !== month) { month = m; h += '<span style="display:block;font-size:13px;font-weight:700;color:#6B7486;letter-spacing:0.4px;padding:8px 2px">' + esc(m.toUpperCase()) + '</span>'; }
        var last = i === entries.length - 1;
        var line = '<span style="flex:1 1 auto;width:2px;background:' + (last ? 'transparent' : '#DDE2EA') + '"></span>';
        var badge, card;
        if (e.type === 'touch') {
          badge = '<span style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none;background:#EAF3FC;color:#1170C0">' + ic({ call: 'phone', meeting: 'pin', text: 'text', email: 'mail', note: 'pen' }[e.kind] || 'pen', 16) + '</span>';
          card = '<div style="flex:1 1 auto;min-width:0;background:#FFFFFF;border-radius:16px;padding:12px 14px;margin-bottom:10px;display:flex;flex-direction:column;gap:3px">'
            + '<span style="display:flex;justify-content:space-between;gap:8px"><span style="font-size:15px;font-weight:700">' + esc(e.title) + '</span><span style="font-size:13px;color:#6B7486;white-space:nowrap">' + esc(e.when) + '</span></span>'
            + (e.body ? '<span data-body style="font-size:15px;line-height:1.35;white-space:pre-line">' + esc(L.stripNext(e.body)) + '</span>' : '')
            + (e.next ? '<span style="font-size:15px;line-height:1.35"><b>Next:</b> ' + esc(e.next) + '</span>' : '')
            + '<span style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;color:#6B7486">' + esc(e.by) + '</span>'
            + (e.editable ? '<button type="button" data-edit="' + e.id + '" data-text="' + esc(e.body) + '" style="border:0;background:transparent;font-size:13px;font-weight:600;color:#1170C0;padding:2px 0 2px 8px">Edit</button>' : '') + '</span></div>';
        } else if (e.type === 'note') {
          badge = '<span style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none;background:#FFF6DC;color:#5C4300">' + ic('pinned', 16) + '</span>';
          card = '<div style="flex:1 1 auto;min-width:0;border-radius:16px;padding:12px 14px;margin-bottom:10px;display:flex;flex-direction:column;gap:3px;background:#FFFBEF">'
            + '<span style="display:flex;justify-content:space-between;gap:8px"><span style="font-size:15px;font-weight:700">' + esc(e.title) + '</span><span style="font-size:13px;color:#6B7486;white-space:nowrap">' + esc(e.when) + '</span></span>'
            + '<span style="font-size:15px;line-height:1.35;white-space:pre-line">' + esc(e.body) + '</span><span style="font-size:12px;color:#6B7486">' + esc(e.by) + '</span></div>';
        } else if (e.type === 'order' || e.type === 'samples') {
          badge = '<span style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none;background:#1170C0;color:#FFFFFF">' + ic(e.type === 'order' ? 'box' : 'gift', 16) + '</span>';
          card = '<a href="/orders/' + e.id + '" data-nav style="flex:1 1 auto;min-width:0;background:#FFFFFF;border-radius:16px;padding:12px 14px;margin-bottom:10px;display:flex;flex-direction:column;gap:6px;box-shadow:inset 3px 0 0 #1170C0">'
            + '<span style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:17px;font-weight:700">' + esc(e.title) + '</span><span style="font-size:13px;color:#6B7486;white-space:nowrap">' + esc(e.when) + '</span></span>'
            + '<span style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span style="font-size:14px;color:#3F4A5A">' + esc(e.body) + '</span>'
            + '<span style="height:22px;padding:0 9px;border-radius:11px;font-size:12px;font-weight:700;display:flex;align-items:center;white-space:nowrap;flex:none;' + (TONE[e.tone] || TONE.grey) + '">' + esc(e.status) + '</span></span></a>';
        } else {
          badge = '<span style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none;background:#EEF2F8;color:#6B7486">' + ic('flag', 16) + '</span>';
          card = '<span style="flex:1 1 auto;display:flex;justify-content:space-between;align-items:center;min-height:34px;margin-bottom:10px;font-size:14px;font-weight:600;color:#3F4A5A">' + esc(e.title)
            + '<span style="font-size:13px;font-weight:500;color:#6B7486">' + esc(e.when) + '</span></span>';
        }
        h += '<div style="display:flex;gap:10px"><span style="width:34px;flex:none;display:flex;flex-direction:column;align-items:center">' + badge + line + '</span>' + card + '</div>';
      });
      if (!entries.length) h += '<section style="background:#FFFFFF;border-radius:16px;padding:16px 14px;font-size:15px;color:#6B7486">Nothing here yet.</section>';
      return h + '</div></div>';
    }, 'people');
  }
  $app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-htab]');
    if (b) { historyTab = b.getAttribute('data-htab'); render(); return; }
    b = e.target.closest('[data-edit]');
    if (b) {
      var id = b.getAttribute('data-edit'), text = b.getAttribute('data-text');
      $sheet.innerHTML = '<div class="dim" data-close></div><div class="sheet"><span class="grab"></span>'
        + '<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:26px;font-weight:700;letter-spacing:-0.5px">Edit note</span>'
        + '<button type="button" data-close style="height:34px;padding:0 14px;border-radius:17px;border:0;background:#EEF2F8;color:#062064;font-size:15px;font-weight:600">Cancel</button></div>'
        + '<div style="background:#EEF2F8;border-radius:16px;padding:12px;box-shadow:inset 0 0 0 1.5px #C4C7CE"><textarea class="note" data-note style="min-height:140px">' + esc(text) + '</textarea></div>'
        + '<button type="button" data-save style="height:52px;border-radius:14px;border:0;background:#1170C0;color:#FFFFFF;font-size:16px;font-weight:600">Save</button></div>';
      sheetHandler = function (ev, type) {
        if (type || !ev.target.closest('[data-save]')) return;
        act('edit_note', { interactionId: id, body: $sheet.querySelector('[data-note]').value }).then(function () { closeSheet(); render(); }, function (err) { toast(errText(err)); });
      };
    }
  });

  // ---- Progress screens: L19 order, L21 samples, L20 onboarding ---------------------------------------------
  function steps(list) {
    return '<section style="background:#FFFFFF;border-radius:22px;padding:20px 18px;margin-bottom:12px">' + list.map(function (s, i) {
      var last = i === list.length - 1;
      var dot = s.done ? '<span style="width:28px;height:28px;border-radius:50%;background:#1170C0;display:flex;align-items:center;justify-content:center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>'
        : s.current ? '<span style="width:28px;height:28px;border-radius:50%;background:#FFFFFF;box-shadow:inset 0 0 0 3px #1170C0,0 0 0 6px rgba(17,112,192,0.15);display:flex;align-items:center;justify-content:center"><span style="width:9px;height:9px;border-radius:50%;background:#1170C0"></span></span>'
          : '<span style="width:28px;height:28px;border-radius:50%;box-shadow:inset 0 0 0 2px #D6DCE6"></span>';
      var lineColor = s.done && list[i + 1] && (list[i + 1].done || list[i + 1].current) ? '#1170C0' : '#D6DCE6';
      var color = s.done ? '#062064' : s.current ? '#1170C0' : '#9AA1AD', sub = s.done ? '#6B7486' : s.current ? '#1170C0' : '#9AA1AD';
      return '<div style="display:flex;gap:14px"><span style="display:flex;flex-direction:column;align-items:center;width:28px;flex:none">' + dot
        + (last ? '' : '<span style="flex:1 1 auto;width:3px;background:' + lineColor + ';min-height:30px"></span>') + '</span>'
        + '<span style="display:flex;flex-direction:column;padding:3px 0 ' + (last ? '0' : '18px') + '"><span style="font-size:17px;font-weight:700;color:' + color + '">' + esc(s.label) + '</span>'
        + '<span style="font-size:14px;font-weight:500;color:' + sub + '">' + esc(s.when || '') + '</span></span></div>';
    }).join('') + '</section>';
  }
  function bigButton(attr, label) {
    return '<button type="button" ' + attr + ' style="height:54px;border-radius:14px;background:#1170C0;color:#FFFFFF;display:flex;align-items:center;justify-content:center;gap:7px;font-size:17px;font-weight:600;border:0;width:100%">' + esc(label) + '</button>';
  }
  function doneRow(label, value, ok) {
    return '<div style="margin-top:14px;background:#FFFFFF;border-radius:18px;min-height:52px;padding:0 14px;display:flex;align-items:center;gap:10px">'
      + (ok ? '<span style="width:22px;height:22px;border-radius:50%;background:#1170C0;color:#FFFFFF;display:flex;align-items:center;justify-content:center">' + ic('check', 13, 3) + '</span>'
        : '<span style="width:22px;height:22px;border-radius:50%;box-shadow:inset 0 0 0 2px #D6DCE6"></span>')
      + '<span style="font-size:15px;font-weight:600;flex:1 1 auto">' + esc(label) + '</span><span style="font-size:14px;color:#6B7486">' + esc(value) + '</span></div>';
  }
  function screenOrderStatus(id) {
    return paint(read('order', { id: id }), function (o) {
      var h = '<div class="scr">' + backLink('/person/' + o.contactId, o.name)
        + bigTitle(o.sample ? 'Samples' : 'Order', '<span style="font-size:17px;font-weight:600;color:#6B7486;padding-bottom:6px">' + esc(o.total) + '</span>')
        + steps(o.steps);
      if (o.action === 'resend_pay_link') h += bigButton('data-nudge="resend_pay_link" data-order="' + o.id + '"', 'Resend pay link');
      if (o.action === 'remind_md') h += bigButton('data-nudge="remind_md" data-order="' + o.id + '"', 'Remind MD to sign');
      if (o.onboarding) h += doneRow(o.onboarding.label, o.onboarding.value, o.onboarding.done);
      if (o.lines.length) {
        h += '<section style="margin-top:14px;background:#FFFFFF;border-radius:18px;padding:4px 0">' + o.lines.map(function (l, i) {
          return '<div style="display:flex;justify-content:space-between;align-items:center;min-height:46px;padding:0 14px' + (i ? ';border-top:0.5px solid #E3E6EC' : '') + '"><span style="font-size:15px">' + esc(l.name) + '</span>'
            + '<span style="height:20px;padding:0 8px;border-radius:10px;background:#EAF3FC;color:#1170C0;font-size:12px;font-weight:700;display:inline-flex;align-items:center">' + l.qty + ' · Free</span></div>';
        }).join('') + '</section>';
      }
      return h + '</div>';
    }, 'people');
  }
  function screenOnboarding(id) {
    return paint(read('onboarding', { id: id }), function (o) {
      var h = '<div class="scr">' + backLink('/person/' + o.id, o.name) + bigTitle('Onboarding', '');
      if (o.none) return h + '<section style="background:#FFFFFF;border-radius:16px;padding:16px 14px;font-size:15px;color:#6B7486">No onboarding form yet.</section></div>';
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
      b.disabled = false;
      if (r.ok) toast(op === 'resend_pay_link' ? 'Pay link sent again' : 'Reminder sent to the MD');
      else toast('Couldn’t send it yet. Ask an admin to check the order connection.');
    }, function (err) { b.disabled = false; toast(errText(err)); });
  });

  // ---- L9 New order: who is it for? -------------------------------------------------------------------------
  var readyPeople = [];
  function screenWho() {
    return paint(read('ready'), function (d) {
      readyPeople = d.people;
      return '<div class="scr" style="min-height:100dvh">'
        + '<div style="flex:none;display:flex;justify-content:space-between;align-items:flex-end;padding:0 4px 10px"><span style="font-size:34px;font-weight:700;letter-spacing:-0.8px">New order</span></div>'
        + '<span style="flex:none;font-size:17px;font-weight:600;padding:0 4px 8px">Who is it for?</span>'
        + searchBox('ready', 'Find a person', 44, 10)
        + '<section data-ready style="background:#FFFFFF;border-radius:16px;margin-bottom:10px">' + readyRows(readyPeople) + '</section>'
        + '<span style="flex:none;font-size:13px;color:#6B7486;padding:0 4px 10px">Only people who are ready to order show here.</span></div>';
    }, 'order');
  }
  function readyRows(list) {
    if (!list.length) return '<div style="padding:16px 14px;font-size:15px;color:#6B7486">Nobody is ready to order yet.</div>';
    return list.map(function (p, i) {
      return '<a href="/order/' + p.id + '" data-nav style="width:100%;' + (i ? 'border-top:0.5px solid #E3E6EC;' : '') + 'display:flex;align-items:center;gap:12px;min-height:60px;padding:0 14px;color:#062064">'
        + '<span style="width:36px;height:36px;border-radius:50%;background:#EEF2F8;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex:none">' + esc(p.initials) + '</span>'
        + '<span style="flex:1 1 auto;display:flex;flex-direction:column;min-width:0"><span style="font-size:16px;font-weight:600">' + esc(p.name) + '</span><span style="font-size:13px;color:#6B7486">' + nb(p.clinic) + '</span></span>' + CHEV + '</a>';
    }).join('');
  }
  function filterReady(q) {
    var t = q.toLowerCase();
    $app.querySelector('[data-ready]').innerHTML = readyRows(readyPeople.filter(function (p) { return !t || (p.name + ' ' + p.clinic).toLowerCase().indexOf(t) >= 0; }));
  }

  // ---- #12 Order or samples: the products ---------------------------------------------------------------------
  // The draft order lives here until it is sent: { contactId, kind, qty: { sku: n }, payment, approvalNote, shippingNote, mdName, mdEmail }.
  var draft = null;
  function draftFor(contactId) {
    if (!draft || draft.contactId !== contactId) draft = { contactId: contactId, kind: 'order', qty: {}, payment: 'card_on_file', approvalNote: '', shippingNote: '', mdName: '', mdEmail: '' };
    return draft;
  }
  function screenProducts(contactId) {
    var dft = draftFor(contactId);
    return paint(read('products', { id: contactId }), function (d) {
      var list = L.visibleProducts(d.products, dft.qty, dft.kind);
      var tot = L.draftTotals(d.products, dft.qty, dft.kind), count = tot.count, total = tot.total;
      var h = '<div class="scr" style="gap:14px">'
        + '<span style="font-size:34px;font-weight:700;letter-spacing:-0.8px;padding:0 4px">New order</span>'
        + '<div role="tablist" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));background:#E4E8EF;border-radius:12px;padding:3px;gap:3px">'
        + [['order', 'Order'], ['samples', 'Samples']].map(function (t) {
          return '<button type="button" role="tab" data-okind="' + t[0] + '" aria-selected="' + (dft.kind === t[0]) + '" style="height:40px;border-radius:9px;border:0;font-size:15px;font-weight:600;' + (dft.kind === t[0] ? SEG_ON : SEG_OFF + ';background:transparent') + '">' + t[1] + '</button>';
        }).join('') + '</div>'
        + '<section style="background:#FFFFFF;border-radius:22px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px">'
        + '<span style="display:flex;flex-direction:column;gap:2px"><span style="font-size:14px;color:#6B7486">For</span><span style="font-size:20px;font-weight:600;letter-spacing:-0.3px">' + esc(d.person.name) + '</span>'
        + (d.person.clinic ? '<span style="font-size:14px;color:#6B7486">' + nb(d.person.clinic) + '</span>' : '') + '</span>'
        + '<a href="/order" data-nav style="height:34px;padding:0 14px;border-radius:17px;background:#EEF2F8;font-size:15px;font-weight:600;display:flex;align-items:center;flex:none">Change</a></section>'
        + (d.sameAsLast.length && dft.kind === 'order' ? '<button type="button" data-same style="height:52px;border-radius:14px;border:0;background:#FFFFFF;color:#1170C0;font-size:16px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px">' + ic('redo', 18) + 'Same as last order</button>' : '')
        + '<section style="background:#FFFFFF;border-radius:16px;padding:0 14px">' + list.map(function (p, i) {
          var q = dft.qty[p.sku] || 0;
          var sub = L.productSub(p, dft.kind);
          return '<div style="display:flex;align-items:center;gap:12px;padding:12px 0' + (i ? ';border-top:0.5px solid #E3E6EC' : '') + '">'
            + '<span style="flex:1 1 auto;display:flex;flex-direction:column;gap:2px;min-width:0"><span style="font-size:16px;font-weight:600">' + esc(p.name) + '</span><span style="font-size:13px;color:#6B7486">' + esc(sub) + '</span></span>'
            + '<button type="button" data-less="' + esc(p.sku) + '" aria-label="Fewer" style="width:40px;height:40px;border-radius:50%;border:0;background:#EEF2F8;color:#062064;font-size:22px;font-weight:600;flex:none"' + (q ? '' : ' disabled') + '>−</button>'
            + '<span style="width:26px;text-align:center;font-size:18px;font-weight:700;flex:none">' + q + '</span>'
            + '<button type="button" data-more="' + esc(p.sku) + '" aria-label="More" style="width:40px;height:40px;border-radius:50%;border:0;background:#1170C0;color:#FFFFFF;font-size:22px;font-weight:600;flex:none">+</button></div>';
        }).join('') + '</section>'
        + '<section style="display:flex;flex-direction:column;gap:10px;position:sticky;bottom:calc(var(--safe-bottom) + 72px);background:#F2F3F7;padding:8px 0 4px">'
        + '<div style="display:flex;justify-content:space-between;font-size:17px;font-weight:700;padding:0 4px"><span>Total</span><span>' + count + (count === 1 ? ' item' : ' items') + (dft.kind === 'order' && total ? ' · ' + money(total) : dft.kind === 'samples' && count ? ' · Free' : '') + '</span></div>'
        + (count ? '<a href="/order/' + contactId + '/review" data-nav style="height:56px;border-radius:14px;background:#1170C0;color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:600">Review ' + (dft.kind === 'samples' ? 'samples' : 'order') + '</a>'
          : '<span style="height:56px;border-radius:14px;border:2px dashed #C4C7CE;color:#6B7486;font-size:16px;font-weight:600;display:flex;align-items:center;justify-content:center;box-sizing:border-box">Add products to review</span>')
        + '</section></div>';
      dft.products = d;
      return h;
    }, 'order');
  }
  $app.addEventListener('click', function (e) {
    if (!draft) return;
    var b = e.target.closest('[data-okind]');
    if (b) { draft.kind = b.getAttribute('data-okind'); draft.qty = {}; screenProducts(draft.contactId); return; }
    if (e.target.closest('[data-same]') && draft.products) {
      draft.qty = L.sameAsLast(draft.products.sameAsLast);
      screenProducts(draft.contactId); return;
    }
    if ((b = e.target.closest('[data-more]'))) { var s = b.getAttribute('data-more'); draft.qty[s] = (draft.qty[s] || 0) + 1; keepScroll(function () { return screenProducts(draft.contactId); }); return; }
    if ((b = e.target.closest('[data-less]'))) { var k = b.getAttribute('data-less'); draft.qty[k] = Math.max(0, (draft.qty[k] || 0) - 1); if (!draft.qty[k]) delete draft.qty[k]; keepScroll(function () { return screenProducts(draft.contactId); }); }
  });
  function keepScroll(fn) { var y = window.scrollY; Promise.resolve(fn()).then(function () { window.scrollTo(0, y); }); }

  // ---- L10 / L15 Review and send ------------------------------------------------------------------------------
  function screenReview(contactId) {
    var dft = draftFor(contactId);
    return paint(read('products', { id: contactId }), function (d) {
      dft.products = d;
      var by = {}; d.products.forEach(function (p) { by[p.sku] = p; });
      var lines = Object.keys(dft.qty).filter(function (s) { return by[s] && dft.qty[s] > 0; }).map(function (s) { return { p: by[s], q: dft.qty[s] }; });
      if (!lines.length) { setTimeout(function () { go('/order/' + contactId, true); }, 0); return loading(); }
      var samples = dft.kind === 'samples';
      var total = samples ? 0 : lines.reduce(function (a, l) { return a + (l.p.alwaysFree ? 0 : l.q * l.p.price); }, 0);
      var who = d.person;
      function infoRow(label, value, first) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:0 14px' + (first ? '' : ';border-top:0.5px solid #E3E6EC') + '">'
          + '<span style="font-size:15px;color:#6B7486;flex:none">' + label + '</span><span style="font-size:15px;font-weight:600;text-align:right">' + value + '</span></div>';
      }
      var billingSame = L.billingSame(who);
      var FREE = '<span style="height:20px;padding:0 8px;border-radius:10px;background:#EAF3FC;color:#1170C0;font-size:12px;font-weight:700;display:inline-flex;align-items:center">Free</span>';
      var h = '<div class="scr">' + backLink('/order/' + contactId, 'Edit order')
        + '<span style="font-size:30px;font-weight:700;letter-spacing:-0.7px;padding:0 4px 8px">Review</span>'
        + smallLabel((who.name + (who.clinic ? ' · ' + who.clinic : '')).toUpperCase())
        + '<section style="background:#FFFFFF;border-radius:16px;margin-bottom:10px">'
        + infoRow('Email', esc(who.email || 'None'), true) + infoRow('Ship to', esc(who.shipping.line || 'No address yet'))
        + infoRow('Billing', billingSame ? 'Same as shipping' : esc(who.billing.line)) + (who.secondaryEmail ? infoRow('Invoice email', esc(who.secondaryEmail)) : '') + '</section>'
        + (who.secondaryEmail ? '' : '<button type="button" data-invoice-email style="display:block;border:0;background:transparent;text-align:left;font-size:14px;font-weight:600;color:#1170C0;padding:0 4px 10px">+ Add an invoice email</button>')
        + smallLabel('ITEMS', '<a href="/order/' + contactId + '" data-nav style="font-size:14px;font-weight:600;color:#1170C0">Edit</a>')
        + '<section style="background:#FFFFFF;border-radius:16px;margin-bottom:10px">' + lines.map(function (l, i) {
          var free = samples || l.p.alwaysFree;
          return infoRow(esc(l.p.name) + ' · ' + l.q, free ? FREE : money(l.q * l.p.price), !i).replace('font-size:15px;color:#6B7486;flex:none', 'font-size:15px;color:#6B7486;flex:0 1 auto');
        }).join('')
          + (samples ? '' : '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:0 14px;border-top:0.5px solid #E3E6EC"><b style="color:#062064;font-size:15px">Total</b><b style="font-size:17px">' + money(total) + '</b></div>')
          + '</section>';
      if (samples) {
        h += smallLabel('MEDICAL DIRECTOR')
          + '<section style="background:#FFFFFF;border-radius:16px;margin-bottom:4px">'
          + '<label style="display:flex;align-items:center;gap:10px;min-height:48px;padding:0 14px"><span style="width:52px;font-size:15px;color:#6B7486">Name</span>'
          + '<input type="text" data-md="mdName" value="' + esc(dft.mdName) + '" placeholder="Dr. name" style="flex:1 1 auto;min-width:0;border:0;background:transparent;font-size:15px;font-weight:600;color:#062064;outline:none"></label>'
          + '<label style="display:flex;align-items:center;gap:10px;min-height:48px;padding:0 14px;border-top:0.5px solid #E3E6EC"><span style="width:52px;font-size:15px;color:#6B7486">Email</span>'
          + '<input type="email" data-md="mdEmail" value="' + esc(dft.mdEmail) + '" placeholder="md@clinic.ca" style="flex:1 1 auto;min-width:0;border:0;background:transparent;font-size:15px;font-weight:600;color:#062064;outline:none"></label></section>'
          + '<span style="display:block;font-size:13px;color:#6B7486;padding:0 4px 12px">Signs after approval. Ships once signed.</span>';
      } else {
        h += smallLabel('PAYMENT')
          + '<div style="display:grid;grid-template-columns:1fr 1fr;background:#E3E6EC;border-radius:10px;padding:2px;margin-bottom:6px">'
          + [['card_on_file', 'Card on file'], ['wire', 'Wire / e-transfer']].map(function (x) {
            return '<button type="button" data-pay="' + x[0] + '" style="height:36px;border:0;border-radius:8px;font-size:14px;font-weight:600;' + (dft.payment === x[0] ? 'background:#FFFFFF;color:#062064;box-shadow:0 1px 2px rgba(0,0,0,0.08)' : 'background:transparent;color:#6B7486') + '">' + x[1] + '</button>';
          }).join('') + '</div>'
          + '<span style="display:block;font-size:13px;color:#6B7486;padding:0 4px 12px">' + (dft.payment === 'wire' ? 'They pay by wire or e-transfer. It counts as paid now and ships once approved.'
            : d.card.saved ? esc(d.card.text) + ' · charged once approved. No card or declined? They get a pay link.' : 'No card on file. They get a pay link once approved.') + '</span>';
      }
      function noteRow(key, label, first) {
        var val = dft[key];
        return '<div style="' + (first ? '' : 'border-top:0.5px solid #E3E6EC') + '">'
          + '<button type="button" data-notebtn="' + key + '" style="width:100%;min-height:48px;padding:0 14px;border:0;background:transparent;display:flex;align-items:center;justify-content:space-between;font-size:15px;font-weight:600;color:#062064">' + label
          + '<span style="color:#1170C0;font-size:20px;font-weight:500">' + (val || dft['open_' + key] ? '−' : '+') + '</span></button>'
          + (val || dft['open_' + key] ? '<div style="padding:0 14px 12px"><textarea data-notefield="' + key + '" class="note" style="min-height:64px;background:#EEF2F8;border-radius:12px;padding:10px 12px;font-size:15px">' + esc(val) + '</textarea></div>' : '') + '</div>';
      }
      h += smallLabel('NOTES') + '<section style="background:#FFFFFF;border-radius:16px;margin-bottom:12px">' + noteRow('approvalNote', 'Note for approval', true) + noteRow('shippingNote', 'Shipping note') + '</section>'
        + '<div style="padding:8px 0 10px"><button type="button" data-send-order style="height:56px;border-radius:14px;background:#1170C0;color:#FFFFFF;display:flex;align-items:center;justify-content:center;gap:7px;font-size:17px;font-weight:600;border:0;width:100%">Send for approval</button></div>';
      return h + '</div>';
    }, 'order');
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
    if (e.target.closest('[data-invoice-email]')) { invoiceEmailSheet(draft.contactId); return; }
    if ((b = e.target.closest('[data-send-order]'))) {
      if (b.disabled) return;
      b.disabled = true; b.textContent = 'Sending…';
      var d = draft;
      act('order', { contactId: d.contactId, kind: d.kind, payment: d.payment, approvalNote: d.approvalNote, shippingNote: d.shippingNote, mdName: d.mdName, mdEmail: d.mdEmail,
        lines: Object.keys(d.qty).map(function (s) { return { sku: s, qty: d.qty[s] }; }) })
        .then(function (r) { draft = null; toast(r.sentToN8n ? 'Sent for approval' : 'Saved. It goes for approval once the order connection is switched on.'); go('/orders/' + r.orderId, true); },
          function (err) { b.disabled = false; b.textContent = 'Send for approval'; toast(errText(err)); });
    }
  });
  function invoiceEmailSheet(contactId) {
    $sheet.innerHTML = '<div class="dim" data-close></div><div class="sheet"><span class="grab"></span>'
      + '<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:26px;font-weight:700;letter-spacing:-0.5px">Invoice email</span>'
      + '<button type="button" data-close style="height:34px;padding:0 14px;border-radius:17px;border:0;background:#EEF2F8;color:#062064;font-size:15px;font-weight:600">Cancel</button></div>'
      + '<div style="background:#EEF2F8;border-radius:14px"><input type="email" data-inv placeholder="accounts@clinic.ca" style="width:100%;height:50px;border:0;background:transparent;padding:0 14px;font-size:17px;outline:none"></div>'
      + '<button type="button" data-save style="height:54px;border-radius:14px;border:0;background:#1170C0;color:#FFFFFF;font-size:17px;font-weight:600">Save</button></div>';
    setTimeout(function () { var i = $sheet.querySelector('[data-inv]'); if (i) i.focus(); }, 60);
    sheetHandler = function (e, type) {
      if (type || !e.target.closest('[data-save]')) return;
      act('invoice_email', { contactId: contactId, email: $sheet.querySelector('[data-inv]').value }).then(function () { closeSheet(); screenReview(contactId); }, function (err) { toast(errText(err)); });
    };
  }

  // ---- L11 Rewards ------------------------------------------------------------------------------------------
  function screenRewards() {
    return paint(read('rewards'), function (r) {
      var h = '<div class="scr">' + LOGO
        + '<div style="display:flex;justify-content:space-between;align-items:flex-end;padding:0 4px 14px"><span style="font-size:34px;font-weight:700;letter-spacing:-0.8px">Rewards</span></div>'
        + '<section style="position:relative;background:linear-gradient(135deg,#FFD86B,#F5B21F);color:#2E2000;border-radius:22px;padding:16px;margin-bottom:10px">'
        + '<span style="font-size:13px;font-weight:700;letter-spacing:0.3px">EXTRA YOU’VE EARNED</span>'
        + '<span style="display:block;font-size:44px;font-weight:700;letter-spacing:-1.5px;line-height:1.1">' + esc(r.extra) + '</span>'
        + '<span style="font-size:14px;font-weight:600">From Renellence, on top of your regular pay</span></section>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'
        + '<div style="background:linear-gradient(135deg,#1A80D6,#1170C0);border-radius:20px;padding:14px;color:#FFFFFF"><span style="display:block;font-size:28px;font-weight:700">' + r.syringes + '</span><span style="font-size:13px;font-weight:600;opacity:0.85">saypha syringes · this month</span></div>'
        + '<div style="background:#FFFFFF;border-radius:20px;padding:14px"><span style="display:block;font-size:28px;font-weight:700">' + r.exprecell + '</span><span style="font-size:13px;font-weight:600;color:#6B7486">Exprecell boxes · this month</span></div></div>'
        + '<section style="background:#FFFFFF;border-radius:20px;padding:14px 16px;margin-bottom:10px">'
        + '<span style="display:flex;justify-content:space-between;font-size:17px;font-weight:700"><span>' + esc(r.trip.name) + '</span><span style="font-size:13px;font-weight:500;color:#6B7486">' + esc(r.trip.sub) + '</span></span>'
        + '<span style="display:block;font-size:14px;color:#1170C0;font-weight:600;margin:4px 0 6px">' + esc(r.trip.line) + '</span>'
        + r.trip.rows.map(function (x, i) {
          return '<div style="display:flex;align-items:center;gap:12px;height:44px' + (i ? ';border-top:0.5px solid #E3E6EC' : '') + '">'
            + '<span style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;' + (x.rank === 1 ? 'background:#FFC94A;color:#3D2A00' : 'background:#EEF2F8') + '">' + x.rank + '</span>'
            + '<span style="flex:1 1 auto;font-size:16px;' + (x.you ? 'font-weight:700;color:#1170C0' : 'font-weight:500') + '">' + esc(x.name) + '</span>'
            + '<span style="font-size:16px;font-weight:700">' + x.n + '</span></div>';
        }).join('') + '</section>'
        + '<section style="background:#FFFFFF;border-radius:20px;padding:14px 16px"><span style="font-size:17px;font-weight:700">' + esc(r.booster.name) + '</span>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;margin-top:8px">'
        + '<span><span style="display:block;font-size:22px;font-weight:700">' + esc(r.booster.onNew) + '</span><span style="font-size:13px;color:#6B7486">' + esc(r.booster.newText) + '</span></span>'
        + '<span><span style="display:block;font-size:22px;font-weight:700">' + esc(r.booster.onReorders) + '</span><span style="font-size:13px;color:#6B7486">' + esc(r.booster.reorderText) + '</span></span></div></section>';
      return h + '</div>';
    }, 'rewards');
  }

  // ---- L1 Reminders: turning on phone notifications -----------------------------------------------------------
  // Web push needs the person to say yes once, from a tap. On iPhone it only works once My Fifty is on the Home Screen.
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
  function localStorageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function pushPrompt() {
    var s = pushState();
    if (s === 'on' || s === 'unavailable' || s === 'denied' || localStorageGet('mf-push-hide') === ymd()) return '';
    var text = s === 'install' ? 'Add My Fifty to your Home Screen (Share → Add to Home Screen) to get reminders.' : 'Get your morning list and new leads on your phone.';
    return '<section style="margin-top:14px;background:#FFFFFF;border-radius:16px;display:flex;align-items:center;gap:12px;padding:12px 14px">'
      + '<span style="width:32px;height:32px;border-radius:9px;background:#EEF2F8;display:flex;align-items:center;justify-content:center;flex:none">' + ic('bell', 16) + '</span>'
      + '<span style="flex:1 1 auto;font-size:14px;color:#6B7486;line-height:1.3">' + text + '</span>'
      + (s === 'ask' ? '<button type="button" data-push-on style="height:34px;padding:0 12px;border-radius:17px;border:0;background:#1170C0;color:#FFFFFF;font-size:13px;font-weight:600;flex:none">Turn on</button>'
        : '<button type="button" data-push-hide style="height:34px;padding:0 12px;border-radius:17px;border:0;background:#EEF2F8;color:#062064;font-size:13px;font-weight:600;flex:none">OK</button>')
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
      + '<img src="/logo.png" alt="Renellence" style="height:22px;width:auto">'
      + '<span style="font-size:34px;font-weight:700;letter-spacing:-0.8px">My Fifty</span>'
      + (message ? '<span style="font-size:15px;color:#6B7486;max-width:300px;line-height:1.4">' + esc(message) + '</span>' : '')
      + '<button type="button" data-signin style="height:54px;width:100%;max-width:340px;border-radius:14px;border:0;background:#1170C0;color:#FFFFFF;font-size:17px;font-weight:600">Sign in with Google</button>'
      + '<span style="font-size:13px;color:#6B7486">Use your @renellence.com account.</span></div>';
  }
  $app.addEventListener('click', function (e) { if (e.target.closest('[data-signin]')) signIn(location.pathname); });

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
      if (e && (e.message === 'not_set_up' || e.message === 'not_renellence')) { signInMessage = errText(e); sb.auth.signOut().catch(function () {}); return showSignIn(); }
      $app.innerHTML = failed(e);
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
  start();
})();
