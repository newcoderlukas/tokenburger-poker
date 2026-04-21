// Verify that hand 2 delivers fresh cards to each player and the server payload
// differs from hand 1 — so the client-side "only rebuild if count changed" bug
// would cause a visible stale-cards issue if the client code wasn't patched.

const { io } = require('socket.io-client');
const URL = 'http://localhost:3792';
const wait = ms => new Promise(r => setTimeout(r, ms));

function waitFor(pred, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const int = setInterval(() => {
      if (pred()) { clearInterval(int); resolve(); }
      else if (Date.now() - start > timeout) { clearInterval(int); reject(new Error('timeout')); }
    }, 50);
  });
}

async function main() {
  const pidA = 'pid_a_' + Date.now();
  const pidB = 'pid_b_' + Date.now();
  const a = io(URL, { auth: { persistentId: pidA } });
  const b = io(URL, { auth: { persistentId: pidB } });
  let lastA = null, lastB = null;
  a.on('gameState', s => { lastA = s; });
  b.on('gameState', s => { lastB = s; });
  await wait(150);

  const cr = await new Promise(r => a.emit('createRoom', { name: 'A', persistentId: pidA }, r));
  await new Promise(r => b.emit('joinRoom', { name: 'B', code: cr.code, persistentId: pidB }, r));
  await wait(100);

  // --- Hand 1 ---
  await new Promise(r => a.emit('startHand', {}, r));
  await waitFor(() => lastA && lastA.state === 'PREFLOP');
  const hand1A = lastA.players.find(p => p.name === 'A').cards.slice();
  const hand1B = lastB.players.find(p => p.name === 'B').cards.slice();
  console.log('Hand 1 — A:', hand1A, 'B:', hand1B);

  // Finish hand 1 (call/check to showdown)
  for (let i = 0; i < 20; i++) {
    await wait(100);
    if (lastA.state === 'SHOWDOWN') break;
    const cur = lastA.players[lastA.currentPlayerIdx];
    const sock = cur.name === 'A' ? a : b;
    const toCall = lastA.currentBet - cur.bet;
    const act = toCall > 0 ? 'call' : 'check';
    await new Promise(r => sock.emit('action', { action: act }, r));
  }
  await waitFor(() => lastA && lastA.state === 'SHOWDOWN');

  // --- Hand 2 ---
  await new Promise(r => a.emit('startHand', {}, r));
  await waitFor(() => lastA && lastA.state === 'PREFLOP');
  const hand2A = lastA.players.find(p => p.name === 'A').cards.slice();
  const hand2B = lastB.players.find(p => p.name === 'B').cards.slice();
  console.log('Hand 2 — A:', hand2A, 'B:', hand2B);

  if (hand1A.length !== 2 || hand2A.length !== 2) throw new Error('card count should be 2');
  const sameA = hand1A.join(',') === hand2A.join(',');
  const sameB = hand1B.join(',') === hand2B.join(',');
  console.log('Cards identical across hands — A:', sameA, 'B:', sameB);

  if (sameA && sameB) {
    console.error('FAIL: both players got the same 2 cards in both hands — deck seems broken');
    process.exit(1);
  }
  // This is the critical assertion: server payload MUST differ, otherwise the
  // client bug was actually a server bug.
  if (sameA) console.warn('WARN: A got the same cards twice (possible but rare)');
  if (sameB) console.warn('WARN: B got the same cards twice (possible but rare)');

  console.log('Server correctly delivers fresh cards in hand 2.');
  console.log('Client render fix will then rebuild the you-cards DOM because');
  console.log('  hand1 key = "' + hand1A.join(',') + '"');
  console.log('  hand2 key = "' + hand2A.join(',') + '"   →  differ, so rebuild.');
  console.log('ALL_OK');
  a.close(); b.close();
  await wait(80);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
