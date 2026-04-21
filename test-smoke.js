// Smoke test: simulate 2 players creating a room and playing a hand
const { io } = require('socket.io-client');

const URL = 'http://localhost:3789';

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const a = io(URL);
  const b = io(URL);

  let lastA = null, lastB = null;
  a.on('gameState', s => { lastA = s; });
  b.on('gameState', s => { lastB = s; });

  await wait(300);

  const createRes = await new Promise(r => a.emit('createRoom', { name: 'Alice', startCoins: 100, smallBlind: 5, bigBlind: 10 }, r));
  console.log('create:', createRes);

  const joinRes = await new Promise(r => b.emit('joinRoom', { name: 'Bob', code: createRes.code }, r));
  console.log('join:', joinRes);

  await wait(100);
  console.log('Players in room:', lastA.players.map(p => `${p.name}(${p.coins})`));

  // Start hand (as host = Alice)
  const startRes = await new Promise(r => a.emit('startHand', {}, r));
  console.log('startHand:', startRes);
  await wait(100);
  console.log('State:', lastA.state, 'pot:', lastA.pot, 'currentBet:', lastA.currentBet);
  console.log('Alice cards:', lastA.players.find(p => p.name === 'Alice').cards);
  console.log('Bob cards:', lastB.players.find(p => p.name === 'Bob').cards);

  // Heads-up preflop: dealer (SB) acts first
  const myIdxA = lastA.players.findIndex(p => p.name === 'Alice');
  const myIdxB = lastB.players.findIndex(p => p.name === 'Bob');

  // Whoever is currentPlayer, call
  async function actFor(current, name) {
    const currIdx = current.currentPlayerIdx;
    const currName = current.players[currIdx].name;
    const me = current.players.find(p => p.name === name);
    if (currName !== name) return false;
    const toCall = current.currentBet - me.bet;
    const action = toCall > 0 ? 'call' : 'check';
    const sock = name === 'Alice' ? a : b;
    const res = await new Promise(r => sock.emit('action', { action }, r));
    console.log(`  ${name} ${action}:`, res);
    return true;
  }

  for (let turn = 0; turn < 16; turn++) {
    await wait(100);
    if (!lastA) continue;
    if (lastA.state === 'SHOWDOWN') {
      console.log('--- SHOWDOWN ---');
      console.log('community:', lastA.communityCards);
      console.log('pots:', JSON.stringify(lastA.showdownData.pots, null, 2));
      console.log('hands:', JSON.stringify(lastA.showdownData.playerHands, null, 2));
      console.log('final coins:', lastA.players.map(p => `${p.name}=${p.coins}`));
      break;
    }
    console.log(`[turn ${turn}] state=${lastA.state} pot=${lastA.pot} currentIdx=${lastA.currentPlayerIdx} (${lastA.players[lastA.currentPlayerIdx]?.name})`);
    const actedA = await actFor(lastA, 'Alice');
    if (!actedA) await actFor(lastA, 'Bob');
  }

  a.close();
  b.close();
  await wait(100);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
