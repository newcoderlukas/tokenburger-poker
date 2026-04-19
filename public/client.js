// ============================================================
// Tokenburger Kameraden Poker — Client (animated & polished)
// ============================================================

// --- Persistent player id for reconnect ---
let persistentId = localStorage.getItem('tk_pid');
if (!persistentId) {
  persistentId = 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  localStorage.setItem('tk_pid', persistentId);
}

const socket = io({ auth: { persistentId } });

// --- DOM helpers ---
const $ = (id) => document.getElementById(id);
const el = (tag, opts = {}) => {
  const e = document.createElement(tag);
  if (opts.class) e.className = opts.class;
  if (opts.text !== undefined) e.textContent = opts.text;
  if (opts.html !== undefined) e.innerHTML = opts.html;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) e.setAttribute(k, v);
  return e;
};

// --- State ---
let state = null;                 // last gameState payload
let prevState = null;             // previous state for diffs (animations)
let myName = localStorage.getItem('tk_name') || '';
let soundEnabled = localStorage.getItem('tk_sound') !== 'off';
let lastRoomCode = localStorage.getItem('tk_room') || null;
let myRoom = null;

// --- Initial: restore name ---
$('input-name').value = myName;

// ============================================================
// Screen navigation
// ============================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

// ============================================================
// Tabs on login
// ============================================================
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// ============================================================
// Toast
// ============================================================
let toastTimer = null;
function toast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}

// ============================================================
// Sound manager (WebAudio - procedural, no external files)
// ============================================================
let audioCtx = null;
function getCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function playTone({ freq = 440, dur = 0.15, type = 'sine', vol = 0.2, slide = 0 }) {
  if (!soundEnabled) return;
  const ctx = getCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), ctx.currentTime + dur);
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(); osc.stop(ctx.currentTime + dur + 0.02);
}
const sounds = {
  deal:   () => playTone({ freq: 800, dur: 0.05, type: 'square', vol: 0.08 }),
  chip:   () => { playTone({ freq: 520, dur: 0.08, type: 'triangle', vol: 0.12 }); setTimeout(() => playTone({ freq: 720, dur: 0.06, type: 'triangle', vol: 0.1 }), 40); },
  check:  () => playTone({ freq: 300, dur: 0.08, type: 'sine', vol: 0.1 }),
  fold:   () => playTone({ freq: 200, dur: 0.18, type: 'sawtooth', vol: 0.09, slide: -80 }),
  turn:   () => { playTone({ freq: 660, dur: 0.09, type: 'sine', vol: 0.12 }); setTimeout(() => playTone({ freq: 990, dur: 0.09, type: 'sine', vol: 0.1 }), 90); },
  win:    () => {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => setTimeout(() => playTone({ freq: f, dur: 0.2, type: 'triangle', vol: 0.18 }), i * 90));
  },
  allin:  () => {
    [420, 560, 700, 840].forEach((f, i) => setTimeout(() => playTone({ freq: f, dur: 0.12, type: 'sawtooth', vol: 0.14 }), i * 60));
  },
  flip:   () => playTone({ freq: 600, dur: 0.06, type: 'square', vol: 0.08, slide: 200 }),
};

$('btn-sound').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem('tk_sound', soundEnabled ? 'on' : 'off');
  $('btn-sound').textContent = soundEnabled ? '🔊' : '🔇';
  toast(soundEnabled ? 'Sound AN' : 'Sound aus');
  if (soundEnabled) sounds.check();
});
$('btn-sound').textContent = soundEnabled ? '🔊' : '🔇';

// ============================================================
// Background ambient particles
// ============================================================
(function initBgParticles() {
  const c = $('bg-particles');
  if (!c) return;
  const ctx = c.getContext('2d');
  const resize = () => { c.width = window.innerWidth; c.height = window.innerHeight; };
  resize();
  window.addEventListener('resize', resize);

  const COLORS = ['rgba(244,196,48,', 'rgba(124,92,255,', 'rgba(38,222,129,', 'rgba(255,61,127,'];
  const particles = Array.from({ length: 42 }, () => ({
    x: Math.random() * c.width,
    y: Math.random() * c.height,
    vx: (Math.random() - 0.5) * 0.2,
    vy: (Math.random() - 0.5) * 0.2 - 0.05,
    r: Math.random() * 2 + 0.5,
    a: Math.random() * 0.35 + 0.15,
    col: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));

  function loop() {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < -5) p.x = c.width + 5;
      if (p.x > c.width + 5) p.x = -5;
      if (p.y < -5) p.y = c.height + 5;
      if (p.y > c.height + 5) p.y = -5;
      ctx.beginPath();
      ctx.fillStyle = p.col + p.a + ')';
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(loop);
  }
  loop();
})();

// ============================================================
// Confetti on winners
// ============================================================
const confetti = (() => {
  const c = $('confetti-canvas');
  const ctx = c ? c.getContext('2d') : null;
  const resize = () => { if (c) { c.width = window.innerWidth; c.height = window.innerHeight; } };
  resize();
  window.addEventListener('resize', resize);
  let pieces = [];
  let running = false;

  const COLORS = ['#f4c430', '#ffdf6a', '#ff3d7f', '#7c5cff', '#26de81', '#29d3ff', '#ffffff'];

  function spawn(n = 120) {
    if (!ctx) return;
    for (let i = 0; i < n; i++) {
      pieces.push({
        x: Math.random() * c.width,
        y: -20 - Math.random() * 100,
        w: 6 + Math.random() * 8,
        h: 10 + Math.random() * 12,
        vy: 2 + Math.random() * 4,
        vx: (Math.random() - 0.5) * 4,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.3,
        col: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 1,
      });
    }
    if (!running) { running = true; loop(); }
  }

  function loop() {
    if (!ctx) { running = false; return; }
    ctx.clearRect(0, 0, c.width, c.height);
    pieces = pieces.filter(p => p.y < c.height + 40 && p.life > 0);
    for (const p of pieces) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08;
      p.vx *= 0.995;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (pieces.length > 0) {
      requestAnimationFrame(loop);
    } else {
      running = false;
      if (ctx) ctx.clearRect(0, 0, c.width, c.height);
    }
  }
  return { spawn };
})();

// ============================================================
// Chip animation layer (chips fly from seat to pot)
// ============================================================
function flyChipToPot(fromEl) {
  const layer = $('chip-layer');
  const potEl = $('pot-amount');
  if (!layer || !potEl || !fromEl) return;
  const layerRect = layer.getBoundingClientRect();
  const fromRect = fromEl.getBoundingClientRect();
  const potRect = potEl.getBoundingClientRect();

  const startX = fromRect.left + fromRect.width / 2 - layerRect.left - 12;
  const startY = fromRect.top + fromRect.height / 2 - layerRect.top - 12;
  const endX = potRect.left + potRect.width / 2 - layerRect.left - 12;
  const endY = potRect.top + potRect.height / 2 - layerRect.top - 12;

  for (let i = 0; i < 3; i++) {
    const chip = el('div', { class: 'chip-fly' });
    chip.style.left = (startX + (Math.random() - 0.5) * 14) + 'px';
    chip.style.top = (startY + (Math.random() - 0.5) * 14) + 'px';
    chip.style.transition = `transform 0.7s cubic-bezier(0.4,0.1,0.3,1), opacity 0.3s ease-in`;
    chip.style.transitionDelay = (i * 60) + 'ms';
    layer.appendChild(chip);
    // force layout, then animate
    requestAnimationFrame(() => {
      chip.style.transform = `translate(${endX - startX}px, ${endY - startY}px) scale(0.6)`;
      setTimeout(() => { chip.style.opacity = '0'; }, 550 + i * 60);
    });
    setTimeout(() => { chip.remove(); }, 1100 + i * 60);
  }
  sounds.chip();
}

// ============================================================
// Counter bump (when value changes)
// ============================================================
function bumpCounter(node, newValue) {
  if (!node) return;
  const oldVal = node.textContent;
  node.textContent = newValue;
  if (String(oldVal) !== String(newValue)) {
    node.classList.remove('bump');
    // trigger reflow
    void node.offsetWidth;
    node.classList.add('bump');
    setTimeout(() => node.classList.remove('bump'), 500);
  }
}

// ============================================================
// Turn timer
// ============================================================
const TIMER_DURATION = 45;
let turnTimer = null;
let turnTimerSecs = TIMER_DURATION;
let turnTimerPlayerId = null;

function startTurnTimer(forYourTurn) {
  stopTurnTimer();
  const timer = $('turn-timer');
  if (!timer) return;
  if (!forYourTurn) { timer.classList.add('hidden'); return; }
  timer.classList.remove('hidden');
  turnTimerSecs = TIMER_DURATION;
  updateTimerVisual(turnTimerSecs);
  turnTimer = setInterval(() => {
    turnTimerSecs--;
    updateTimerVisual(turnTimerSecs);
    if (turnTimerSecs <= 0) {
      stopTurnTimer();
      // Let server timeout; do not force-fold client-side to avoid mismatches
    }
  }, 1000);
}
function stopTurnTimer() {
  if (turnTimer) { clearInterval(turnTimer); turnTimer = null; }
  const timer = $('turn-timer');
  if (timer) timer.classList.add('hidden');
}
function updateTimerVisual(secs) {
  $('timer-text').textContent = Math.max(0, secs);
  const circ = 2 * Math.PI * 45; // 283
  const fg = document.querySelector('.turn-timer .timer-fg');
  if (fg) {
    const frac = Math.max(0, secs) / TIMER_DURATION;
    fg.setAttribute('stroke-dashoffset', String(circ * (1 - frac)));
    fg.classList.toggle('warning', secs <= 10);
  }
}

// ============================================================
// Login actions
// ============================================================
$('btn-create').addEventListener('click', () => {
  const name = $('input-name').value.trim();
  if (!name) return toast('Bitte Namen eingeben', 'error');
  myName = name;
  localStorage.setItem('tk_name', name);
  const startCoins = parseInt($('input-startcoins').value, 10) || 200;
  const smallBlind = parseInt($('input-sb').value, 10) || 5;
  const bigBlind = parseInt($('input-bb').value, 10) || 10;
  socket.emit('createRoom', { name, startCoins, smallBlind, bigBlind, persistentId }, (res) => {
    if (res.error) return toast(res.error, 'error');
    myRoom = res.code;
    localStorage.setItem('tk_room', res.code);
    toast(`Raum erstellt: ${res.code}`, 'success');
    showScreen('screen-game');
    sounds.turn();
  });
});

$('btn-join').addEventListener('click', () => {
  const name = $('input-name').value.trim();
  if (!name) return toast('Bitte Namen eingeben', 'error');
  const code = $('input-code').value.trim().toUpperCase();
  if (!code) return toast('Bitte Raum-Code eingeben', 'error');
  myName = name;
  localStorage.setItem('tk_name', name);
  socket.emit('joinRoom', { name, code, persistentId }, (res) => {
    if (res.error) return toast(res.error, 'error');
    myRoom = res.code;
    localStorage.setItem('tk_room', res.code);
    toast('Beigetreten', 'success');
    showScreen('screen-game');
    sounds.turn();
  });
});

// Auto-reconnect to last room
socket.on('connect', () => {
  if (lastRoomCode && myName) {
    socket.emit('reconnectRoom', { name: myName, code: lastRoomCode, persistentId }, (res) => {
      if (res && res.ok) {
        myRoom = res.code;
        showScreen('screen-game');
        toast('Wieder verbunden', 'success');
      }
    });
  }
});

// ============================================================
// Topbar
// ============================================================
$('btn-copy-code').addEventListener('click', () => {
  if (!state) return;
  const text = state.code;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Code kopiert', 'success'));
  } else {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Code kopiert', 'success'); }
    catch (e) { toast('Konnte nicht kopieren', 'error'); }
    document.body.removeChild(ta);
  }
});

$('btn-menu').addEventListener('click', () => {
  $('menu-drawer').classList.remove('hidden');
});
$('btn-close-menu').addEventListener('click', () => {
  $('menu-drawer').classList.add('hidden');
});

$('btn-leave').addEventListener('click', () => {
  if (!confirm('Wirklich verlassen?')) return;
  localStorage.removeItem('tk_room');
  socket.emit('leaveRoom');
  location.reload();
});

// ============================================================
// Host controls
// ============================================================
$('btn-start-hand').addEventListener('click', () => {
  socket.emit('startHand', {}, (res) => {
    if (res && res.error) return toast(res.error, 'error');
    $('menu-drawer').classList.add('hidden');
  });
});

$('btn-save-blinds').addEventListener('click', () => {
  const sb = parseInt($('host-sb').value, 10);
  const bb = parseInt($('host-bb').value, 10);
  socket.emit('hostSetBlinds', { smallBlind: sb, bigBlind: bb }, (res) => {
    if (res && res.error) return toast(res.error, 'error');
    toast('Blinds aktualisiert', 'success');
  });
});

// ============================================================
// Coin modal (host)
// ============================================================
let coinModalTargetId = null;
function openCoinModal(playerId, playerName, currentCoins) {
  coinModalTargetId = playerId;
  $('coin-modal-title').textContent = `Coins: ${playerName}`;
  $('coin-set-input').value = currentCoins;
  $('coin-add-input').value = 50;
  $('coin-modal').classList.remove('hidden');
}
$('coin-modal-close').addEventListener('click', () => $('coin-modal').classList.add('hidden'));
$('coin-set-btn').addEventListener('click', () => {
  const coins = parseInt($('coin-set-input').value, 10);
  if (isNaN(coins) || coins < 0) return toast('Ungültiger Wert', 'error');
  socket.emit('hostSetCoins', { playerId: coinModalTargetId, coins }, (res) => {
    if (res && res.error) return toast(res.error, 'error');
    $('coin-modal').classList.add('hidden');
    toast('Coins gesetzt', 'success');
  });
});
$('coin-add-btn').addEventListener('click', () => {
  const amount = parseInt($('coin-add-input').value, 10);
  if (isNaN(amount) || amount < 1) return toast('Ungültiger Wert', 'error');
  socket.emit('hostGiveCoins', { playerId: coinModalTargetId, amount }, (res) => {
    if (res && res.error) return toast(res.error, 'error');
    $('coin-modal').classList.add('hidden');
    toast('Coins hinzugefügt', 'success');
  });
});

// ============================================================
// Chat
// ============================================================
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('chat-input').value.trim();
  if (!text) return;
  socket.emit('chat', { text });
  $('chat-input').value = '';
});

socket.on('chat', ({ name, text }) => {
  const list = $('chat-list');
  const msg = el('div', { class: 'chat-msg' });
  msg.appendChild(el('strong', { text: name + ': ' }));
  msg.appendChild(document.createTextNode(text));
  list.appendChild(msg);
  list.scrollTop = list.scrollHeight;
});

// ============================================================
// Card rendering
// ============================================================
const SUIT_SYMBOLS = { h: '♥', d: '♦', c: '♣', s: '♠' };
function suitColor(suit) { return (suit === 'h' || suit === 'd') ? 'red' : 'black'; }
function rankDisplay(r) { return r === 'T' ? '10' : r; }

function cardEl(card, opts = {}) {
  if (!card || card === 'back') {
    const b = el('div', { class: 'card back' });
    if (opts.placeholder) b.classList.add('placeholder');
    return b;
  }
  const rank = card[0], suit = card[1];
  const e = el('div', { class: `card ${suitColor(suit)}` });
  if (opts.small) e.classList.add('small');
  if (opts.highlight) e.classList.add('highlight');
  e.appendChild(el('span', { class: 'rank', text: rankDisplay(rank) }));
  e.appendChild(el('span', { class: 'suit', text: SUIT_SYMBOLS[suit] || '?' }));
  e.appendChild(el('span', { class: 'mid-suit', text: SUIT_SYMBOLS[suit] || '?' }));
  return e;
}

// ============================================================
// Main state update
// ============================================================
socket.on('gameState', (s) => {
  prevState = state;
  state = s;
  detectTransitions();
  render();
});

socket.on('connect_error', () => toast('Verbindungsproblem', 'error'));
socket.on('disconnect', () => toast('Verbindung getrennt', 'error'));

const STATE_NAMES = {
  WAITING: 'Warteraum',
  PREFLOP: 'Pre-Flop',
  FLOP: 'Flop',
  TURN: 'Turn',
  RIVER: 'River',
  SHOWDOWN: 'Showdown',
};

// Detect transitions between states to fire animations/sounds/confetti
function detectTransitions() {
  if (!prevState || !state) return;

  // Hand state changes
  if (prevState.state !== state.state) {
    if (state.state === 'PREFLOP') { sounds.deal(); }
    if (state.state === 'FLOP' || state.state === 'TURN' || state.state === 'RIVER') { sounds.flip(); }
    if (state.state === 'SHOWDOWN') {
      sounds.win();
      setTimeout(() => confetti.spawn(140), 200);
      setTimeout(() => confetti.spawn(80), 700);
    }
  }

  // Bet changes: fly chips from seat to pot for anyone whose bet increased
  const prevById = Object.fromEntries((prevState.players || []).map(p => [p.id, p]));
  for (const p of (state.players || [])) {
    const old = prevById[p.id];
    if (old && p.bet > old.bet) {
      // find seat element in DOM (may still be old render)
      const seat = document.querySelector(`[data-player-id="${cssEscape(p.id)}"]`);
      const yourSeat = (p.id === state.youId) ? $('you-cards') : null;
      const sourceEl = seat || yourSeat;
      if (sourceEl) {
        // slight delay to let new seat render if needed
        setTimeout(() => flyChipToPot(sourceEl), 30);
      } else {
        sounds.chip();
      }
      if (p.allIn && !old.allIn) sounds.allin();
    }
    if (old && !old.folded && p.folded) sounds.fold();
  }

  // Turn change: if it's now my turn, play cue
  const prevTurnId = prevState.players && prevState.currentPlayerIdx >= 0
    ? (prevState.players[prevState.currentPlayerIdx] && prevState.players[prevState.currentPlayerIdx].id) : null;
  const curTurnId = state.players && state.currentPlayerIdx >= 0
    ? (state.players[state.currentPlayerIdx] && state.players[state.currentPlayerIdx].id) : null;
  if (prevTurnId !== curTurnId && curTurnId === state.youId) {
    sounds.turn();
  }
}

function cssEscape(s) {
  if (!s) return '';
  return String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
}

// ============================================================
// Render
// ============================================================
function render() {
  if (!state) return;

  // Top bar
  $('room-code').textContent = state.code || '—';
  $('hand-state').textContent = STATE_NAMES[state.state] || state.state;
  $('hand-num').textContent = state.handNumber || '0';

  // Pot (with bump)
  bumpCounter($('pot-amount'), state.pot || 0);

  // Stage badge
  $('stage-badge').textContent = state.state !== 'WAITING' && state.state !== 'SHOWDOWN'
    ? STATE_NAMES[state.state] || '' : '';

  // Community cards
  renderCommunity();

  // Players grid (all except "you")
  const grid = $('players-grid');
  grid.innerHTML = '';
  const me = state.players.find(p => p.id === state.youId);
  const others = state.players.filter(p => p.id !== state.youId);
  for (const p of others) renderSeat(grid, p);

  // Your seat info
  $('you-name').textContent = (me ? me.name : '—') + (me && me.id === state.hostId ? ' 👑' : '');
  const coinNode = $('you-coins');
  bumpCounter(coinNode, me ? me.coins : 0);

  renderYourCards(me);

  // Toggle folded styling on bottom bar
  const youInfo = document.querySelector('.you-info');
  if (youInfo) youInfo.classList.toggle('folded', !!(me && me.folded));

  // Action panel
  renderActionPanel(me);

  // Showdown display
  renderShowdown();

  // Turn timer
  const myTurn = me && state.players && state.currentPlayerIdx >= 0 &&
    state.players[state.currentPlayerIdx] && state.players[state.currentPlayerIdx].id === me.id;
  if (myTurn && state.state !== 'WAITING' && state.state !== 'SHOWDOWN') {
    if (!turnTimer) startTurnTimer(true);
  } else {
    stopTurnTimer();
  }

  // Drawer
  renderDrawer(me);
}

function renderCommunity() {
  const cc = $('community-cards');
  // Smart update: only rebuild if number of cards changed to preserve animations
  const currentCards = Array.from(cc.querySelectorAll('.card:not(.placeholder)')).length;
  const want = (state.communityCards || []).length;
  if (currentCards !== want) {
    cc.innerHTML = '';
    for (const card of (state.communityCards || [])) {
      const c = cardEl(card);
      if (state.state !== 'SHOWDOWN') c.classList.add('flipping');
      cc.appendChild(c);
    }
    for (let i = (state.communityCards || []).length; i < 5; i++) {
      cc.appendChild(cardEl('back', { placeholder: true }));
    }
    // Highlight best-cards at showdown for winning hand
    if (state.state === 'SHOWDOWN' && state.showdownData && state.showdownData.pots && state.showdownData.pots.length) {
      const winnerId = state.showdownData.pots[0].winners[0] && state.showdownData.pots[0].winners[0].id;
      const winnerHand = state.showdownData.playerHands && state.showdownData.playerHands.find(h => h.id === winnerId);
      if (winnerHand && winnerHand.bestCards) {
        const cards = cc.querySelectorAll('.card:not(.placeholder)');
        (state.communityCards || []).forEach((cc2, i) => {
          if (winnerHand.bestCards.includes(cc2) && cards[i]) cards[i].classList.add('highlight');
        });
      }
    }
  }
}

function renderYourCards(me) {
  const yc = $('you-cards');
  const existing = yc.querySelectorAll('.card').length;
  const want = me && me.cards ? me.cards.length : 0;
  if (existing !== want || !me) {
    yc.innerHTML = '';
    if (me && me.cards && me.cards.length) {
      for (const c of me.cards) yc.appendChild(cardEl(c));
    }
  }
  // State tag
  yc.querySelectorAll('.player-action-tag, .player-bet').forEach(n => n.remove());
  if (me) {
    if (me.folded) {
      const tag = el('div', { class: 'player-action-tag', text: 'GEFOLDET' });
      tag.style.color = '#888';
      yc.appendChild(tag);
    } else if (me.allIn) {
      const tag = el('div', { class: 'player-action-tag', text: 'ALL-IN' });
      tag.style.color = '#ff3d7f';
      yc.appendChild(tag);
    } else if (me.bet > 0) {
      yc.appendChild(el('div', { class: 'player-bet', text: me.bet }));
    }
  }
}

function renderSeat(grid, p) {
  const seat = el('div', { class: 'player-seat' });
  seat.dataset.playerId = p.id;
  seat.setAttribute('data-player-id', p.id);

  const idxOfP = state.players.findIndex(pl => pl.id === p.id);
  if (idxOfP === state.currentPlayerIdx) seat.classList.add('current-turn');
  if (idxOfP === state.dealerIdx) seat.classList.add('dealer');
  if (p.folded) seat.classList.add('folded');
  if (p.id === state.hostId) seat.classList.add('host-badge');
  if (p.left) seat.style.opacity = 0.3;

  // Winner highlight at showdown
  if (state.state === 'SHOWDOWN' && state.showdownData && state.showdownData.pots) {
    const isWinner = state.showdownData.pots.some(pot => pot.winners.some(w => w.id === p.id));
    if (isWinner) seat.classList.add('winner');
  }

  seat.appendChild(el('div', { class: 'player-name', text: p.name + (p.left ? ' (weg)' : '') + (p.disconnected ? ' 🔌' : '') }));
  seat.appendChild(el('div', { class: 'player-coins', text: `${p.coins} 💰` }));

  if (p.bet > 0) {
    seat.appendChild(el('div', { class: 'player-bet', text: p.bet }));
  } else if (p.allIn) {
    seat.appendChild(el('div', { class: 'player-action-tag', text: 'ALL-IN' }));
  } else if (p.folded) {
    seat.appendChild(el('div', { class: 'player-action-tag', text: 'Fold' }));
  }

  // Mini cards
  if (p.cardCount > 0) {
    const mini = el('div', { class: 'player-cards-mini' });
    for (const c of p.cards) {
      if (c === 'back') {
        mini.appendChild(el('div', { class: 'mini-card' }));
      } else {
        const m = el('div', { class: 'mini-card shown ' + suitColor(c[1]) });
        m.textContent = rankDisplay(c[0]) + SUIT_SYMBOLS[c[1]];
        mini.appendChild(m);
      }
    }
    seat.appendChild(mini);
  }

  grid.appendChild(seat);
}

// ============================================================
// Action panel
// ============================================================
function renderActionPanel(me) {
  const info = $('action-info');
  const buttons = $('action-buttons');
  const raisePanel = $('raise-panel');
  buttons.innerHTML = '';
  if (raisePanel) raisePanel.classList.add('hidden');

  if (!me) { info.textContent = 'Du bist nicht im Raum.'; return; }

  if (state.state === 'WAITING') {
    if (me.id === state.hostId) {
      info.textContent = 'Du bist Host. Drücke "Neue Runde starten".';
      const btn = el('button', { class: 'btn btn-primary shine', text: '🎲 Runde starten' });
      btn.style.gridColumn = 'span 3';
      btn.addEventListener('click', () => socket.emit('startHand'));
      buttons.appendChild(btn);
    } else {
      info.textContent = 'Warte bis der Host die Runde startet…';
    }
    return;
  }

  if (state.state === 'SHOWDOWN') {
    if (me.id === state.hostId) {
      info.textContent = 'Runde beendet. Bereit für die nächste?';
      const btn = el('button', { class: 'btn btn-primary shine', text: '🎲 Nächste Runde' });
      btn.style.gridColumn = 'span 3';
      btn.addEventListener('click', () => socket.emit('startHand'));
      buttons.appendChild(btn);
    } else {
      info.textContent = 'Runde beendet. Host startet die nächste…';
    }
    return;
  }

  // In-hand
  const idxOfMe = state.players.findIndex(p => p.id === me.id);
  const myTurn = idxOfMe === state.currentPlayerIdx;
  const toCall = state.currentBet - me.bet;

  if (me.folded) { info.textContent = 'Du bist gefoldet. Warte auf Rundenende.'; return; }
  if (me.allIn) { info.textContent = 'Du bist ALL-IN. Warte auf die Karten.'; return; }
  if (!me.inHand) { info.textContent = 'Du spielst diese Hand nicht mit.'; return; }

  if (!myTurn) {
    const current = state.players[state.currentPlayerIdx];
    info.textContent = current ? `${current.name} ist dran…` : 'Warte…';
    return;
  }

  info.innerHTML = toCall > 0
    ? `<strong style="color:var(--gold-2)">${toCall}</strong> zu callen · Du bist dran`
    : '✨ Du bist dran';

  // Fold
  const btnFold = el('button', { class: 'btn btn-fold', text: 'Fold' });
  btnFold.addEventListener('click', () => doAction('fold'));
  buttons.appendChild(btnFold);

  // Check/Call
  if (toCall <= 0) {
    const b = el('button', { class: 'btn btn-check', text: 'Check' });
    b.addEventListener('click', () => doAction('check'));
    buttons.appendChild(b);
  } else {
    const canCover = me.coins >= toCall;
    const b = el('button', { class: 'btn btn-call', text: canCover ? `Call ${toCall}` : `Call All-In (${me.coins})` });
    b.addEventListener('click', () => doAction('call'));
    buttons.appendChild(b);
  }

  // Raise / Bet button
  const minRaiseTotal = state.currentBet + state.minRaise;
  const canRaise = me.coins > toCall && me.coins + me.bet >= minRaiseTotal;
  if (canRaise) {
    const raiseLabel = state.currentBet === 0 ? 'Bet' : 'Raise';
    const b = el('button', { class: 'btn btn-raise', text: raiseLabel });
    b.addEventListener('click', () => openRaise(me));
    buttons.appendChild(b);
  } else if (me.coins > 0) {
    const b = el('button', { class: 'btn btn-allin', text: `All-In (${me.coins + me.bet})` });
    b.addEventListener('click', () => doAction('allin'));
    buttons.appendChild(b);
  }
}

function openRaise(me) {
  const panel = $('raise-panel');
  if (!panel) return;
  panel.classList.remove('hidden');
  const minTotal = Math.max(state.currentBet + state.minRaise, state.bigBlind);
  const maxTotal = me.bet + me.coins;
  const slider = $('raise-slider');
  const display = $('raise-display');
  slider.min = minTotal;
  slider.max = maxTotal;
  slider.value = minTotal;
  const setVal = (v) => {
    const x = Math.min(maxTotal, Math.max(minTotal, Math.round(Number(v) || minTotal)));
    slider.value = x;
    display.textContent = x;
  };
  setVal(minTotal);

  slider.oninput = () => setVal(slider.value);

  $('raise-min').onclick = () => setVal(minTotal);
  $('raise-half').onclick = () => {
    const half = Math.floor(state.pot / 2);
    setVal(Math.min(maxTotal, Math.max(minTotal, state.currentBet + Math.max(half, state.minRaise))));
  };
  $('raise-pot').onclick = () => {
    const potRaise = state.currentBet + Math.max(state.pot, state.minRaise);
    setVal(Math.min(maxTotal, Math.max(minTotal, potRaise)));
  };
  $('raise-allin').onclick = () => setVal(maxTotal);

  $('raise-confirm').onclick = () => {
    const amount = parseInt(slider.value, 10);
    if (isNaN(amount)) return toast('Ungültiger Betrag', 'error');
    if (amount >= maxTotal) {
      doAction('allin');
    } else {
      doAction('raise', amount);
    }
    panel.classList.add('hidden');
  };
  $('raise-cancel').onclick = () => panel.classList.add('hidden');
}

function doAction(action, amount) {
  // Play immediate feedback sound
  if (action === 'check') sounds.check();
  else if (action === 'fold') sounds.fold();
  else if (action === 'call' || action === 'raise') sounds.chip();
  else if (action === 'allin') sounds.allin();

  socket.emit('action', { action, amount }, (res) => {
    if (res && res.error) toast(res.error, 'error');
  });
}

// ============================================================
// Showdown
// ============================================================
function renderShowdown() {
  const box = $('showdown-info');
  box.innerHTML = '';
  if (state.state !== 'SHOWDOWN' || !state.showdownData) return;
  const { pots, playerHands } = state.showdownData;
  box.appendChild(el('h3', { text: '🏆 Showdown' }));
  for (const pot of pots) {
    const line = el('div', { class: 'winner-line' });
    line.innerHTML = `💰 <strong>${pot.amount}</strong> → ${
      pot.winners.map(w => `<strong>${escapeHtml(w.name)}</strong> <small style="color:var(--text-dim)">(${escapeHtml(w.hand)})</small>`).join(' & ')
    }`;
    box.appendChild(line);
  }
  if (playerHands && playerHands.length > 1) {
    const hands = el('div', { class: 'hands' });
    hands.innerHTML = playerHands.map(ph =>
      `<span style="color:var(--gold-2)">${escapeHtml(ph.name)}</span>: ${ph.cards.map(c =>
        `<span style="color:${suitColor(c[1]) === 'red' ? '#ff6b6b' : '#ddd'};font-weight:700">${rankDisplay(c[0])}${SUIT_SYMBOLS[c[1]]}</span>`
      ).join(' ')} — ${escapeHtml(ph.hand)}`
    ).join('<br/>');
    box.appendChild(hands);
  }
}

// ============================================================
// Drawer
// ============================================================
function renderDrawer(me) {
  const isHost = me && me.id === state.hostId;
  $('host-section').classList.toggle('hidden', !isHost);

  const list = $('menu-players');
  list.innerHTML = '';
  for (const p of state.players) {
    const row = el('div', { class: 'menu-player-row' });
    const left = el('div');
    left.appendChild(el('div', { class: 'mp-name', text: p.name + (p.id === state.hostId ? ' 👑' : '') + (p.id === state.youId ? ' (du)' : '') + (p.disconnected ? ' 🔌' : '') }));
    left.appendChild(el('div', { class: 'mp-coins', text: `${p.coins} Coins${p.folded ? ' · gefoldet' : ''}${p.allIn ? ' · all-in' : ''}` }));
    row.appendChild(left);
    if (isHost) {
      const btn = el('button', { class: 'mp-edit', text: 'Coins' });
      btn.addEventListener('click', () => openCoinModal(p.id, p.name, p.coins));
      row.appendChild(btn);
    }
    list.appendChild(row);
  }

  if (isHost) {
    if (document.activeElement !== $('host-sb')) $('host-sb').value = state.smallBlind;
    if (document.activeElement !== $('host-bb')) $('host-bb').value = state.bigBlind;
  }

  const log = $('log-list');
  log.innerHTML = '';
  for (const l of (state.logs || [])) {
    log.appendChild(el('div', { class: 'log-item', text: l.text }));
  }
  log.scrollTop = log.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
