# Deployment auf toggenburgerkamaraden.ch (Infomaniak)

## ⚠️ Wichtig zuerst lesen

Dieses Projekt ist **keine statische Webseite** — es ist eine **Node.js-Anwendung**.
Ein reiner FTP-Upload in deinen Webhosting-Ordner genügt **nicht**. Du brauchst zwei Schritte:

1. **Dateien hochladen** (via `npm run deploy`)
2. **Node.js-App auf Infomaniak aktivieren** (einmalig im Manager)

Ohne Schritt 2 läuft das Poker-Spiel nicht — die Domain würde nur die alte statische
toggenburgerkamaraden.ch-Seite zeigen.

---

## Schritt 1 — Node.js auf Infomaniak aktivieren (einmalig)

1. Ins Infomaniak-Manager einloggen: https://manager.infomaniak.com
2. **Web & Domain → Hostings → dein Hosting** auswählen
3. Bei der Domain `toggenburgerkamaraden.ch` auf **Erweiterte Einstellungen** klicken
4. Reiter **Node.js** öffnen (falls nicht sichtbar: Node.js muss im Hosting-Paket enthalten sein — bei Infomaniak-Web-Hosting ab Start-Tarif inklusive)
5. Node.js-App konfigurieren:
   - **Node.js Version**: 20.x oder 22.x
   - **Startdatei / Entrypoint**: `server.js`
   - **Application Mode**: `production`
   - **Application Root**: `/sites/toggenburgerkamaraden.ch`
6. **Aktivieren / Speichern** klicken
7. Infomaniak zeigt dir einen **internen Port** bzw. richtet einen Reverse-Proxy ein, sodass die Domain auf deine Node.js-App zeigt

*Alternative falls Node.js auf deinem Paket nicht verfügbar:* siehe Abschnitt "Fallback" unten.

## Schritt 2 — Dateien hochladen

### Vorbereitung (einmalig)

1. In den Projekt-Ordner wechseln:
   ```bash
   cd tokenburger-poker
   npm install
   ```

2. `.env.example` nach `.env` kopieren und Passwort eintragen:
   ```bash
   cp .env.example .env
   ```
   Dann `.env` mit Editor öffnen und `DEIN_FTP_PASSWORT_HIER` durch das echte
   Infomaniak-FTP-Passwort ersetzen.

   **Wichtig:** `.env` ist in `.gitignore` und wird nie committed oder hochgeladen.

### Hochladen

```bash
npm run deploy
```

Das Skript:
- verbindet sich via **FTPS** (sicher, verschlüsselt) zu `st5jy9.ftp.infomaniak.com`
- loggt sich ein als `st5jy9_lukas`
- lädt alles in `/sites/toggenburgerkamaraden.ch/` hoch
- ignoriert `node_modules/`, `.git/`, `.env`, `deploy.js`, Smoketests
- zeigt dir Fortschritt pro Datei

Wenn du kein Passwort in `.env` setzt, fragt dich das Skript interaktiv beim Start.

## Schritt 3 — Abhängigkeiten auf dem Server installieren

Node.js-Apps brauchen die Pakete aus `node_modules`. Wir laden die aber nicht hoch
(zu viele Dateien / jede Plattform anders). Stattdessen auf dem Server einmalig
ausführen:

### Variante A — per SSH (empfohlen)

Infomaniak bietet SSH-Zugang (aktivieren im Manager unter FTP/SSH-Benutzer).

```bash
ssh st5jy9_lukas@st5jy9.ftp.infomaniak.com
cd /sites/toggenburgerkamaraden.ch
npm install --omit=dev
```

### Variante B — Node.js-Manager im Infomaniak-Panel

In manchen Versionen des Managers gibt es einen Knopf **"npm install"** direkt
im Node.js-Tab. Einfach draufklicken.

## Schritt 4 — App starten

Im Infomaniak-Manager unter Node.js → **Start / Restart** klicken.

Öffne dann https://toggenburgerkamaraden.ch — das Poker-Login sollte erscheinen.

---

## Zukünftige Updates

Wenn du Änderungen am Code machst:

```bash
npm run deploy
```

und danach die Node.js-App im Manager **neustarten** (Restart-Knopf).

---

## Fallback: Falls Node.js auf deinem Hosting-Paket nicht geht

Dann solltest du **nicht** auf Infomaniak shared hosting deployen. Stattdessen:

- **Render.com** (kostenloser Plan, auto-deploy von GitHub) — siehe README.md
- **Railway.app** (gratis Startguthaben)
- **Fly.io** (freier Tier)
- **Eigener VPS** bei Infomaniak (Jelastic oder Public Cloud)

Auf diesen Plattformen funktioniert die App ohne zusätzliche Konfiguration.
Die Domain `toggenburgerkamaraden.ch` kannst du bei Infomaniak auf die neue
Render-URL weiterleiten (DNS → CNAME).

---

## Troubleshooting

**"ECONNREFUSED" beim Deploy**
→ FTP-Hostname falsch. Im Manager unter FTP/SSH-Benutzer den genauen Host prüfen.

**"530 Login authentication failed"**
→ Passwort falsch. `.env` öffnen und korrigieren.

**Nach dem Upload läuft die Seite nicht**
→ Node.js ist nicht aktiviert (Schritt 1) oder `npm install` wurde nicht auf
dem Server ausgeführt (Schritt 3).

**"Socket.io connection failed" im Browser**
→ Infomaniak-Reverse-Proxy blockiert WebSockets. Im Node.js-Tab prüfen, ob
WebSockets aktiviert sind, oder Support kontaktieren.

**Port-Konflikt**
→ `server.js` nutzt `process.env.PORT`. Infomaniak setzt den Port automatisch.
Nichts tun — einfach `npm run deploy` nochmal.
