// Tokenburger Kameraden - Poker Server
// Texas Hold'em multiplayer server with Socket.io (with reconnect support)

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Cache-busting: server start time becomes the asset version. Every redeploy
// on Infomaniak restarts the process, which bumps this and forces browsers to
// refetch /client.js and /style.css.
const ASSET_VERSION = Date.now().toString(36);

const fs = require('fs');
// Serve index.html with a live-injected asset version so browsers always load
// the matching script/style after a deploy.
const INDEX_PATH = path.join(__dirname, 'public', 'index.html');
app.get(['/', '/index.html'], (req, res) => {
  fs.readFile(INDEX_PATH, 'utf8', (err, html) => {
    if (err) { res.status(500).send('index not found'); return; }
    const out = html
      .replace('href="/style.css"', `href="/style.css?v=${ASSET_VERSION}"`)
      .replace('src="/client.js"',  `src="/client.js?v=${ASSET_VERSION}"`);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Expires', '0');
    res.set('Pragma', 'no-cache');
    res.type('html').send(out);
  });
});

// Serve other static assets normally, but keep them revalidated often.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  maxAge: 0,
  setHeaders(res, p) {
    // JS/CSS get a strong revalidation header; everything else can be cached.
    if (/\.(js|css)$/i.test(p)) {
      res.set('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));

// Health check
app.get('/health', (_, res) => res.json({ ok: true, rooms: rooms.size, version: ASSET_VERSION }));

const PORT = process.env.PORT || 3000;

// ============================================================
// Card & Hand Evaluation
// ============================================================

// ============================================================
// Money formatting — everything is stored in Rappen (integer cents).
// ============================================================
function fmtChf(rappen) {
  const n = Math.round(Number(rappen) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return sign + (abs / 100).toFixed(2);
}

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['h', 'd', 'c', 's'];

function rankValue(r) { return RANKS.indexOf(r) + 2; }

function createDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function evalFive(cards) {
  const values = cards.map(c => rankValue(c[0])).sort((a, b) => b - a);
  const suits = cards.map(c => c[1]);
  const isFlush = suits.every(s => s === suits[0]);

  const unique = [...new Set(values)];
  let isStraight = false;
  let straightHigh = 0;
  if (unique.length === 5) {
    if (values[0] - values[4] === 4) {
      isStraight = true;
      straightHigh = values[0];
    } else if (values[0] === 14 && values[1] === 5 && values[2] === 4 && values[3] === 3 && values[4] === 2) {
      isStraight = true;
      straightHigh = 5;
    }
  }

  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([v, c]) => [Number(v), c])
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const pattern = groups.map(g => g[1]).join('');

  if (isStraight && isFlush) {
    if (straightHigh === 14) return [9, 14];
    return [8, straightHigh];
  }
  if (pattern === '41') return [7, groups[0][0], groups[1][0]];
  if (pattern === '32') return [6, groups[0][0], groups[1][0]];
  if (isFlush) return [5, ...values];
  if (isStraight) return [4, straightHigh];
  if (pattern === '311') return [3, groups[0][0], groups[1][0], groups[2][0]];
  if (pattern === '221') return [2, groups[0][0], groups[1][0], groups[2][0]];
  if (pattern === '2111') return [1, groups[0][0], groups[1][0], groups[2][0], groups[3][0]];
  return [0, ...values];
}

function combinations(arr, k) {
  const result = [];
  (function rec(start, curr) {
    if (curr.length === k) { result.push([...curr]); return; }
    for (let i = start; i < arr.length; i++) {
      curr.push(arr[i]);
      rec(i + 1, curr);
      curr.pop();
    }
  })(0, []);
  return result;
}

function evalBest(cards) {
  let best = null;
  let bestCombo = null;
  for (const c of combinations(cards, 5)) {
    const score = evalFive(c);
    if (!best || compareScores(score, best) > 0) {
      best = score;
      bestCombo = c;
    }
  }
  return { score: best, cards: bestCombo };
}

function compareScores(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

const HAND_NAMES = [
  'High Card', 'Paar', 'Zwei Paare', 'Drilling', 'Straße',
  'Flush', 'Full House', 'Vierling', 'Straight Flush', 'Royal Flush'
];

function describeHand(score) {
  return HAND_NAMES[score[0]];
}

// ============================================================
// Room management
// ============================================================

const rooms = new Map();           // code -> Room
const socketToRoom = new Map();    // socketId -> roomCode
const socketToPid = new Map();     // socketId -> persistentId

// Grace period before truly removing a disconnected player (ms)
const DISCONNECT_GRACE_MS = 90 * 1000;

function generateRoomCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function createRoom(hostPid, hostSocketId, hostName, config = {}) {
  const code = generateRoomCode();
  const visibility = config.visibility === 'public' ? 'public' : 'private';
  const room = {
    code,
    hostId: hostPid,
    visibility,
    players: [],
    state: 'WAITING',
    deck: [],
    communityCards: [],
    pot: 0,
    currentBet: 0,
    minRaise: 0,
    // Internal unit = Rappen (1 CHF = 100 Rappen). UI handles CHF formatting.
    // Defaults: 0.20 CHF / 0.40 CHF blinds, 50 CHF buy-in.
    smallBlind: config.smallBlind || 20,
    bigBlind: config.bigBlind || 40,
    startCoins: config.startCoins || 5000,
    customStartCoins: {},
    dealerIdx: -1,
    currentPlayerIdx: -1,
    lastAggressorIdx: -1,
    handNumber: 0,
    showdownData: null,
    logs: [],
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  addPlayer(room, hostPid, hostSocketId, hostName);
  return room;
}

// ---- Lobby helpers --------------------------------------------------------
const LOBBY_ROOM = 'lobby';
const MAX_PLAYERS_PER_ROOM = 7;

function roomSummary(room) {
  const host = room.players.find(p => p.id === room.hostId);
  const activePlayers = room.players.filter(p => !p.left);
  return {
    code: room.code,
    hostName: host ? host.name : '—',
    playerCount: activePlayers.length,
    maxPlayers: MAX_PLAYERS_PER_ROOM,
    state: room.state,
    handNumber: room.handNumber,
    smallBlind: room.smallBlind,
    bigBlind: room.bigBlind,
    startCoins: room.startCoins,
    createdAt: room.createdAt,
  };
}

function listPublicRooms() {
  const list = [];
  for (const room of rooms.values()) {
    if (room.visibility !== 'public') continue;
    const active = room.players.filter(p => !p.left);
    if (active.length === 0) continue;
    list.push(roomSummary(room));
  }
  // Most recent first
  list.sort((a, b) => b.createdAt - a.createdAt);
  return list;
}

function broadcastLobby() {
  // Emit to everyone viewing the join tab (they're in the LOBBY_ROOM).
  io.to(LOBBY_ROOM).emit('lobbyUpdate', { rooms: listPublicRooms() });
}

function addPlayer(room, persistentId, socketId, name) {
  // Reconnect path: same persistent id already in room
  const existing = persistentId ? room.players.find(p => p.id === persistentId) : null;
  if (existing) {
    // Collision detection: if the existing player's old socket is still live
    // AND this is a different socket, this isn't really a reconnect — it's a
    // second tab / second device trying to join with the same pid (because
    // localStorage was shared). Treat as a FRESH join with a unique internal id
    // so both clients get their own player.
    const oldSocketAlive =
      existing.socketId &&
      existing.socketId !== socketId &&
      io.sockets.sockets.has(existing.socketId);
    if (oldSocketAlive) {
      // Fall through to fresh-join path with a derived unique id
      const uniqueId = persistentId + '_' + Math.random().toString(36).slice(2, 7);
      return addFreshPlayer(room, uniqueId, socketId, name);
    }
    existing.socketId = socketId;
    existing.disconnected = false;
    existing.left = false;
    if (existing._disconnectTimer) {
      clearTimeout(existing._disconnectTimer);
      existing._disconnectTimer = null;
    }
    socketToRoom.set(socketId, room.code);
    socketToPid.set(socketId, persistentId);
    return { player: existing, reconnect: true };
  }

  return addFreshPlayer(room, persistentId, socketId, name);
}

function addFreshPlayer(room, persistentId, socketId, name) {
  const active = room.players.filter(p => !p.left);
  if (active.length >= 7) return { error: 'Raum ist voll (max. 7 Spieler)' };
  if (active.some(p => p.name.toLowerCase() === (name || '').toLowerCase())) {
    return { error: 'Name bereits vergeben' };
  }
  const player = {
    id: persistentId,
    socketId,
    name,
    coins: room.startCoins,
    cards: [],
    bet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    inHand: false,
    hasActed: false,
    disconnected: false,
    left: false,
  };
  room.players.push(player);
  socketToRoom.set(socketId, room.code);
  socketToPid.set(socketId, persistentId);
  return { player, assignedId: persistentId };
}

function findBySocket(socketId) {
  const code = socketToRoom.get(socketId);
  if (!code) return { };
  const room = rooms.get(code);
  if (!room) return { };
  const player = room.players.find(p => p.socketId === socketId);
  return { room, player };
}

function scheduleRemoval(room, player) {
  if (player._disconnectTimer) clearTimeout(player._disconnectTimer);
  player._disconnectTimer = setTimeout(() => {
    // If still disconnected after grace period, remove from room
    if (!player.disconnected) return;
    player.left = true;
    logRoom(room, `${player.name} wurde aus dem Raum entfernt (Verbindung verloren).`);

    if (room.state !== 'WAITING' && room.state !== 'SHOWDOWN' && player.inHand && !player.folded) {
      player.folded = true;
      player.hasActed = true;
      const idx = room.players.findIndex(p => p.id === player.id);
      if (room.currentPlayerIdx === idx) {
        advanceAction(room);
      } else {
        checkHandEnd(room);
      }
    }

    // Compact in waiting/showdown
    if (room.state === 'WAITING' || room.state === 'SHOWDOWN') {
      const idx = room.players.findIndex(p => p.id === player.id);
      if (idx >= 0) {
        room.players.splice(idx, 1);
        if (room.dealerIdx >= idx) room.dealerIdx = Math.max(-1, room.dealerIdx - 1);
        if (room.currentPlayerIdx >= idx) room.currentPlayerIdx = Math.max(-1, room.currentPlayerIdx - 1);
      }
    }

    // Transfer host
    if (room.hostId === player.id) {
      const newHost = room.players.find(p => !p.left && !p.disconnected);
      if (newHost) {
        room.hostId = newHost.id;
        logRoom(room, `${newHost.name} ist jetzt Host.`);
      }
    }

    const wasPublic = room.visibility === 'public';
    if (room.players.length === 0) {
      rooms.delete(room.code);
      if (wasPublic) broadcastLobby();
      return;
    }

    broadcastState(room);
    if (wasPublic) broadcastLobby();
  }, DISCONNECT_GRACE_MS);
}

function handleDisconnect(socketId) {
  const { room, player } = findBySocket(socketId);
  socketToRoom.delete(socketId);
  socketToPid.delete(socketId);
  if (!room || !player) return;
  player.disconnected = true;
  logRoom(room, `${player.name} hat die Verbindung verloren (warte ${DISCONNECT_GRACE_MS / 1000}s auf Reconnect).`);
  scheduleRemoval(room, player);
  broadcastState(room);
  if (room.visibility === 'public') broadcastLobby();
}

function forceLeave(room, player) {
  // Hard leave (user clicked leave)
  if (player._disconnectTimer) { clearTimeout(player._disconnectTimer); player._disconnectTimer = null; }
  const idx = room.players.findIndex(p => p.id === player.id);
  if (idx === -1) return;

  if (room.state !== 'WAITING' && room.state !== 'SHOWDOWN' && player.inHand && !player.folded) {
    player.folded = true;
    player.hasActed = true;
    player.left = true;
    logRoom(room, `${player.name} hat den Raum verlassen und wird gefoldet.`);
    if (room.currentPlayerIdx === idx) {
      advanceAction(room);
    } else {
      checkHandEnd(room);
    }
  } else {
    room.players.splice(idx, 1);
    if (room.dealerIdx >= idx) room.dealerIdx = Math.max(-1, room.dealerIdx - 1);
    if (room.currentPlayerIdx >= idx) room.currentPlayerIdx = Math.max(-1, room.currentPlayerIdx - 1);
    logRoom(room, `${player.name} hat den Raum verlassen.`);
  }

  // Transfer host
  if (room.hostId === player.id) {
    const newHost = room.players.find(p => !p.left && !p.disconnected);
    if (newHost) {
      room.hostId = newHost.id;
      logRoom(room, `${newHost.name} ist jetzt Host.`);
    }
  }

  const wasPublic = room.visibility === 'public';
  if (room.players.length === 0) {
    rooms.delete(room.code);
    if (wasPublic) broadcastLobby();
    return;
  }
  broadcastState(room);
  if (wasPublic) broadcastLobby();
}

function logRoom(room, text) {
  const entry = { text, ts: Date.now() };
  room.logs.push(entry);
  if (room.logs.length > 60) room.logs.shift();
}

// ============================================================
// Hand flow
// ============================================================

function startHand(room) {
  // Filter out left players before starting
  room.players = room.players.filter(p => !p.left);
  if (room.dealerIdx >= room.players.length) room.dealerIdx = -1;

  const eligible = room.players.filter(p => p.coins > 0 && !p.disconnected);
  if (eligible.length < 2) {
    room.state = 'WAITING';
    logRoom(room, 'Nicht genug Spieler mit Guthaben. Host muss Guthaben verteilen oder auf Reconnect warten.');
    broadcastState(room);
    return;
  }

  room.deck = shuffle(createDeck());
  room.communityCards = [];
  room.pot = 0;
  room.currentBet = 0;
  room.minRaise = room.bigBlind;
  room.handNumber++;
  room.showdownData = null;

  for (const p of room.players) {
    p.cards = [];
    p.bet = 0;
    p.totalBet = 0;
    p.folded = p.coins <= 0 || p.disconnected;
    p.allIn = false;
    p.inHand = p.coins > 0 && !p.disconnected;
    p.hasActed = false;
  }

  room.dealerIdx = findNextInHand(room, room.dealerIdx);
  const inHandCount = room.players.filter(p => p.inHand).length;

  let sbIdx, bbIdx;
  if (inHandCount === 2) {
    sbIdx = room.dealerIdx;
    bbIdx = findNextInHand(room, sbIdx);
  } else {
    sbIdx = findNextInHand(room, room.dealerIdx);
    bbIdx = findNextInHand(room, sbIdx);
  }

  takeBet(room.players[sbIdx], room.smallBlind);
  takeBet(room.players[bbIdx], room.bigBlind);
  room.sbIdx = sbIdx;
  room.bbIdx = bbIdx;
  room.currentBet = room.bigBlind;
  logRoom(room, `Neue Runde! SB ${fmtChf(room.smallBlind)} von ${room.players[sbIdx].name}, BB ${fmtChf(room.bigBlind)} von ${room.players[bbIdx].name} (CHF).`);

  // Deal 2 hole cards
  for (let i = 0; i < 2; i++) {
    for (const p of room.players) {
      if (p.inHand) p.cards.push(room.deck.pop());
    }
  }

  room.state = 'PREFLOP';

  if (inHandCount === 2) {
    room.currentPlayerIdx = sbIdx;
  } else {
    room.currentPlayerIdx = findNextInHand(room, bbIdx);
  }
  room.lastAggressorIdx = bbIdx;

  broadcastState(room);
}

function takeBet(player, amount) {
  amount = Math.min(amount, player.coins);
  player.coins -= amount;
  player.bet += amount;
  player.totalBet += amount;
  if (player.coins === 0) player.allIn = true;
  return amount;
}

function findNextInHand(room, fromIdx) {
  const n = room.players.length;
  if (n === 0) return -1;
  let idx = fromIdx;
  for (let i = 0; i < n; i++) {
    idx = (idx + 1) % n;
    if (room.players[idx].inHand) return idx;
  }
  return -1;
}

function findNextToAct(room, fromIdx) {
  const n = room.players.length;
  if (n === 0) return -1;
  let idx = fromIdx;
  for (let i = 0; i < n; i++) {
    idx = (idx + 1) % n;
    const p = room.players[idx];
    if (p.inHand && !p.folded && !p.allIn) return idx;
  }
  return -1;
}

// ============================================================
// Player actions
// ============================================================

function handleAction(room, pid, action, amount) {
  const idx = room.players.findIndex(p => p.id === pid);
  if (idx === -1 || idx !== room.currentPlayerIdx) {
    return { error: 'Nicht dein Zug' };
  }
  const p = room.players[idx];
  if (!p.inHand || p.folded || p.allIn) {
    return { error: 'Du kannst nicht handeln' };
  }

  const toCall = room.currentBet - p.bet;

  switch (action) {
    case 'fold':
      p.folded = true;
      p.hasActed = true;
      logRoom(room, `${p.name} foldet.`);
      break;

    case 'check':
      if (toCall > 0) return { error: 'Du kannst nicht checken - musst callen oder folden' };
      p.hasActed = true;
      logRoom(room, `${p.name} checkt.`);
      break;

    case 'call': {
      if (toCall <= 0) return { error: 'Nichts zum Callen - check stattdessen' };
      const paid = takeBet(p, toCall);
      p.hasActed = true;
      logRoom(room, `${p.name} callt ${fmtChf(paid)} CHF.`);
      break;
    }

    case 'raise': {
      const totalBet = Number(amount);
      if (isNaN(totalBet)) return { error: 'Ungültiger Betrag' };
      const maxPossible = p.bet + p.coins;
      if (totalBet > maxPossible) return { error: 'Nicht genug Coins' };
      const raiseAmount = totalBet - room.currentBet;
      if (totalBet < maxPossible && raiseAmount < room.minRaise) {
        return { error: `Mindest-Raise auf ${room.currentBet + room.minRaise}` };
      }
      if (totalBet <= room.currentBet) return { error: 'Raise muss höher als aktueller Einsatz sein' };
      const delta = totalBet - p.bet;
      takeBet(p, delta);
      if (raiseAmount >= room.minRaise) {
        room.minRaise = raiseAmount;
      }
      room.currentBet = p.bet;
      p.hasActed = true;
      room.lastAggressorIdx = idx;
      for (const o of room.players) {
        if (o !== p && o.inHand && !o.folded && !o.allIn) o.hasActed = false;
      }
      logRoom(room, `${p.name} ${p.allIn ? 'ist ALL-IN mit' : 'raist auf'} ${fmtChf(p.bet)} CHF.`);
      break;
    }

    case 'allin': {
      const delta = p.coins;
      if (delta === 0) return { error: 'Keine Coins mehr' };
      const newBet = p.bet + delta;
      takeBet(p, delta);
      if (newBet > room.currentBet) {
        const raiseAmount = newBet - room.currentBet;
        if (raiseAmount >= room.minRaise) {
          room.minRaise = raiseAmount;
          room.lastAggressorIdx = idx;
          for (const o of room.players) {
            if (o !== p && o.inHand && !o.folded && !o.allIn) o.hasActed = false;
          }
        }
        room.currentBet = newBet;
      }
      p.hasActed = true;
      logRoom(room, `${p.name} ist ALL-IN mit ${fmtChf(newBet)} CHF!`);
      break;
    }

    default:
      return { error: 'Unbekannte Aktion' };
  }

  advanceAction(room);
  return { ok: true };
}

function advanceAction(room) {
  if (checkHandEnd(room)) return;

  const needAction = room.players.filter(p =>
    p.inHand && !p.folded && !p.allIn && (!p.hasActed || p.bet < room.currentBet)
  );

  if (needAction.length === 0) {
    advanceStage(room);
    return;
  }

  const next = findNextToAct(room, room.currentPlayerIdx);
  room.currentPlayerIdx = next;
  broadcastState(room);
}

function checkHandEnd(room) {
  const inPlay = room.players.filter(p => p.inHand && !p.folded);
  if (inPlay.length <= 1) {
    endHandSinglePlayer(room, inPlay[0]);
    return true;
  }
  return false;
}

function advanceStage(room) {
  for (const p of room.players) {
    room.pot += p.bet;
    p.bet = 0;
    p.hasActed = false;
  }
  room.currentBet = 0;
  room.minRaise = room.bigBlind;

  const canAct = room.players.filter(p => p.inHand && !p.folded && !p.allIn);

  const dealNext = () => {
    if (room.state === 'PREFLOP') {
      room.state = 'FLOP';
      room.deck.pop();
      room.communityCards.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
      logRoom(room, `Flop: ${room.communityCards.slice(-3).join(' ')}`);
    } else if (room.state === 'FLOP') {
      room.state = 'TURN';
      room.deck.pop();
      room.communityCards.push(room.deck.pop());
      logRoom(room, `Turn: ${room.communityCards.slice(-1)[0]}`);
    } else if (room.state === 'TURN') {
      room.state = 'RIVER';
      room.deck.pop();
      room.communityCards.push(room.deck.pop());
      logRoom(room, `River: ${room.communityCards.slice(-1)[0]}`);
    } else if (room.state === 'RIVER') {
      showdown(room);
      return true;
    }
    return false;
  };

  const ended = dealNext();
  if (ended) return;

  if (canAct.length < 2) {
    broadcastState(room);
    setTimeout(() => advanceStage(room), 1800);
    return;
  }

  room.currentPlayerIdx = findNextToAct(room, room.dealerIdx);
  broadcastState(room);
}

function calculatePots(room) {
  const contributors = room.players.filter(p => p.totalBet > 0);
  const levels = [...new Set(contributors.map(p => p.totalBet))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const level of levels) {
    const contributing = contributors.filter(p => p.totalBet >= level);
    const amount = contributing.length * (level - prev);
    const eligible = contributing.filter(p => !p.folded).map(p => p.id);
    if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  return pots;
}

function showdown(room) {
  const pots = calculatePots(room);
  const inPlay = room.players.filter(p => p.inHand && !p.folded);

  const hands = {};
  for (const p of inPlay) {
    const allCards = [...p.cards, ...room.communityCards];
    hands[p.id] = evalBest(allCards);
  }

  const potResults = [];
  for (const pot of pots) {
    const eligible = inPlay.filter(p => pot.eligible.includes(p.id));
    if (eligible.length === 0) continue;
    let winners = [eligible[0]];
    let best = hands[eligible[0].id].score;
    for (let i = 1; i < eligible.length; i++) {
      const cmp = compareScores(hands[eligible[i].id].score, best);
      if (cmp > 0) {
        winners = [eligible[i]];
        best = hands[eligible[i].id].score;
      } else if (cmp === 0) {
        winners.push(eligible[i]);
      }
    }
    const share = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount - share * winners.length;
    for (const w of winners) w.coins += share;
    if (winners.length > 0) winners[0].coins += remainder;
    potResults.push({
      amount: pot.amount,
      winners: winners.map(w => ({
        id: w.id,
        name: w.name,
        hand: describeHand(hands[w.id].score),
        share: share + (winners[0].id === w.id ? remainder : 0),
      })),
    });
  }

  room.pot = 0;
  room.state = 'SHOWDOWN';
  room.showdownData = {
    pots: potResults,
    playerHands: inPlay.map(p => ({
      id: p.id,
      name: p.name,
      cards: p.cards,
      hand: describeHand(hands[p.id].score),
      bestCards: hands[p.id].cards,
    })),
    communityCards: [...room.communityCards],
  };

  for (const r of potResults) {
    logRoom(room, `Pot von ${fmtChf(r.amount)} CHF: ${r.winners.map(w => `${w.name} (${w.hand})`).join(', ')}`);
  }

  for (const p of room.players) p.inHand = false;

  broadcastState(room);
}

function endHandSinglePlayer(room, winner) {
  let total = room.pot;
  for (const p of room.players) {
    total += p.bet;
    p.bet = 0;
  }
  if (winner) {
    winner.coins += total;
    logRoom(room, `${winner.name} gewinnt ${fmtChf(total)} CHF (alle anderen gefoldet).`);
  }
  room.pot = 0;
  room.state = 'SHOWDOWN';
  room.showdownData = {
    pots: winner ? [{
      amount: total,
      winners: [{ id: winner.id, name: winner.name, hand: 'Alle anderen gefoldet', share: total }],
    }] : [],
    playerHands: [],
    communityCards: [...room.communityCards],
  };
  for (const p of room.players) p.inHand = false;
  broadcastState(room);
}

// ============================================================
// State broadcast
// ============================================================

function publicPlayer(pl, viewerPid, room) {
  const showCards =
    pl.id === viewerPid ||
    (room.state === 'SHOWDOWN' && !pl.folded && pl.cards.length > 0 &&
      room.showdownData && room.showdownData.playerHands.some(ph => ph.id === pl.id));
  return {
    id: pl.id,
    name: pl.name,
    coins: pl.coins,
    bet: pl.bet,
    totalBet: pl.totalBet,
    folded: pl.folded,
    allIn: pl.allIn,
    inHand: pl.inHand,
    hasActed: pl.hasActed,
    cards: showCards ? pl.cards : pl.cards.map(() => 'back'),
    cardCount: pl.cards.length,
    left: !!pl.left,
    disconnected: !!pl.disconnected,
  };
}

function broadcastState(room) {
  const total_pot = room.pot + room.players.reduce((s, p) => s + p.bet, 0);
  const base = {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    handNumber: room.handNumber,
    pot: total_pot,
    mainPot: room.pot,
    currentBet: room.currentBet,
    minRaise: room.minRaise,
    smallBlind: room.smallBlind,
    bigBlind: room.bigBlind,
    startCoins: room.startCoins,
    customStartCoins: room.customStartCoins,
    dealerIdx: room.dealerIdx,
    sbIdx: typeof room.sbIdx === 'number' ? room.sbIdx : -1,
    bbIdx: typeof room.bbIdx === 'number' ? room.bbIdx : -1,
    currentPlayerIdx: room.currentPlayerIdx,
    communityCards: room.communityCards,
    showdownData: room.showdownData,
    logs: room.logs.slice(-20),
  };
  for (const viewer of room.players) {
    if (!viewer.socketId) continue;
    const payload = {
      ...base,
      youId: viewer.id,
      players: room.players.map(p => publicPlayer(p, viewer.id, room)),
    };
    io.to(viewer.socketId).emit('gameState', payload);
  }
}

// ============================================================
// Socket events
// ============================================================

io.on('connection', (socket) => {
  const auth = socket.handshake && socket.handshake.auth ? socket.handshake.auth : {};
  const handshakePid = auth.persistentId;
  console.log('connected', socket.id, handshakePid ? `[pid:${handshakePid.slice(0,8)}]` : '');

  socket.on('createRoom', ({ name, startCoins, smallBlind, bigBlind, persistentId, visibility }, cb) => {
    name = (name || '').trim().substring(0, 20);
    const pid = persistentId || handshakePid || ('s_' + socket.id);
    if (!name) return cb && cb({ error: 'Name fehlt' });
    // All amounts are handled in Rappen (integer cents). Client converts CHF
    // decimal input → Rappen before sending. Big enough ceiling for house
    // games; small enough floor that 1 Rappen = smallest game legal.
    const sc = Math.max(100, Math.min(1000000, Math.round(Number(startCoins)) || 5000));
    const sb = Math.max(1, Math.min(100000, Math.round(Number(smallBlind)) || 20));
    const bb = Math.max(sb + 1, Math.min(200000, Math.round(Number(bigBlind)) || sb * 2));
    const vis = visibility === 'public' ? 'public' : 'private';
    const room = createRoom(pid, socket.id, name, { startCoins: sc, smallBlind: sb, bigBlind: bb, visibility: vis });
    socket.join(room.code);
    logRoom(room, `${name} hat den Raum erstellt (${vis === 'public' ? 'öffentlich' : 'privat'}).`);
    if (cb) cb({ ok: true, code: room.code, assignedId: pid, visibility: room.visibility });
    broadcastState(room);
    if (room.visibility === 'public') broadcastLobby();
  });

  // Lobby — list of open public rooms, with live updates.
  socket.on('joinLobby', (_, cb) => {
    socket.join(LOBBY_ROOM);
    if (cb) cb({ ok: true, rooms: listPublicRooms() });
  });
  socket.on('leaveLobby', () => {
    socket.leave(LOBBY_ROOM);
  });
  socket.on('listPublicRooms', (_, cb) => {
    if (cb) cb({ rooms: listPublicRooms() });
  });

  socket.on('joinRoom', ({ name, code, persistentId }, cb) => {
    name = (name || '').trim().substring(0, 20);
    code = (code || '').trim().toUpperCase();
    const pid = persistentId || handshakePid || ('s_' + socket.id);
    if (!name) return cb && cb({ error: 'Name fehlt' });
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: 'Raum nicht gefunden' });
    const res = addPlayer(room, pid, socket.id, name);
    if (res.error) return cb && cb({ error: res.error });
    socket.join(room.code);
    if (res.reconnect) {
      logRoom(room, `${name} ist zurück (reconnect).`);
    } else {
      logRoom(room, `${name} ist dem Raum beigetreten.`);
    }
    // assignedId = the pid the server actually stored for this player. It may
    // differ from what the client sent if we detected a tab/pid collision and
    // fell through to a fresh join with a derived id.
    const assignedId = res.player ? res.player.id : pid;
    if (cb) cb({ ok: true, code: room.code, reconnect: !!res.reconnect, assignedId });
    broadcastState(room);
    if (room.visibility === 'public') broadcastLobby();
  });

  // Soft reconnect (client re-entering game screen on page load)
  socket.on('reconnectRoom', ({ name, code, persistentId }, cb) => {
    name = (name || '').trim().substring(0, 20);
    code = (code || '').trim().toUpperCase();
    const pid = persistentId || handshakePid;
    if (!pid) return cb && cb({ error: 'Keine persistentId' });
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: 'Raum nicht mehr vorhanden' });
    const existing = room.players.find(p => p.id === pid);
    if (!existing) return cb && cb({ error: 'Spieler nicht im Raum' });
    existing.socketId = socket.id;
    existing.disconnected = false;
    if (existing._disconnectTimer) { clearTimeout(existing._disconnectTimer); existing._disconnectTimer = null; }
    socketToRoom.set(socket.id, room.code);
    socketToPid.set(socket.id, pid);
    socket.join(room.code);
    logRoom(room, `${existing.name} ist wieder da.`);
    if (cb) cb({ ok: true, code: room.code });
    broadcastState(room);
  });

  socket.on('startHand', (_, cb) => {
    const { room, player } = findBySocket(socket.id);
    if (!room || !player) return cb && cb({ error: 'Kein Raum' });
    if (room.hostId !== player.id) return cb && cb({ error: 'Nur der Host kann starten' });
    if (room.state !== 'WAITING' && room.state !== 'SHOWDOWN') {
      return cb && cb({ error: 'Runde läuft bereits' });
    }
    if (room.players.filter(p => p.coins > 0 && !p.left && !p.disconnected).length < 2) {
      return cb && cb({ error: 'Mindestens 2 (verbundene) Spieler mit Coins benötigt' });
    }
    startHand(room);
    if (cb) cb({ ok: true });
  });

  socket.on('action', ({ action, amount }, cb) => {
    const { room, player } = findBySocket(socket.id);
    if (!room || !player) return cb && cb({ error: 'Kein Raum' });
    const res = handleAction(room, player.id, action, amount);
    if (res && res.error) return cb && cb(res);
    if (cb) cb({ ok: true });
  });

  socket.on('hostSetCoins', ({ playerId, coins }, cb) => {
    const { room, player } = findBySocket(socket.id);
    if (!room || !player) return cb && cb({ error: 'Kein Raum' });
    if (room.hostId !== player.id) return cb && cb({ error: 'Nur Host' });
    if (room.state !== 'WAITING' && room.state !== 'SHOWDOWN') {
      return cb && cb({ error: 'Nur zwischen Runden möglich' });
    }
    const p = room.players.find(pl => pl.id === playerId);
    if (!p) return cb && cb({ error: 'Spieler nicht gefunden' });
    const amt = Math.max(0, Math.min(10000000, Math.round(Number(coins)) || 0));
    p.coins = amt;
    logRoom(room, `Host setzt Guthaben von ${p.name} auf ${fmtChf(amt)} CHF.`);
    broadcastState(room);
    if (cb) cb({ ok: true });
  });

  socket.on('hostGiveCoins', ({ playerId, amount }, cb) => {
    const { room, player } = findBySocket(socket.id);
    if (!room || !player) return cb && cb({ error: 'Kein Raum' });
    if (room.hostId !== player.id) return cb && cb({ error: 'Nur Host' });
    if (room.state !== 'WAITING' && room.state !== 'SHOWDOWN') {
      return cb && cb({ error: 'Nur zwischen Runden möglich' });
    }
    const p = room.players.find(pl => pl.id === playerId);
    if (!p) return cb && cb({ error: 'Spieler nicht gefunden' });
    const amt = Math.max(1, Math.min(10000000, Math.round(Number(amount)) || 0));
    p.coins += amt;
    logRoom(room, `Host gibt ${p.name} ${fmtChf(amt)} CHF (neu: ${fmtChf(p.coins)}).`);
    broadcastState(room);
    if (cb) cb({ ok: true });
  });

  socket.on('hostSetBlinds', ({ smallBlind, bigBlind }, cb) => {
    const { room, player } = findBySocket(socket.id);
    if (!room || !player) return cb && cb({ error: 'Kein Raum' });
    if (room.hostId !== player.id) return cb && cb({ error: 'Nur Host' });
    if (room.state !== 'WAITING' && room.state !== 'SHOWDOWN') {
      return cb && cb({ error: 'Nur zwischen Runden möglich' });
    }
    const sb = Math.max(1, Math.min(100000, Math.round(Number(smallBlind)) || room.smallBlind));
    const bb = Math.max(sb + 1, Math.min(200000, Math.round(Number(bigBlind)) || sb * 2));
    room.smallBlind = sb;
    room.bigBlind = bb;
    logRoom(room, `Host setzt Blinds auf ${fmtChf(sb)}/${fmtChf(bb)} CHF.`);
    broadcastState(room);
    if (cb) cb({ ok: true });
  });

  socket.on('chat', ({ text }) => {
    const { room, player } = findBySocket(socket.id);
    if (!room || !player) return;
    const clean = String(text || '').substring(0, 200);
    if (!clean) return;
    io.to(room.code).emit('chat', { name: player.name, text: clean, ts: Date.now() });
  });

  socket.on('leaveRoom', () => {
    const { room, player } = findBySocket(socket.id);
    if (room && player) forceLeave(room, player);
    socketToRoom.delete(socket.id);
    socketToPid.delete(socket.id);
  });

  socket.on('disconnect', () => {
    console.log('disconnected', socket.id);
    handleDisconnect(socket.id);
  });
});

// ============================================================
// Periodic cleanup: drop empty rooms >2h old
// ============================================================
setInterval(() => {
  const now = Date.now();
  let publicChanged = false;
  for (const [code, room] of rooms) {
    const wasPublic = room.visibility === 'public';
    if (room.players.length === 0) {
      rooms.delete(code);
      if (wasPublic) publicChanged = true;
    } else if (now - room.createdAt > 12 * 3600 * 1000 && room.players.every(p => p.disconnected || p.left)) {
      rooms.delete(code);
      if (wasPublic) publicChanged = true;
      console.log(`Cleaned up stale room ${code}`);
    }
  }
  if (publicChanged) broadcastLobby();
}, 60 * 1000);

// ============================================================
// Start server
// ============================================================

server.listen(PORT, () => {
  console.log(`🎰 Tokenburger Kameraden Poker Server läuft auf Port ${PORT}`);
});
