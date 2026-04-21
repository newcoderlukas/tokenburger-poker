// Smoke test for the mid-round-join bug fix.
// Scenario:
//   1. Alice creates a room, Bob joins. (2 players)
//   2. Alice starts Hand 1. Game is in PREFLOP.
//   3. During Hand 1, Charlie joins with a DIFFERENT persistentId. (3 players)
//   4. Hand 1 finishes (both fold or check).
//   5. Alice starts Hand 2.
//   6. Expect: Charlie should be in-hand (have cards) in Hand 2.
//
// Additionally, we test the collision safety net:
//   7. A 4th client connects with Alice's persistentId (simulating a 2nd tab in
//      the same browser) and tries to joinRoom with a different name.
//   8. Expect: server detects collision, assigns a unique id, and Charlie/Alice
//      are NOT affected.

const { io } = require('socket.io-client');
const URL = 'http://localhost:3791';
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
  const pidA = 'pid_alice_' + Date.now();
  const pidB = 'pid_bob_' + Date.now();
  const pidC = 'pid_charlie_' + Date.now();

  const a = io(URL, { auth: { persistentId: pidA } });
  const b = io(URL, { auth: { persistentId: pidB } });

  let lastA = null, lastB = null;
  a.on('gameState', s => { lastA = s; });
  b.on('gameState', s => { lastB = s; });

  await wait(150);

  const createRes = await new Promise(r =>
    a.emit('createRoom', { name: 'Alice', startCoins: 200, smallBlind: 5, bigBlind: 10, persistentId: pidA }, r));
  console.log('create:', createRes);

  const joinB = await new Promise(r =>
    b.emit('joinRoom', { name: 'Bob', code: createRes.code, persistentId: pidB }, r));
  console.log('Bob join:', joinB);

  await wait(100);

  // Start hand 1
  const startRes = await new Promise(r => a.emit('startHand', {}, r));
  console.log('startHand 1:', startRes);
  await waitFor(() => lastA && lastA.state === 'PREFLOP');
  console.log('Hand 1 preflop — Alice cards:',
    lastA.players.find(p => p.name === 'Alice').cards);
  console.log('Players at hand 1 start:', lastA.players.map(p => `${p.name}(inHand=${p.inHand})`));

  // --- Charlie joins MID-ROUND ---
  console.log('\n--- Charlie joins mid-round ---');
  const c = io(URL, { auth: { persistentId: pidC } });
  let lastC = null;
  c.on('gameState', s => { lastC = s; });
  await wait(150);
  const joinC = await new Promise(r =>
    c.emit('joinRoom', { name: 'Charlie', code: createRes.code, persistentId: pidC }, r));
  console.log('Charlie join:', joinC);
  if (!joinC.ok) throw new Error('Charlie join failed');

  await wait(150);
  const charlieInHand1 = lastA.players.find(p => p.name === 'Charlie');
  console.log('Charlie during hand 1:', charlieInHand1);
  if (!charlieInHand1) throw new Error('FAIL: Charlie not visible in room after mid-round join');
  if (charlieInHand1.inHand) throw new Error('FAIL: Charlie should NOT be inHand during current hand');
  console.log('OK: Charlie is in room but not inHand for hand 1');

  // --- Collision test: 4th client tries to join with Alice's pid ---
  console.log('\n--- Collision test: 2nd tab with Alice\'s pid joins as "Dora" ---');
  const d = io(URL, { auth: { persistentId: pidA } }); // SAME as Alice
  let lastD = null;
  d.on('gameState', s => { lastD = s; });
  await wait(150);
  const joinD = await new Promise(r =>
    d.emit('joinRoom', { name: 'Dora', code: createRes.code, persistentId: pidA }, r));
  console.log('Dora join:', joinD);
  if (!joinD.ok) throw new Error('FAIL: Dora (collision-case) should have been allowed as fresh join');
  if (joinD.assignedId === pidA) {
    throw new Error('FAIL: server did NOT detect collision — Dora got the same id as Alice');
  }
  console.log('OK: Dora got a derived unique id:', joinD.assignedId);

  await wait(150);
  const alice = lastA.players.find(p => p.name === 'Alice');
  const dora = lastA.players.find(p => p.name === 'Dora');
  if (!alice) throw new Error('FAIL: Alice disappeared after collision');
  if (!dora) throw new Error('FAIL: Dora not added as separate player');
  if (alice.id === dora.id) throw new Error('FAIL: Alice and Dora share the same id');
  console.log('OK: Alice and Dora coexist with distinct ids');

  // --- Finish hand 1 quickly: Alice & Bob fold/call to get to showdown ---
  // Heads-up preflop: dealer (sb) acts first.
  console.log('\n--- Finishing hand 1 ---');
  async function actFor(state, name) {
    const curIdx = state.currentPlayerIdx;
    const curName = state.players[curIdx]?.name;
    if (curName !== name) return false;
    const me = state.players[curIdx];
    const toCall = state.currentBet - me.bet;
    const action = toCall > 0 ? 'call' : 'check';
    const sock = name === 'Alice' ? a : (name === 'Bob' ? b : null);
    if (!sock) return false;
    await new Promise(r => sock.emit('action', { action }, r));
    return true;
  }
  for (let i = 0; i < 20; i++) {
    await wait(120);
    if (!lastA) continue;
    if (lastA.state === 'SHOWDOWN') break;
    await actFor(lastA, 'Alice');
    await actFor(lastA, 'Bob');
  }
  await waitFor(() => lastA && lastA.state === 'SHOWDOWN');
  console.log('Hand 1 done. State:', lastA.state);

  // --- Start Hand 2 — Charlie MUST be dealt cards ---
  console.log('\n--- Starting hand 2 ---');
  const start2 = await new Promise(r => a.emit('startHand', {}, r));
  console.log('startHand 2:', start2);
  await waitFor(() => lastA && lastA.state === 'PREFLOP');

  const charlieInHand2 = lastA.players.find(p => p.name === 'Charlie');
  console.log('Charlie in hand 2:', {
    inHand: charlieInHand2.inHand,
    cardCount: charlieInHand2.cardCount,
    coins: charlieInHand2.coins,
  });
  if (!charlieInHand2.inHand) throw new Error('FAIL: Charlie not inHand for hand 2 — THIS IS THE BUG');
  if (charlieInHand2.cardCount !== 2) throw new Error('FAIL: Charlie did not get 2 cards in hand 2');

  // Charlie should be able to see his own cards
  const charlieSelf = lastC.players.find(p => p.name === 'Charlie');
  if (!charlieSelf.cards || charlieSelf.cards.length !== 2 || charlieSelf.cards[0] === 'back') {
    throw new Error('FAIL: Charlie can\'t see his own cards in hand 2');
  }
  console.log('OK: Charlie has cards in hand 2:', charlieSelf.cards);

  console.log('\nALL_OK');
  a.close(); b.close(); c.close(); d.close();
  await wait(100);
  process.exit(0);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
