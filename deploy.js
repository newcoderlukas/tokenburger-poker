#!/usr/bin/env node
// Deploy-Skript: lädt alle Dateien via FTPS auf den Infomaniak-Server
//
// Benutzung:
//   1. Abhängigkeiten installieren:   npm install
//   2. .env Datei anlegen (siehe .env.example) mit FTP_PASSWORD
//   3. Ausführen:                     npm run deploy
//
// Was wird hochgeladen?  Alles außer node_modules, .git, .env und dieser Script.
// Die Abhängigkeiten werden nach dem Upload auf dem Server per `npm install` installiert
// (siehe DEPLOY.md).

const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ---- Konfiguration ----
// Werte können via .env oder Umgebungsvariablen überschrieben werden.
loadEnv();

const CONFIG = {
  host: process.env.FTP_HOST || 'st5jy9.ftp.infomaniak.com',
  user: process.env.FTP_USER || 'st5jy9_lukas',
  password: process.env.FTP_PASSWORD || '',
  secure: true,              // FTPS (TLS) — Infomaniak unterstützt das
  remoteRoot: process.env.FTP_REMOTE_ROOT || '/sites/toggipoker777.ch/',
  localRoot: __dirname,
  // Pfade die NICHT hochgeladen werden:
  ignore: [
    'node_modules',
    '.git',
    '.env',
    '.env.local',
    '.DS_Store',
    'deploy.js',          // das Skript selbst nicht
    'test-smoke.js',      // Smoketest nicht
    'package-lock.json',  // auf Wunsch entfernen - verwenden beim npm install auf Server
  ],
};

async function main() {
  // Passwort zur Not interaktiv abfragen
  if (!CONFIG.password) {
    CONFIG.password = await prompt('FTP-Passwort für ' + CONFIG.user + ': ', true);
  }
  if (!CONFIG.password) {
    console.error('❌ Kein Passwort angegeben.');
    process.exit(1);
  }

  const client = new ftp.Client(30000);
  client.ftp.verbose = false;

  console.log(`\n🔐 Verbinde zu ${CONFIG.host} als ${CONFIG.user} (FTPS)…`);
  try {
    await client.access({
      host: CONFIG.host,
      user: CONFIG.user,
      password: CONFIG.password,
      secure: CONFIG.secure,
      secureOptions: { rejectUnauthorized: false },
    });
    console.log('✅ Verbunden.');

    // Ziel-Ordner sicherstellen und hinwechseln
    console.log(`📁 Wechsle in ${CONFIG.remoteRoot}`);
    await client.ensureDir(CONFIG.remoteRoot);

    // Upload
    console.log(`\n📤 Lade Dateien hoch…\n`);
    let counter = { files: 0, bytes: 0 };
    await uploadDir(client, CONFIG.localRoot, CONFIG.remoteRoot, counter);

    console.log(`\n✅ Fertig! ${counter.files} Dateien (${(counter.bytes / 1024).toFixed(1)} KB) hochgeladen.`);
    console.log(`\n👉 Nächste Schritte:`);
    console.log(`   1. Im Infomaniak-Manager Node.js aktivieren (siehe DEPLOY.md)`);
    console.log(`   2. Per SSH auf dem Server:  cd /sites/toggenburgerkamaraden.ch && npm install`);
    console.log(`   3. Node.js-App im Manager starten (Startdatei: server.js)`);
  } catch (err) {
    console.error('\n❌ Fehler:', err.message);
    process.exit(1);
  } finally {
    client.close();
  }
}

// ---- Hilfsfunktionen ----

function shouldIgnore(relPath) {
  const parts = relPath.split(path.sep);
  return CONFIG.ignore.some(ig => parts.includes(ig) || relPath === ig);
}

async function uploadDir(client, localDir, remoteDir, counter) {
  const items = fs.readdirSync(localDir, { withFileTypes: true });
  // Stelle sicher, dass Ziel-Ordner existiert
  try {
    await client.ensureDir(remoteDir);
  } catch (_) { /* ignore */ }

  for (const item of items) {
    const localPath = path.join(localDir, item.name);
    const rel = path.relative(CONFIG.localRoot, localPath);
    if (shouldIgnore(rel)) {
      console.log(`  ⊘  ${rel}  (ignoriert)`);
      continue;
    }
    const remotePath = posixJoin(remoteDir, item.name);
    if (item.isDirectory()) {
      console.log(`  📂 ${rel}/`);
      await uploadDir(client, localPath, remotePath, counter);
    } else if (item.isFile()) {
      const size = fs.statSync(localPath).size;
      process.stdout.write(`  ⬆  ${rel}  (${formatBytes(size)})… `);
      await client.uploadFrom(localPath, remotePath);
      counter.files++;
      counter.bytes += size;
      process.stdout.write('ok\n');
    }
  }
}

function posixJoin(...parts) {
  return parts.join('/').replace(/\/+/g, '/');
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) {
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  }
}

function prompt(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      // Passwort-Eingabe maskieren
      const stdin = process.stdin;
      stdin.setRawMode && stdin.setRawMode(true);
      process.stdout.write(question);
      let buf = '';
      stdin.resume();
      stdin.setEncoding('utf8');
      const onData = (ch) => {
        ch = String(ch);
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          stdin.setRawMode && stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(buf);
        } else if (ch === '\u0003') { // Ctrl+C
          process.exit(0);
        } else if (ch === '\u007f' || ch === '\b') {
          if (buf.length > 0) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); }
        } else {
          buf += ch;
          process.stdout.write('*');
        }
      };
      stdin.on('data', onData);
    } else {
      rl.question(question, (a) => { rl.close(); resolve(a); });
    }
  });
}

main();
