// Smoke test: reconnect support
const { io } = require('socket.io-client');
const URL = 'http://localhost:3790';
const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const pidA = 'pid_alice_' + Date.now();
  const pidB = 'pid_bob_' + Date.now();

  let a = io(URL, { auth: { persistentId: pidA } });
  const b = io(URL, { auth: { persistentId: pidB } });

  let lastA = null, lastB = null;
  a.on('gameState', s => { lastA = s; });
  b.on('gameState', s => { lastB = s; });

  await wait(200);

  const createRes = await new Promise(r => a.emit('createRoom', { name: 'Alice', startCoins: 100, smallBlind: 5, bigBlind: 10, persistentId: pidA }, r));
  console.log('create:', createRes);

  const joinRes = await new Promise(r => b.emit('joinRoom', { name: 'Bob', code: createRes.code, persistentId: pidB }, r));
  console.log('join:', joinRes);

  await wait(100);
  const startRes = await new Promise(r => a.emit('startHand', {}, r));
  console.log('startHand:', startRes);
  await wait(100);
  console.log('Before disconnect — Alice id:', lastA.players.find(p => p.name === 'Alice').id);
  console.log('State:', lastA.state);

  // Simulate Alice losing connection
  console.log('--- Alice disconnects ---');
  a.close();
  await wait(500);

  console.log('Bob sees Alice:', lastB.players.find(p => p.name === 'Alice'));
  const aliceOnB = lastB.players.find(p => p.name === 'Alice');
  if (!aliceOnB || !aliceOnB.disconnected) {
    console.error('FAIL: Alice should be marked disconnected on Bob');
    process.exit(1);
  }
  console.log('OK: Alice shown as disconnected');

  // Reconnect Alice with same pid
  console.log('--- Alice reconnects with same pid ---');
  a = io(URL, { auth: { persistentId: pidA } });
  a.on('gameState', s => { lastA = s; });
  await wait(300);

  const rcRes = await new Promise(r => a.emit('reconnectRoom', { name: 'Alice', code: createRes.code, persistentId: pidA }, r));
  console.log('reconnectRoom:', rcRes);
  await wait(200);

  if (!rcRes.ok) {
    console.error('FAIL: reconnect failed');
    process.exit(1);
  }

  const aliceOnBAfter = lastB.players.find(p => p.name === 'Alice');
  if (aliceOnBAfter.disconnected) {
    console.error('FAIL: Alice should no longer be disconnected after reconnect');
    process.exit(1);
  }
  console.log('OK: Alice is reconnected, can see her own cards:', lastA.players.find(p => p.name === 'Alice').cards);

  // Alice can still act
  const currIdx = lastA.currentPlayerIdx;
  const currName = lastA.players[currIdx].name;
  console.log('Current turn:', currName);
  if (currName === 'Alice') {
    const toCall = lastA.currentBet - lastA.players[currIdx].bet;
    const action = toCall > 0 ? 'call' : 'check';
    const res = await new Promise(r => a.emit('action', { action }, r));
    console.log(`Alice acted (${action}):`, res);
  }

  console.log('ALL_OK');
  a.close();
  b.close();
  await wait(100);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
