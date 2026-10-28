/* Avatar motion PROTOTYPE (owner 2026-10-28). Turns on html.av-motion (avatar-motion.css) unless the page was opened
   with ?motion=off (remembered on this phone; ?motion=on brings it back) or Reduce Motion is on. Gives each avatar its
   own timing, animates only avatars on screen, pauses while scrolling, and plays the touch moves:
   tap = bounce + wink + the character's signature move; press and hold = squish; after a log = that person nods;
   a person card plays its signature once when it opens; now and then one visible avatar plays its move on its own.
   To remove: delete the two avatar-motion lines in index.html. */
(function () {
  'use strict';
  var root = document.documentElement;
  try {
    var q = new URLSearchParams(location.search).get('motion');
    if (q === 'off' || q === 'on') localStorage.setItem('pulse-motion', q);
    if (localStorage.getItem('pulse-motion') === 'off') return;
  } catch (e) { /* private mode: on */ }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.classList.add('av-motion');

  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { e.target.classList.toggle('av-on', e.isIntersecting); });
  }, { rootMargin: '40px' }) : null;
  var nodId = null;

  function play(el, cls, ms) {
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms);
  }
  function setup(el) {
    if (el.__avm) return;
    el.__avm = true;
    el.style.setProperty('--av-d', '-' + rnd(0, 6).toFixed(2) + 's');   // a negative delay: each starts at a different point
    el.style.setProperty('--av-b', rnd(4, 7).toFixed(2) + 's');
    el.style.setProperty('--av-l', rnd(9, 15).toFixed(2) + 's');
    if (io) io.observe(el); else el.classList.add('av-on');
    // A person's page: they wave hello with a real hand (owner 2026-10-28: "I said they're waving, you just made them
    // shake"). The avatars have no arm, so one is added in the person's own skin and sleeve colours.
    if (el.classList.contains('st-cold') && !el.classList.contains('st-thawed')) addSnow(el);
    // Moods (owner 2026-10-28; api/data.js moodOf): coins after an order, the sun after a cold account orders again,
    // a sleeping lead, and a pen for someone waiting on a signature.
    if (el.classList.contains('st-thawed')) once(el, 'thaw', 3 * 864e5, function () { addSun(el); setTimeout(function () { play(el, 'av-thaw', 3200); }, 350); });
    else if (el.classList.contains('st-ordered')) once(el, 'coins', 3 * 864e5, function () { coins(el); });
    if (el.classList.contains('st-asleep')) { addZzz(el); if (el.classList.contains('card')) setTimeout(function () { wake(el); }, 1100); }
    if (el.classList.contains('st-wait')) addPen(el);
    if (el.classList.contains('card')) { addHand(el); setTimeout(function () { play(el, 'av-wave', 2700); }, 450); }
    if (nodId && el.getAttribute('data-pid') === nodId) setTimeout(function () { play(el, 'av-nod', 1600); }, 300);
    if (el.classList.contains('jump')) confetti(el);
  }
  // An arm and an open hand by the head's right side (64-unit drawing), hidden until .av-wave plays.
  function addHand(el) {
    var svg = el.querySelector('svg');
    if (!svg || svg.querySelector('.av-hand')) return;
    var head = svg.querySelector('.av-head circle'), shirt = svg.querySelector('.av-body path');
    var skin = (head && head.getAttribute('fill')) || '#EEF2F8', sleeve = (shirt && shirt.getAttribute('fill')) || '#5B6884';
    // Inside the avatar's own circle (its clipPath), so the arm never shows outside the frame (owner 2026-10-28).
    var ns = 'http://www.w3.org/2000/svg', clip = svg.querySelector('clipPath'), wrap = document.createElementNS(ns, 'g'), g = document.createElementNS(ns, 'g');
    if (clip && clip.id) wrap.setAttribute('clip-path', 'url(#' + clip.id + ')');
    g.setAttribute('class', 'av-hand');
    // The sleeve grows out of the shoulder (owner 2026-10-28: "the hand looks detached"): it is the shirt's colour and
    // starts inside the shirt, so it blends in; only the part above the shoulder line has the dark outline.
    g.innerHTML = '<path d="M45.6 50L46.6 43.5" stroke="#0B1530" stroke-width="7.6" stroke-linecap="round"/>'
      + '<path d="M44.2 60L46.6 43.5" stroke="' + sleeve + '" stroke-width="4.8" stroke-linecap="round"/>'
      + '<path transform="translate(-4 0.5)" d="M47.2 42.5v-6.8a1.5 1.5 0 0 1 3 0v-1.6a1.5 1.5 0 0 1 3 0v1.2a1.5 1.5 0 0 1 3 0v6.4c0 3.6-2.2 5.8-5.2 5.8s-4.8-1.8-5.6-3.6l-1.6-3.4a1.4 1.4 0 0 1 2.4-1.4z"'
      + ' fill="' + skin + '" stroke="#0B1530" stroke-width="1.6" stroke-linejoin="round"/>';
    wrap.appendChild(g);
    svg.appendChild(wrap);
  }
  // Going cold: it snows inside their circle, behind the head (owner 2026-10-28: "snowing in their frame and they're
  // shivering"). Each flake has its own speed, drift and start, so it never looks like a loop.
  function addSnow(el) {
    var svg = el.querySelector('svg');
    if (!svg || svg.querySelector('.av-snow')) return;
    var ns = 'http://www.w3.org/2000/svg', clip = svg.querySelector('clipPath'), g = document.createElementNS(ns, 'g');
    if (clip && clip.id) g.setAttribute('clip-path', 'url(#' + clip.id + ')');
    g.setAttribute('class', 'av-snow');
    var html = '';
    for (var i = 0; i < 11; i++) {
      html += '<circle cx="' + rnd(4, 60).toFixed(1) + '" cy="-4" r="' + rnd(0.7, 1.6).toFixed(2) + '" fill="#FFFFFF" style="--sd:'
        + rnd(2.6, 4.6).toFixed(2) + 's;--sdl:-' + rnd(0, 4.6).toFixed(2) + 's;--sx:' + rnd(-5, 5).toFixed(1) + 'px"/>';
    }
    g.innerHTML = html;
    var head = svg.querySelector('.av-head');
    if (head) svg.insertBefore(g, head); else svg.appendChild(g);
  }
  // A moment that should play once per person on this phone for a while (e.g. coins only the first time you see them
  // after an order). Remembered in localStorage; plays every time in private mode.
  function once(el, what, ms, fn) {
    var id = el.getAttribute('data-pid'), k = 'pulse-av-' + what + '-' + id;
    try { var at = Number(localStorage.getItem(k) || 0); if (id && Date.now() - at < ms) return; localStorage.setItem(k, String(Date.now())); } catch (e) { /* private mode */ }
    setTimeout(fn, 300);
  }
  function layer(el, cls, before) {
    var svg = el.querySelector('svg');
    if (!svg || svg.querySelector('.' + cls)) return null;
    var ns = 'http://www.w3.org/2000/svg', clip = svg.querySelector('clipPath'), g = document.createElementNS(ns, 'g');
    if (clip && clip.id) g.setAttribute('clip-path', 'url(#' + clip.id + ')');
    g.setAttribute('class', cls);
    var head = before && svg.querySelector('.av-head');
    if (head) svg.insertBefore(g, head); else svg.appendChild(g);
    return g;
  }
  // 1. After an order: gold coins rain through the circle, once.
  function coins(el) {
    var g = layer(el, 'av-coins', false);
    if (!g) return;
    var html = '';
    for (var i = 0; i < 9; i++) {
      html += '<g style="--cx:' + rnd(8, 56).toFixed(1) + 'px;--cd:' + rnd(0, 0.9).toFixed(2) + 's;--cr:' + Math.round(rnd(-200, 200)) + 'deg">'
        + '<circle cx="0" cy="0" r="4.2" fill="#F7C948" stroke="#8A5A00" stroke-width="1.2"/><circle cx="0" cy="0" r="2.4" fill="none" stroke="#FFF1B8" stroke-width="0.9"/></g>';
    }
    g.innerHTML = html;
    el.classList.add('av-rich');
    setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); el.classList.remove('av-rich'); }, 2800);
  }
  // 2. Back from cold: a sun rises in the corner and shines while they jump; the cold tint lifts.
  function addSun(el) {
    var g = layer(el, 'av-sun', true);
    if (!g) return;
    var rays = '';
    for (var a = 0; a < 360; a += 45) rays += '<path d="M0 -10.5V-14" transform="rotate(' + a + ')" stroke="#FFD447" stroke-width="2.2" stroke-linecap="round"/>';
    g.innerHTML = '<g class="av-sun-in" transform="translate(50 13)"><g class="av-rays">' + rays + '</g><circle r="7.5" fill="#FFD447" stroke="#E08A00" stroke-width="1.4"/></g>';
    setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 3600);
  }
  // 4. Asleep: eyes shut and Zzz floating up; opening their page wakes them with a jolt.
  function addZzz(el) {
    var g = layer(el, 'av-zzz', false);
    if (!g) return;
    g.innerHTML = [0, 1, 2].map(function (i) {
      return '<text x="44" y="22" font-family="system-ui,sans-serif" font-weight="800" font-size="' + (8.5 + i * 2) + '" fill="#FFFFFF" stroke="#0B1530" stroke-width="0.6" style="--zd:' + (i * 0.9) + 's">Z</text>';
    }).join('');
  }
  function wake(el) {
    el.classList.add('av-woke');
    play(el, 'av-jolt', 700);
  }
  // 7. Waiting on a signature: they hold up a pen and tap it now and then.
  function addPen(el) {
    var svg = el.querySelector('svg');
    if (!svg || svg.querySelector('.av-pen')) return;
    var head = svg.querySelector('.av-head circle'), shirt = svg.querySelector('.av-body path');
    var skin = (head && head.getAttribute('fill')) || '#EEF2F8', sleeve = (shirt && shirt.getAttribute('fill')) || '#5B6884';
    var g = layer(el, 'av-pen', false);
    if (!g) return;
    g.innerHTML = '<path d="M45.6 50L46.6 43.5" stroke="#0B1530" stroke-width="7.6" stroke-linecap="round"/>'
      + '<path d="M44.2 60L46.6 43.5" stroke="' + sleeve + '" stroke-width="4.8" stroke-linecap="round"/>'
      + '<g class="av-pen-tip"><path d="M47.5 40.5L54.5 26.5" stroke="#0B1530" stroke-width="4.2" stroke-linecap="round"/>'
      + '<path d="M47.5 40.5L54.5 26.5" stroke="#62B2F7" stroke-width="2.2" stroke-linecap="round"/><path d="M54.5 26.5l1.2-2.5" stroke="#0B1530" stroke-width="1.6" stroke-linecap="round"/></g>'
      + '<circle cx="47" cy="41.5" r="4.3" fill="' + skin + '" stroke="#0B1530" stroke-width="1.6"/>';
  }
  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.classList && node.classList.contains('av')) setup(node);
    var list = node.querySelectorAll ? node.querySelectorAll('.av') : [];
    for (var i = 0; i < list.length; i++) setup(list[i]);
  }
  new MutationObserver(function (ms) {
    ms.forEach(function (m) { for (var i = 0; i < m.addedNodes.length; i++) scan(m.addedNodes[i]); });
  }).observe(document.body || root, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', function () { scan(document.body); });

  // Confetti for the person who joined your Fifty.
  function confetti(el) {
    var host = el.parentNode, colors = ['#F7C948', '#62B2F7', '#F28AC0', '#62D49E', '#FFFFFF', '#B39CFF'];
    for (var i = 0; i < 26; i++) {
      var c = document.createElement('span'), a = rnd(0, Math.PI * 2), d = rnd(70, 170);
      c.className = 'av-confetti';
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--cx', 'calc(-50% + ' + Math.round(Math.cos(a) * d) + 'px)');
      c.style.setProperty('--cy', 'calc(-50% + ' + Math.round(Math.sin(a) * d - 40) + 'px)');
      c.style.setProperty('--cr', Math.round(rnd(-360, 360)) + 'deg');
      c.style.animationDelay = (0.25 + rnd(0, 0.35)).toFixed(2) + 's';
      host.appendChild(c);
      setTimeout(function (n) { return function () { if (n.parentNode) n.parentNode.removeChild(n); }; }(c), 2400);
    }
  }

  // Touch: tap = bounce + wink + signature; press and hold = squish.
  var hold = null;
  document.addEventListener('pointerdown', function (e) {
    var el = e.target.closest && e.target.closest('.av, [data-avtap]');
    if (el && !el.classList.contains('av')) el = el.querySelector('.av');
    if (!el) return;
    play(el, 'av-tap', 450);
    play(el, 'av-sig', 1000);
    clearTimeout(hold);
    hold = setTimeout(function () { el.classList.add('av-squish'); }, 380);
    var up = function () { clearTimeout(hold); el.classList.remove('av-squish'); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); };
    document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
  }, { passive: true });

  // After a log (app.js afterLog): that person's avatar nods wherever it shows next.
  document.addEventListener('pulse:logged', function (e) {
    nodId = e.detail && e.detail.id;
    var now = nodId && document.querySelectorAll('.av[data-pid="' + nodId + '"]');
    for (var i = 0; now && i < now.length; i++) play(now[i], 'av-nod', 1600);
    setTimeout(function () { nodId = null; }, 6000);
  });

  // Now and then (every 12-25 s), one avatar on screen plays its signature move.
  (function idle() {
    setTimeout(function () {
      if (!document.hidden && !root.classList.contains('av-scrolling')) {
        var on = document.querySelectorAll('.av.av-on');
        if (on.length) play(on[Math.floor(Math.random() * on.length)], 'av-sig', 1000);
      }
      idle();
    }, rnd(12000, 25000));
  })();

  // Pause while scrolling.
  var st = null;
  window.addEventListener('scroll', function () {
    root.classList.add('av-scrolling');
    clearTimeout(st);
    st = setTimeout(function () { root.classList.remove('av-scrolling'); }, 160);
  }, { passive: true });
})();
