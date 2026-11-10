// ─────────────────────────────────────────────────────────────
// Director — runs the story: the gate, chapter travel, the narrator,
// the witness ledger, and all pointer / keyboard / touch input.
// The 3D world is loaded separately so the story still works if
// WebGL (or the CDN) is unavailable.
// ─────────────────────────────────────────────────────────────
import { Sound } from './audio.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer:coarse)').matches;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad2 = n => String(n).padStart(2, '0');

const sound = new Sound();
const NOOP = new Proxy({}, { get: (_, k) => (k === 'proximity' || k === 'litCount' ? () => 0 : k === 'torchDim' ? () => 1 : () => false) });
let world = NOOP;

const panels = $$('.panel');
const TOTAL = panels.length;
const chapters = panels.map(p => ({ el: p, inner: $('.panel-inner', p), num: p.dataset.num, title: p.dataset.title, nav: p.dataset.nav, caption: p.dataset.caption }));
const WORKS = panels.findIndex(p => p.id === 'p2');

let current = 0, started = false, navToken = 0, lockUntil = 0;
const mouse = { x: 0, y: 0 };
const seen = new Set();

// ── HUD wiring ──────────────────────────────────
const nav = $('#nav');
chapters.forEach((c, i) => {
  const d = document.createElement('div');
  d.className = 'dot'; d.dataset.label = c.nav; d.dataset.cursor = '';
  d.tabIndex = 0; d.setAttribute('role', 'button'); d.setAttribute('aria-label', `${c.num}: ${c.title}`);
  d.innerHTML = '<i></i>';
  d.addEventListener('click', () => goTo(i));
  d.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(i); } });
  nav.appendChild(d);
});
const navDots = $$('.dot', nav);
const progFill = $('#prog .fill'), counterCur = $('#counter .cur'), counterSec = $('#counter .sec'), counterTot = $('#counter .tot');
const ringFill = $('#counter .fill-c');
const RING_C = 2 * Math.PI * 23;
ringFill.style.strokeDasharray = RING_C;
ringFill.style.strokeDashoffset = RING_C;
const hint = $('#hint'), card = $('#card'), captionEl = $('#caption');
if (coarse) $('.hint-t').textContent = 'Swipe to walk';

function updateHUD(n) {
  navDots.forEach((d, i) => {
    d.classList.toggle('on', i === n);
    d.classList.toggle('seen', seen.has(i));
    d.setAttribute('aria-current', i === n ? 'true' : 'false');
  });
  const frac = n / (TOTAL - 1);
  progFill.style.width = frac * 100 + '%';
  ringFill.style.strokeDashoffset = RING_C * (1 - frac);
  counterCur.textContent = pad2(n + 1);
  counterSec.textContent = chapters[n].title;
  counterTot.textContent = `${pad2(n + 1)} / ${pad2(TOTAL)}`;
  hint.classList.toggle('on', n === 0);
}

// ── Rotating "now" line ─────────────────────────
(() => {
  const el = $('#rot');
  const phrases = ['multi-agent orchestration', 'RAG retrieval pipelines', 'MCP tool integrations', 'LLM evaluation harnesses', 'agentic systems at scale'];
  if (reduce) return;
  let pi = 0, ci = phrases[0].length, deleting = true;
  const tick = () => {
    const word = phrases[pi];
    ci += deleting ? -1 : 1;
    el.textContent = word.slice(0, ci);
    let delay = deleting ? 38 : 70;
    if (!deleting && ci === word.length) { deleting = true; delay = 1800; }
    else if (deleting && ci === 0) { deleting = false; pi = (pi + 1) % phrases.length; delay = 320; }
    setTimeout(tick, delay);
  };
  setTimeout(tick, 5200);
})();

// ── Text effects ────────────────────────────────
const SCRAM = '█▓▒░<>/\\|=+*·';
function scramble(el, finalText) {
  if (!el) return;
  const orig = finalText ?? (el.dataset.txt || (el.dataset.txt = el.textContent));
  if (reduce) { el.textContent = orig; return; }
  clearInterval(el._siv);
  let f = 0; const total = 14;
  el._siv = setInterval(() => {
    f++;
    el.textContent = orig.split('').map((c, i) => c === ' ' ? ' ' : (i < (f / total) * orig.length ? c : SCRAM[Math.floor(Math.random() * SCRAM.length)])).join('');
    if (f >= total) { el.textContent = orig; clearInterval(el._siv); }
  }, 34);
}

let narrToken = 0;
function narrate(text) {
  const token = ++narrToken;
  if (reduce) { captionEl.textContent = text; return; }
  captionEl.innerHTML = '<span></span><i class="caret"></i>';
  const span = captionEl.firstChild;
  let i = 0;
  const step = () => {
    if (token !== narrToken) return;
    i++;
    span.textContent = text.slice(0, i);
    if (i % 2 === 0 && text[i - 1] !== ' ') sound.type();
    if (i < text.length) setTimeout(step, /[,.—:]/.test(text[i - 1]) ? 170 : 24);
    else setTimeout(() => { if (token === narrToken) captionEl.querySelector('.caret')?.remove(); }, 1600);
  };
  setTimeout(step, 250);
}

function countUp(panel) {
  $$('[data-count]', panel).forEach(el => {
    const to = +el.dataset.count, suf = el.dataset.suffix || '';
    if (reduce) { el.textContent = to + suf; return; }
    const t0 = performance.now() + 500, dur = 1300;
    const tick = now => {
      const p = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * e) + suf;
      if (p < 1) requestAnimationFrame(tick);
    };
    el.textContent = '0' + suf;
    requestAnimationFrame(tick);
  });
}

// ── Witness: a hash-chained ledger of the visitor's own walk ──
const trail = [];
let chain = Promise.resolve('0'.repeat(64));
async function sha256(str) {
  if (crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // insecure-context fallback (plain http): FNV-1a, widened — illustrative only
  let h = 0x811c9dc5, out = '';
  for (let r = 0; r < 8; r++) { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i) + r; h = Math.imul(h, 0x01000193); } out += (h >>> 0).toString(16).padStart(8, '0'); }
  return out;
}
function witness(n) {
  const entry = { n: trail.length + 1, title: chapters[n].title, verb: seen.has(n) ? 'returned to' : 'entered', at: new Date().toISOString(), hash: '' };
  trail.push(entry);
  chain = chain.then(async prev => {
    entry.hash = await sha256(`${prev}|${entry.n}|${entry.verb} ${entry.title}|${entry.at}`);
    renderWitness();
    return entry.hash;
  });
}
function renderWitness() {
  const head = trail[trail.length - 1];
  if (!head?.hash) return;
  $('#w-n').textContent = pad2(head.n);
  scramble($('#w-hash'), head.hash.slice(0, 8));
  $('#root-hash').textContent = `${head.hash.slice(0, 16)}…${head.hash.slice(-8)}`;
  $('#root-n').textContent = head.n;
  $('#mail').href = `mailto:edwinisac007@gmail.com?subject=${encodeURIComponent(`Hello from the corridor — witness ${head.hash.slice(0, 8)}`)}`;
  $('#ledger-list').innerHTML = trail.slice(-14).map(e =>
    `<li><span class="ln">#${pad2(e.n)}</span><span class="lt">${e.verb} ${e.title}</span><span class="lh">${e.hash.slice(0, 12)}</span></li>`).join('');
}

// ── Works: each project re-shapes the hologram ──
const projs = $$('.proj');
let projTimer = null, projIdx = 0, projHover = false;
function focusProj(i, tell) {
  projIdx = i;
  projs.forEach((p, j) => p.classList.toggle('lit', j === i));
  world.setShape(projs[i].dataset.emblem);
  if (tell) narrate(projs[i].dataset.story);
}
function startProjCycle() {
  stopProjCycle();
  focusProj(0, false);
  projTimer = setInterval(() => { if (!projHover) focusProj((projIdx + 1) % projs.length, coarse); }, 5200);
}
function stopProjCycle() { clearInterval(projTimer); projTimer = null; projs.forEach(p => p.classList.remove('lit')); }
projs.forEach((p, i) => {
  p.addEventListener('mouseenter', () => { projHover = true; if (current === WORKS) focusProj(i, true); });
  p.addEventListener('mouseleave', () => { projHover = false; });
  p.addEventListener('focus', () => { if (current === WORKS) focusProj(i, true); });
});

// ── Travel between chapters ─────────────────────
function arrive(n) {
  panels.forEach((p, i) => p.classList.toggle('on', i === n));
  chapters[n].inner.scrollTop = 0;
  scramble($('.eyebrow, .pre', panels[n]));
  narrate(chapters[n].caption);
  witness(n);
  seen.add(n);
  updateHUD(n);
  if (world.ignite(n)) { sound.ignite(-0.6); sound.ignite(0.6, 0.16); }
  sound.setFire(world.litCount(), world.torchDim());
  sound.chime(n);
  if (n === 1 && !arrive.counted) { arrive.counted = true; countUp(panels[n]); }
  if (n === WORKS) startProjCycle(); else stopProjCycle();
}

function goTo(n) {
  if (!started) return;
  n = clamp(n, 0, TOTAL - 1);
  if (n === current) return;
  const dist = Math.abs(n - current);
  current = n;
  const token = ++navToken;
  const travel = reduce ? 0 : Math.min(1750, 1050 + dist * 180);
  lockUntil = performance.now() + travel + 200;
  stopProjCycle();
  world.setChapter(n);
  sound.travel(n, dist, travel / 1000);
  updateHUD(n);
  if (reduce) { arrive(n); return; }
  panels.forEach(p => p.classList.remove('on'));
  document.body.classList.add('travel');
  $('.c-num', card).textContent = chapters[n].num;
  $('.c-title', card).textContent = chapters[n].title;
  card.classList.remove('show'); void card.offsetWidth; card.classList.add('show');
  setTimeout(() => {
    if (token !== navToken) return;
    card.classList.remove('show');
    document.body.classList.remove('travel');
    arrive(n);
  }, travel);
}

// ── Input ───────────────────────────────────────
const overlays = $$('.overlay');
const anyOverlay = () => overlays.some(o => o.classList.contains('on'));
const toggle = (id, force) => { const o = $(id); const on = o.classList.toggle('on', force); overlays.forEach(x => { if (x !== o) x.classList.remove('on'); }); if (on) sound.blip(); };
overlays.forEach(o => o.addEventListener('click', e => { if (e.target === o) o.classList.remove('on'); }));
$('#kbd-btn').addEventListener('click', () => toggle('#shortcuts'));
$('#witness').addEventListener('click', () => toggle('#ledger'));
$('#witnessed').addEventListener('click', () => toggle('#ledger'));
$('#logo').addEventListener('click', e => { e.preventDefault(); goTo(0); });

// a panel taller than the screen scrolls internally before the walk continues
function innerCanScroll(dir) {
  const el = chapters[current].inner;
  if (el.scrollHeight <= el.clientHeight + 4) return false;
  return dir > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 4 : el.scrollTop > 4;
}
window.addEventListener('wheel', e => {
  if (anyOverlay()) return;
  e.preventDefault();
  if (!started || Math.abs(e.deltaY) < 4) return;
  const dir = Math.sign(e.deltaY);
  if (innerCanScroll(dir)) { chapters[current].inner.scrollTop += e.deltaY; lockUntil = performance.now() + 350; return; }
  if (performance.now() < lockUntil) return;
  goTo(current + dir);
}, { passive: false });

let touch = null;
window.addEventListener('touchstart', e => {
  const t = e.touches[0];
  touch = { y: t.clientY, x: t.clientX, up: innerCanScroll(-1), down: innerCanScroll(1) };
  world.setMouse((t.clientX / innerWidth) * 2 - 1, -(t.clientY / innerHeight) * 2 + 1);
}, { passive: true });
window.addEventListener('touchend', e => {
  if (!touch || anyOverlay()) return;
  const dy = touch.y - e.changedTouches[0].clientY, dx = touch.x - e.changedTouches[0].clientX;
  if (Math.abs(dy) > 44 && Math.abs(dy) > Math.abs(dx)) {
    const dir = Math.sign(dy);
    if (!(dir > 0 ? touch.down : touch.up) && performance.now() > lockUntil) goTo(current + dir);
  }
  touch = null;
});

window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!started) return;
  if (e.key === '?') { e.preventDefault(); toggle('#shortcuts'); return; }
  if (e.key === 'Escape') { overlays.forEach(o => o.classList.remove('on')); return; }
  if (e.key === 'w' || e.key === 'W') { toggle('#ledger'); return; }
  if (e.key === 'm' || e.key === 'M') { toggleSound(); return; }
  if (anyOverlay()) return;
  const onControl = e.target.closest?.('a,button,[role="button"]');
  if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j' || (e.key === ' ' && !onControl)) { e.preventDefault(); goTo(current + 1); }
  else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') { e.preventDefault(); goTo(current - 1); }
  else if (e.key === 'Home') goTo(0);
  else if (e.key === 'End') goTo(TOTAL - 1);
  else if (e.key >= '1' && e.key <= String(TOTAL)) goTo(parseInt(e.key) - 1);
});

document.addEventListener('mousemove', e => {
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;
  world.setMouse(mouse.x, mouse.y);
});

// drag to look around (desktop) / tilt to look around (phones)
const INTERACTIVE = 'a,button,.proj,.btn,.pill,#nav,.overlay,#top,#gate';
let drag = null, suppressClick = false;
if (!coarse && !reduce) {
  window.addEventListener('pointerdown', e => {
    if (e.target.closest(INTERACTIVE)) return;
    drag = { x: e.clientX, y: e.clientY, moved: false };
    document.body.classList.add('dragging');
  });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
    world.setLook(clamp(dx * 0.0032, -0.9, 0.9), clamp(dy * 0.0022, -0.5, 0.5));
  });
  const end = () => {
    if (!drag) return;
    suppressClick = drag.moved; drag = null;
    world.setLook(0, 0);
    document.body.classList.remove('dragging');
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('blur', end);
}
function enableGyro() {
  if (!coarse || reduce || typeof DeviceOrientationEvent === 'undefined') return;
  let base = null;
  const on = e => {
    if (e.beta == null) return;
    if (base === null) base = e.beta;
    world.setLook(clamp((e.gamma || 0) / 45, -1, 1) * 0.35, clamp((e.beta - base) / 45, -1, 1) * 0.25);
  };
  // iOS needs an explicit grant from inside a gesture — the gate button is that gesture
  if (DeviceOrientationEvent.requestPermission) DeviceOrientationEvent.requestPermission().then(s => { if (s === 'granted') addEventListener('deviceorientation', on); }).catch(() => {});
  else addEventListener('deviceorientation', on);
}

window.addEventListener('click', e => {
  if (suppressClick) { suppressClick = false; return; }
  if (!started || e.target.closest(INTERACTIVE)) return;
  world.burst(e.clientX, e.clientY);
  sound.blip();
});

// cursor, magnetic buttons, tilting cards, hover ticks
$$('a,button,[data-cursor],.pill').forEach(el => el.addEventListener('mouseenter', () => sound.tick()));
if (!coarse) {
  const cdot = $('#cdot'), cring = $('#cring');
  let rx = innerWidth / 2, ry = innerHeight / 2, mx = rx, my = ry;
  window.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; cdot.style.transform = `translate(${mx}px,${my}px) translate(-50%,-50%)`; });
  (function ringLoop() {
    rx += (mx - rx) * 0.18; ry += (my - ry) * 0.18;
    cring.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`;
    if (!reduce) chapters[current].inner.style.transform = `translate3d(${-mouse.x * 8}px,${mouse.y * 6}px,0)`;
    requestAnimationFrame(ringLoop);
  })();
  document.addEventListener('mouseover', e => cring.classList.toggle('hot', !!e.target.closest('a,button,[data-cursor],.pill')));
  $$('.btn').forEach(el => {
    el.addEventListener('mousemove', e => {
      const r = el.getBoundingClientRect();
      el.style.transform = `translate(${(e.clientX - (r.left + r.width / 2)) * 0.3}px,${(e.clientY - (r.top + r.height / 2)) * 0.3}px)`;
    });
    el.addEventListener('mouseleave', () => { el.style.transform = ''; });
  });
  projs.forEach(el => {
    el.addEventListener('mousemove', e => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
      if (!reduce) el.style.transform = `perspective(700px) rotateX(${(-py * 5).toFixed(2)}deg) rotateY(${(px * 6).toFixed(2)}deg)`;
      el.style.setProperty('--mx', e.clientX - r.left + 'px');
      el.style.setProperty('--my', e.clientY - r.top + 'px');
    });
    el.addEventListener('mouseleave', () => { el.style.transform = ''; });
  });
}

// ── Sound toggle ────────────────────────────────
const sndBtn = $('#snd-btn');
function syncSound() { sndBtn.setAttribute('aria-pressed', String(!!sound.ctx && !sound.muted)); }
function toggleSound() {
  if (!sound.ctx) { sound.start(); sound.setChapter(current); sound.setFire(world.litCount(), world.torchDim()); }
  else sound.setMuted(!sound.muted);
  syncSound();
}
sndBtn.addEventListener('click', toggleSound);

// feed the music back into the picture, and the picture into the music
(function link() {
  world.setLevel(sound.level());
  sound.setProximity(world.proximity());
  requestAnimationFrame(link);
})();

// tell the world where each chapter's text sits so the hologram can take the free side
function measure() {
  const W = innerWidth;
  chapters.forEach((c, i) => {
    c.inner.classList.remove('scrolls');
    c.inner.classList.toggle('scrolls', c.inner.scrollHeight > c.inner.clientHeight + 4);
    const side = c.el.dataset.side;
    if (!side) return;
    const prev = c.inner.style.transform; c.inner.style.transform = '';
    const r = c.inner.getBoundingClientRect();
    c.inner.style.transform = prev;
    const from = side === 'r' ? r.right + 20 : 40, to = side === 'r' ? W - 70 : r.left - 20;
    const free = to - from;
    world.setLayout(i, { narrow: free < 250, ndc: ((from + to) / 2 / W) * 2 - 1, width: free / (W / 2) });
  });
}
window.addEventListener('resize', measure);

// ── Gate → begin ────────────────────────────────
const gate = $('#gate');
const loaded = import('./world.js')
  .then(m => { world = m.createWorld($('#bg'), { reduce, coarse }); measure();
    if (document.body.classList.contains('ready')) { world.begin(); world.setChapter(current, { warp: false }); for (const i of seen) world.ignite(i); } document.fonts?.ready.then(measure); })
  .catch(err => { console.warn('3D world unavailable, continuing without it:', err); document.body.classList.add('no-webgl'); });
Promise.race([loaded, new Promise(r => setTimeout(r, 9000))]).then(() => setTimeout(() => gate.classList.add('open'), 500));

function enter(withSound) {
  if (started) return;
  if (withSound) { sound.start(); sound.open(); }
  syncSound();
  enableGyro();
  gate.classList.add('gone');
  document.body.classList.add('ready');
  world.begin();
  world.setChapter(0, { warp: false });
  updateHUD(0);
  // hold the headline until the camera has pushed in through the first arch
  setTimeout(() => { started = true; arrive(0); }, reduce ? 0 : 1700);
}
$('#enter-sound').addEventListener('click', () => enter(true));
$('#enter-quiet').addEventListener('click', () => enter(false));
