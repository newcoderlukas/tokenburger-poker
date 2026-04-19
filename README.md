# Tokenburger Kameraden Poker

Multiplayer-Poker (Texas Hold'em) für Freunde — jeder von zuhause, vom Handy, ohne Geld.
Bis zu **7 Spieler** pro Raum. Ein Host legt Start-Coins und Blinds fest und kann pleite-Spielern jederzeit Coins nachgeben.

## Features

- Echtzeit-Multiplayer über Socket.io
- Texas Hold'em: Blinds, Preflop/Flop/Turn/River, Showdown
- Korrekte Side-Pots bei All-Ins
- Mobile-first UI, läuft in jedem Handy-Browser
- Name-Login (kein Passwort, einfach und schnell)
- Host-Kontrollen: Coins setzen/nachgeben, Blinds ändern
- Chat und Rundenverlauf im Drawer
- Auto-Fold bei Verbindungsabbruch
- Host-Übertragung wenn Host den Raum verlässt

## Lokal starten

Voraussetzung: **Node.js 18+** installiert.

```bash
cd tokenburger-poker
npm install
npm start
```

Dann im Browser öffnen: `http://localhost:3000`

Für alle im gleichen WLAN: deine lokale IP statt `localhost` nutzen (z.B. `http://192.168.1.42:3000`).

## Deployment (damit Freunde von überall spielen können)

### Option A: Render.com (kostenlos, einfach)

1. Code auf GitHub pushen (`git init && git add . && git commit -m "init" && git push`)
2. Auf https://render.com einloggen
3. **New → Web Service** → dein Repo auswählen
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Region: Frankfurt
7. Instance: Free
8. Deploy starten

Nach ~2 Minuten hast du eine URL wie `https://tokenburger-poker.onrender.com` — die an deine Kameraden schicken.

### Option B: Railway.app

1. https://railway.app → "New Project" → "Deploy from GitHub"
2. Repo wählen → automatisch erkannt (Node)
3. Public URL zuweisen unter Settings → Networking → "Generate Domain"

### Option C: Glitch.com (Remix ohne Git)

1. https://glitch.com/edit → **New Project → Import from GitHub** oder Dateien direkt hochladen
2. Läuft automatisch, URL sofort verfügbar

### Option D: Eigener Server / VPS

```bash
git clone <dein-repo>
cd tokenburger-poker
npm install
PORT=80 node server.js
```
Oder mit PM2 im Hintergrund:
```bash
npm install -g pm2
pm2 start server.js --name poker
pm2 save
```

## So spielt ihr

1. Einer erstellt einen Raum (Name + Start-Coins + Blinds)
2. Er schickt den 4-stelligen **Raum-Code** an die anderen
3. Alle anderen öffnen die URL, geben ihren Namen + Code ein und treten bei
4. Wenn alle drin sind, klickt der Host auf **"Runde starten"**
5. Gespielt wird Texas Hold'em bis zum Showdown — dann startet der Host die nächste Runde
6. Ist jemand pleite? Kein Problem: Host öffnet Menü → Spieler → **Coins** → und gibt Nachschub

## Spielregeln (Kurzfassung)

- Jeder bekommt 2 Karten (hole cards), 5 Gemeinschaftskarten werden nach und nach aufgedeckt
- Aktionen: **Fold** (aussteigen), **Check** (wenn kein Einsatz), **Call** (mitgehen), **Raise** (erhöhen), **All-In**
- Beste 5-aus-7 Karten gewinnen den Pot
- Gleichstand: Pot wird geteilt

## Projektstruktur

```
tokenburger-poker/
├── server.js          # Poker-Logik + Socket.io
├── package.json
├── public/
│   ├── index.html     # UI
│   ├── style.css      # Styles (mobile-first)
│   └── client.js      # Client-Logik
└── README.md
```

## Tech-Stack

- **Node.js** + **Express** (Static-Hosting + Server)
- **Socket.io** (Echtzeit-Kommunikation)
- Vanilla JavaScript + CSS (keine Frameworks, keine Build-Steps)

## Bekannte Einschränkungen

- Bei Verbindungsabbruch wird der Spieler gefoldet — er kann aber neu beitreten (die Coins sind verloren, wenn er in dieser Hand war)
- Keine Persistenz zwischen Server-Neustarts: wird der Server neu gestartet, sind alle Räume weg
- Maximal 7 Spieler pro Raum (kann in `server.js` → `addPlayer` angepasst werden)

Viel Spaß! 🎰
