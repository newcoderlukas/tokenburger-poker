// Smoke test — public/private room visibility & lobby broadcasts.
//
// Scenario:
//   1. Host A creates a PRIVATE room.
//   2. Host B creates a PUBLIC room.
//   3. A lobby-watcher (observer O) calls `joinLobby` and should see ONLY B's room.
//   4. Host C creates a second PUBLIC room.
//   5. O should receive a `lobbyUpdate` listing both public rooms (not A's private).
//   6. A joiner D uses the lobby listing to `joinRoom` directly by B's code.
//   7. After D joins, O should get an updated broadcast showing 2 players in B.
//   8. B's host disconnects/leaves — room should eventually disappear from lobby.
//
// Requires the server running at http://localhost:3792

const { io } = require('socket.io-client');
const URL = 'http://localhost:3792';
const wait = ms => new Promise(r => setTimeout(r, ms));

function waitFor(pred, timeout = 3000, label = 'condition') {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const int = setInterval(() => {
      try {
        if (pred()) { clearInterval(int); resolve(); }
        else if (Date.now() - start > timeout) {
          clearInterval(int);
          reject(new Error('timeout waiting for ' + label));
        }
      } catch (e) { clearInterval(int); reject(e); }
    }, 40);
  });
}

function pid(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function assert(cond, msg) {
  if (!cond) { throw new Error('ASSERT FAIL: ' + msg); }
  console.log('  ✓', msg);
}

async function main() {
  const pidA = pid('A');
  const pidB = pid('B');
  const pidC = pid('C');
  const pidD = pid('D');
  const pidO = pid('O');

  const A = io(URL, { auth: { persistentId: pidA } });
  const B = io(URL, { auth: { persistentId: pidB } });
  const C = io(URL, { auth: { persistentId: pidC } });
  const D = io(URL, { auth: { persistentId: pidD } });
  const O = io(URL, { auth: { persistentId: pidO } });

  let lobbySnapshots = [];
  O.on('lobbyUpdate', payload => { lobbySnapshots.push(payload); });

  await wait(150);

  console.log('\n[1] A creates a PRIVATE room');
  const aRes = await new Promise(r =>
    A.emit('createRoom', { name: 'Alice', persistentId: pidA, visibility: 'private' }, r));
  assert(!aRes.error, 'A.createRoom ok');
  assert(aRes.visibility === 'private', 'A visibility is private');

  console.log('\n[2] B creates a PUBLIC room');
  const bRes = await new Promise(r =>
    B.emit('createRoom', { name: 'Bob', persistentId: pidB, visibility: 'public' }, r));
  assert(!bRes.error, 'B.createRoom ok');
  assert(bRes.visibility === 'public', 'B visibility is public');

  console.log('\n[3] Observer O joins the lobby → should see only B');
  const joinRes = await new Promise(r => O.emit('joinLobby', {}, r));
  assert(joinRes && joinRes.ok, 'joinLobby ok');
  const firstList = joinRes.rooms;
  assert(Array.isArray(firstList), 'rooms array returned');
  const codesInit = firstList.map(r => r.code);
  assert(codesInit.includes(bRes.code), 'B in initial lobby');
  assert(!codesInit.includes(aRes.code), 'A NOT in initial lobby (private)');

  console.log('\n[4] C creates a second PUBLIC room — expect broadcast');
  lobbySnapshots = [];
  const cRes = await new Promise(r =>
    C.emit('createRoom', { name: 'Carol', persistentId: pidC, visibility: 'public' }, r));
  assert(!cRes.error, 'C.createRoom ok');
  await waitFor(() => lobbySnapshots.length >= 1, 2000, 'lobbyUpdate after C create');
  const afterC = lobbySnapshots[lobbySnapshots.length - 1];
  const codesAfterC = afterC.rooms.map(r => r.code);
  assert(codesAfterC.includes(bRes.code) && codesAfterC.includes(cRes.code),
    'lobby contains both B and C');
  assert(!codesAfterC.includes(aRes.code), 'A still NOT in lobby (private)');

  console.log('\n[5] D joins B directly using lobby listing');
  lobbySnapshots = [];
  const dRes = await new Promise(r =>
    D.emit('joinRoom', { name: 'Dan', code: bRes.code, persistentId: pidD }, r));
  assert(!dRes.error, 'D.joinRoom ok');
  await waitFor(() => lobbySnapshots.length >= 1, 2000, 'lobbyUpdate after D join');
  const afterD = lobbySnapshots[lobbySnapshots.length - 1];
  const bInfo = afterD.rooms.find(r => r.code === bRes.code);
  assert(bInfo && bInfo.playerCount === 2, "B now shows 2 players in lobby");

  console.log('\n[6] Summary fields sanity-check');
  assert(typeof bInfo.hostName === 'string' && bInfo.hostName.length > 0, 'hostName present');
  assert(typeof bInfo.smallBlind === 'number', 'smallBlind present');
  assert(typeof bInfo.bigBlind === 'number', 'bigBlind present');
  assert(typeof bInfo.startCoins === 'number', 'startCoins present');
  assert(typeof bInfo.maxPlayers === 'number', 'maxPlayers present');
  assert(typeof bInfo.state === 'string', 'state string present');

  console.log('\n[7] leaveLobby — O should stop receiving updates');
  await new Promise(r => { O.emit('leaveLobby'); setTimeout(r, 100); });
  lobbySnapshots = [];
  // Create another public room to prove O is no longer listening
  const e = io(URL, { auth: { persistentId: pid('E') } });
  await wait(100);
  await new Promise(r => e.emit('createRoom', { name: 'Eve', visibility: 'public' }, r));
  await wait(300);
  assert(lobbySnapshots.length === 0, 'O got no updates after leaveLobby');
  e.close();

  console.log('\n[8] listPublicRooms one-shot query returns current list');
  const snap = await new Promise(r => O.emit('listPublicRooms', {}, r));
  assert(Array.isArray(snap.rooms), 'one-shot returned array');
  assert(snap.rooms.every(r => r.code !== aRes.code), 'A not in one-shot list');

  console.log('\nALL_OK');
  [A, B, C, D, O].forEach(s => s.close());
  await wait(80);
  process.exit(0);
}

main().catch(e => { console.error('FAIL:', e.message); console.error(e.stack); process.exit(1); });
