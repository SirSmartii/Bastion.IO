# Bastion.io

2D Top-Down Survival .io Game – Fokus auf Basisverteidigung und Upgrades.

## Starten

```bash
node server.js
```

Dann im Browser `http://localhost:3000` öffnen (mehrere Tabs = mehrere Spieler).
Keine npm-Pakete nötig (Node.js ≥ 22.13, wegen des eingebauten `node:sqlite`).

Zum Testen mit kurzem Tag: `DAY_LENGTH=10 node server.js` (PowerShell: `$env:DAY_LENGTH=10; node server.js`).

## Accounts & Speichern

- Im Startmenü **registrieren** oder **einloggen** (Name + Passwort). Wer als **Gast** spielt, wird nicht gespeichert, und seine Basis verschwindet beim Verlassen
- Spielstände liegen in einer SQLite-Datenbank, standardmäßig `data/bastion.db` (Pfad per `DB_PATH=…`). Tabellen: `accounts` (Passwörter mit scrypt + Salt gehasht), `characters` (Inventar, Ausrüstung, Hotbar, Level, Skills, Position …), `bases` (alle Gebäude inkl. Truhen- und Kern-Lager), `meta` (Welt-Seed und Uhrzeit)
- **Ausloggen** über den Knopf oben links. Gespeichert wird beim Ausloggen/Trennen, automatisch alle 60 s und beim Beenden des Servers (Ctrl+C, SIGTERM)
- Beim nächsten Login steht der Charakter wieder an derselben Stelle. Die **Basis bleibt offline in der Welt** und unterliegt weiter Unterhalt und Verfall
- Mit Datenbank bleibt auch die **Welt** über Neustarts gleich (Seed wird gespeichert), damit die Basen zum Gelände passen. Teams werden nicht gespeichert

## Deployment (Render)

Das Repo enthält eine `render.yaml`. Auf render.com **New → Blueprint** wählen, das GitHub-Repo verbinden, fertig.
Render setzt `PORT` automatisch, Client und WebSocket (`/ws`) laufen über denselben Service (HTTPS → `wss://`).

Hinweise zum Free-Plan: Der Service schläft nach ~15 Min. ohne Besucher ein (erster Aufruf dauert dann ~1 Min.),
und das Dateisystem ist nicht dauerhaft: Die SQLite-Datei (Accounts, Charaktere, Basen) geht bei jedem Deploy
oder Neustart verloren. Für dauerhafte Spielstände auf Render eine **Persistent Disk** (kostenpflichtig) anhängen
und `DB_PATH` darauf zeigen lassen, z. B. `DB_PATH=/var/data/bastion.db`.

## Spielablauf

- **Spawnschutz**: Neue Spieler sind bis zum ersten Einbruch der Nacht geschützt (keine Angriffe, keine Spawns in der Nähe, Schutzblase). Die erste Nacht danach bleibt ruhig: nur so viele Zombies wie tagsüber. Ab der zweiten Nacht werden die Untoten wild
- **Welt** (10 000 × 10 000, bei jedem Serverstart neu; fester Seed per `SEED=123 node server.js`): Biome Wiese, Wald, Blumenwiese, Fels und Sandufer. Bäume wachsen dicht im Wald, Steine, Gold, Eisenerz und Kohle vor allem im Fels. **Seen** sind unpassierbar (Pfeile fliegen drüber), **Feldwege** verbinden die Städte
- **Ruinenstädte**: Straßenraster mit Marktplatz, die Feldwege enden an Stadttoren. Dort laufen mehr Zombies herum, und bauen darf man in Städten nicht. Jede Stadt hat verschiedene **Gebäudetypen** mit eigenem Boden, Schild (auch auf der Weltkarte) und eigener Beute:
  - **Wohnhäuser**: Holzkisten (Gold, Schrott, Munition, Konserven, selten Ausrüstung)
  - 🛒 **Supermarkt**: Regalreihen voller 🥫 Konserven und Vorräte
  - 🚓 **Polizei**: Waffenkisten mit Munition, selten Pistole/Schrotflinte/Gewehr und Eisenrüstung
  - ✚ **Apotheke**: Medizinschränke mit 🩹 Verbänden
  - 🔧 **Werkstatt**: Werkzeugkisten (Schrott, Eisen, Kohle, selten Spitzhacken) und Fässer
  - Auf den Straßen: **Autowracks** (viele Schläge, viel Schrott & Eisen, gute Deckung) und **Fässer** (schnell offen, Kleinkram)
  - Alles Plünderbare kommt nach ein paar Minuten an derselben Stelle wieder (`RESOURCES` und `MAP.buildings` in `server/config.js`)
- Zufälliger Spawn (außerhalb der Städte) → Holz, Stein, Gold, Eisenerz und Kohle farmen. Jede Ressource hat einen **Vorrat**: Sie schrumpft beim Abbau, zerfällt leer und wächst später an anderer Stelle nach (`RESOURCES` in `server/config.js`)
- **Sprinten** mit `Shift` kostet Ausdauer. Leer gesprintet ist man kurz erschöpft. Ein Ring um die Figur und eine Leiste im HUD zeigen die Ausdauer
- Alles landet im **Inventar** (`Tab`, 20 Slots mit Stapeln). Bauen/Upgraden zieht aus dem Inventar
- Stapel per Drag & Drop umsortieren oder aus dem Fenster ziehen = droppen (`Shift` = Hälfte); Items am Boden kann jeder aufheben
- Beim Tod fällt ein Teil des Inventars als Beute auf den Boden
- Gegner lassen Beute nach ihrer **Droptable** fallen (Gold, 🦴 Knochen, 🔩 Schrott, Fell, Fleisch; nachts ×1.5)
- **Hunger & Durst** (zwei Leisten über dem Leben): sinken mit der Zeit (Hunger in ~12 min, Durst in ~8 min von voll auf leer, beim Sprinten schneller). Unter 25 heilt man nicht mehr von selbst, bei 0 kostet es jede Sekunde Leben (`SURVIVAL` in `server/config.js`). Im Spawnschutz sinken sie nicht
- **Essen & Trinken**: `H` nimmt das Passendste (gegen den größeren Mangel), Rechtsklick im Inventar ein bestimmtes Item. Der Tooltip zeigt, was es bringt (`ITEMS.food`):
  - 🫐 Beeren, 🍎 Äpfel, 🥕 Karotten, 🎃 Kürbisse stillen Hunger und etwas Durst; 🥔 Kartoffeln und 🌽 Mais roh nur wenig
  - 🍖 Rohes Fleisch macht kaum satt und kostet Leben – am **Lagerfeuer** gebraten wird es zu 🍗 Gebratenem Fleisch (satt + heilt). Kartoffeln werden zu Ofenkartoffeln, Mais zu Geröstetem Mais
  - 💧 Am Seeufer mit `F` trinken – das füllt auch alle leeren 🫙 **Feldflaschen** (Handwerk: 2 Fell + 1 Knochen). Volle Flaschen trinkt man unterwegs, die leere bleibt übrig
  - 🥫 Konserven und Wasser gibt es auch in Supermärkten; 🩹 Verbände heilen 45 HP
- **Pflanzen**: Beerenbüsche (begehbar, man kann sich darin ducken), Karotten, Kartoffeln, Mais und Kürbisse auf Wiesen und im Wald. Jeder Schlag erntet 1 Stück – egal womit. **Apfelbäume** geben Holz wie Bäume und lassen bei jedem Schlag mit etwas Glück einen Apfel fallen
- **Lagerfeuer** (Baumenü → *Basis*, max. 2): auch **unterwegs ohne Basis** baubar und zählt nicht zum Gebäude-Limit. Holz hineinlegen (`F`): 1 Holz brennt 10 s. Solange es brennt, leuchtet es nachts, brät alle 5 s ein rohes Stück und **verscheucht Tiere** im Umkreis von 300 – nur rasend hungrige Raubtiere lassen sich davon nicht abhalten
- **Hotbar** (`1`–`6`): Items aus dem Inventar auf einen Slot ziehen (oder Maus über das Item + Zahl drücken). Benutzen = Waffe/Kleidung anlegen, essen & trinken, Munitionstyp wählen. Rechtsklick leert den Slot
- **Erfahrung**: EP für Kills, Abbau, Kisten, Herstellen und Bauen. Jedes Level gibt einen Skillpunkt (`XP` in `server/config.js`)
- **Fertigkeiten** (`K`): Stärke, Schütze, Vitalität, Kondition, Flinkheit, Zähigkeit, Erholung, Sammler, je 5 Ränge (`SKILLS`)
- Treffer zeigen den Schaden als rote Zahl über dem Getroffenen
- **Baumenü** (`B`): Gebäude nach Kategorien *Basis*, *Verteidigung* und *Wirtschaft*. Gewählt wird per Klick, platziert mit Linksklick (Ziehen baut Reihen). Der Bau-Button rechts neben der Hotbar wählt das zuletzt gebaute Gebäude
- **Basis-Kern** platzieren → definiert Bauradius & Gebäude-Limit
- Letzter Schlag auf eine Ressource gibt einen **Abbau-Bonus** (+10 Holz / +10 Stein / +5 Gold / +4 Eisenerz / +6 Kohle)
- **Eisen & Kohle**: 🟤 Eisenerz lässt sich erst ab Abbau-Wert 2 abbauen (Steinaxt oder Spitzhacke), ⚫ Kohle mit allem. Im **Schmelzofen** (Baumenü → *Wirtschaft*, max. 2) werden je 2 Eisenerz + 1 Kohle zu einem ⛓️ **Eisenbarren** geschmolzen (alle 4 s, mit Upgrades bis 1,2 s). Der Ofen ist ein Behälter wie die Truhe (`F`), nimmt nur Erz, Kohle und Barren und läuft auch, wenn du offline bist. Er glüht und raucht, solange er brennt
- **Wofür Eisen & Kohle**: Eisen für Spitzhacke, Eisenschwert, Eisenrüstung, Metallpfeile, Feuerwaffen und die höchsten Gebäude-Stufen (Mauer, Tür, Fenster, Turm, Kern, Schmiede, Mine); Kohle ist Ofen-Brennstoff und Schießpulver für Patronen. Minen fördern ab Stufe 3 auch Kohle, ab Stufe 4 Eisenerz
- **Spitzhacken**: bauen Fels, Gold, Eisen und Kohle mit ihrem eigenen Wert ab (Stein 3, Eisen 6), an Bäumen taugen sie wenig
- **Sichtlinien**: Bäume, Felsen, Kisten, Mauern, Türen und Ruinen verdecken die Sicht. Der Boden dahinter ist abgedunkelt, und fremde Spieler und Gegner dahinter werden gar nicht erst an deinen Client geschickt (auch nicht aufs Radar) – man kann sich also hinter Bäumen oder sogar in Baumkronen verstecken. Ganz aus der Nähe (`SIGHT.near`) spürt man trotzdem alles – außer durch Mauern und Ruinen hindurch. Teammitglieder sieht man immer. Zwischen zwei aneinanderstoßenden Mauern rutschen weder Sicht noch Licht durch die Fuge. Fenster sind durchsichtig, Türme schauen über Mauern hinweg, aber nicht durch Bäume
- Gebäude sind für alle massiv, auch für dich. **Türen** lassen nur ihren Besitzer (und sein Team) durch, **Fenster** blockieren jeden, lassen aber Pfeile durch
- Mauern, Türen, Fenster, Stacheln, Türme, Minen im Radius bauen; mit `E` upgraden (5 Stufen: Holz → Stein → Gold → Diamant → Rubin). Beim Platzieren dreht `R` das Gebäude in 90°-Schritten. Der Basis-Kern ist 2×1 Kacheln groß
- Gebäude können höchstens das Level des Kerns erreichen → Kern-Upgrades sind der Fortschritt
- **Handwerk** (`G`): Einfache Sachen gehen überall ohne Schmiede – Steinaxt, Steinspitzhacke, Steindolch, Holzspeer, Holzbogen, Fellmütze & -stiefel, Holz- und Steinpfeile und Verbände (aus Fell). In der Config markiert `hand: true` ein Rezept dafür
- **Schmiede** (max. 1): Mit `F` daneben öffnen und Werkzeug, Waffen, Munition, Kleidung & Vorräte herstellen. Das Schmiede-Level schaltet Rezepte frei
- **Charakter** (`C`): Ausrüstungs-Slots Mütze, Shirt, Hose, Schuhe und Waffe sowie alle Werte (Leben, Rüstung, Schaden, Abbau, Tempo, Angriffe/s, Regeneration, Reichweite). Öffnet zusammen mit dem Inventar (`Tab`) nebeneinander
- **Fähigkeiten durch Übung** (im Charakterfenster): steigen von selbst beim Tun und bleiben auch nach dem Tod erhalten (bis Stufe 20, `PRACTICE` in der Config):
  - 🏃 Laufen (Strecke, Sprinten zählt mehr): +1 % Tempo, −3 % Sprint-Ausdauer pro Stufe
  - 🪓 Holzfällen / ⛏ Bergbau (pro abgebauter Einheit): +4 % Chance auf +1 Holz bzw. Stein/Erz/Kohle pro Schlag
  - 🎯 Schießen / ⚔ Nahkampf (pro Treffer an Gegnern): +2 % Schaden und Feuerrate bzw. Schlagtempo pro Stufe
  - 📦 Plündern (pro aufgebrochener Kiste): +3 % Chance auf eine zweite Beute-Runde
- **Waffen**: Äxte (gut zum Abbauen), Spitzhacken (Gestein), Schwerter (viel Schaden), Dolche (sehr schnell), Speere (große Reichweite), Bögen (Pfeile) und **Feuerwaffen**: Pistole, Schrotflinte (7 Schrotkugeln mit Streuung) und Gewehr (große Reichweite). Feuerwaffen verbrauchen Patronen bzw. Schrotpatronen aus der Schmiede (aus Eisen und Kohle). Schüsse sind laut und locken Gegner im Umkreis an (`noise`)
- **Pfeiltypen**: Holz-, Stein- und Metallpfeile (mehr Schaden, bleiben nach einem Treffer öfter liegen: 30 / 50 / 75 %). Der Bogen nimmt automatisch den besten, mit `R` wechselst du den Typ (`AMMO` in `server/config.js`)
- Waffen und Kleidung sind **einzelne Items**: per Drag & Drop oder Rechtsklick an- und ablegen, aus dem Fenster ziehen = droppen. Ohne Waffe kämpft man mit der Faust
- Rüstung reduziert Schaden um `Rüstung / (Rüstung + 50)`. Werte & Rezepte stehen in `EQUIPMENT` in `server/config.js`
- Kern zerstört = ganze Basis weg
- **Unterhalt & Verfall**: Der Basis-Kern hat ein **Lager** (`F` daneben, 10–20 Slots je nach Kern-Level), in das nur Holz, Stein und Gold passen. Alle 5 Minuten zahlt die Basis daraus pro Gebäude je nach Level (Holz-Stufe 1 🪵 … Rubin-Stufe 3 🪨 + 2 🪙, der Kern zählt 5-fach) und repariert dabei alle Gebäude um 10 % HP. Ist das Lager leer, **verfällt** die ganze Basis: Jedes Gebäude verliert 2 % seiner HP pro Minute, bis wieder Vorrat da ist. Ein neuer Kern startet mit 40 Holz. HUD und Kern-Lager zeigen, wie lange der Vorrat reicht (`UPKEEP` in `server/config.js`)
- **Schatten**: Tagsüber werfen Bäume, Steine, Gebäude, Spieler und Tiere Sonnenschatten, die mit der Tageszeit wandern. Nachts verdecken Hindernisse das Licht von Spielern, Kernen, Türmen und Schmiede (Fenster lassen Licht durch)
- **Truhen** (Baumenü → *Basis*, max. 6): Mit `F` davor öffnen, Items per Drag & Drop oder Rechtsklick (ganzer Stapel) ein- und auslagern. Upgrades geben mehr Platz (10 → 30 Slots). Wird eine Truhe zerstört, fällt ihr Inhalt auf den Boden
- **Chat** (`Enter`): Nachrichten erreichen nur Spieler in der Nähe (`CHAT.range`) und erscheinen als Sprechblase. `/t Nachricht` schreibt ans ganze Team, egal wie weit weg
- **Teams** (`T`): Spieler in der Nähe einladen, Einladungen annehmen/ablehnen, Team verlassen; der Anführer kann Mitglieder entfernen (max. `TEAM.maxSize`). Teammitglieder verletzen sich nicht, gehen durch die Türen des anderen, nutzen seine Truhen, reparieren seine Gebäude und sehen sich (samt Basen) grün auf Minimap und Weltkarte
- **Minimap**: Radar um den Spieler. Rot = feindlich, Rosa = friedliches Tier, Gelb = fremder Spieler, den du gerade sehen kannst, Grün = Team
- **Weltkarte** (`M`): ganze Welt mit Biomen, Seen, Wegen, Städten, deiner Basis und Planquadraten A–J / 1–10. Fremde Spieler sind dort nicht zu sehen, nur dein Team
- Das Baugitter erscheint nur beim Platzieren von Gebäuden rund um die Maus
- **Leistungsanzeige** (`F3`): FPS, Frame-Zeiten mit Verlauf, Zeit pro Zeichenschritt, Server-Takt und Abspiel-Puffer

## Gegner

| Gegner | Verhalten |
|---|---|
| Zombie / Läufer / Koloss | Jagen Spieler. Nachts sind sie wilder: schneller, sehen weiter, schlagen öfter und härter zu und kommen in größerer Zahl (`SPAWN.night*`). Basen greifen sie nicht gezielt an, nur was ihnen im Weg steht. Bei Sonnenaufgang zerfallen die Untoten der Nacht (ohne Beute): außer Sicht sofort, sichtbare qualmen ~15 s lang – wer gerade kämpft, kämpft zu Ende. Außerdem werden überzählige, untätige Gegner außerhalb jedes Sichtfelds nach und nach entfernt (`SPAWN.dawnBurn`, `SPAWN.cleanup*`). Kolosse werden mit jedem Tag häufiger |
| 🐺 Wolf | Lebt im **Rudel** (3–5) im Wald und auf Wiesen. Der **Alpha** ist größer und stärker und hat dunkles Fell mit heller Halskrause; die anderen folgen ihm und greifen an, was er angreift. Schlägt man einen, wird das ganze Rudel wütend. Fällt der Alpha, flieht das Rudel kurz und der Stärkste übernimmt (mit dem Fell, aber ohne die Extra-Kraft). Jagt Spieler, ignoriert Basen |
| 🐗 Wildschwein | Friedlich; schlägt man es, verfolgt es den Angreifer. Vor beißenden Raubtieren flieht es |
| 🐻 Bär | Revier: greift erst aus der Nähe an, verfolgt dann bis zur Leine. Sehr stark. Nur im Wald und höchstens einer pro Gegend |

**Hunger der Raubtiere**: Wölfe und Bären haben einen internen Hunger, der in einigen Minuten abfällt (beim Rudel gemeinsam). Ihre Augen zeigen ihn an: je hungriger, desto röter, kurz vor der Raserei glühen sie. Ist er leer, werden sie **rasend**: Sie jagen schneller das schwächste Wesen in der Nähe, das sie sehen – Spieler, Zombies, Wildschweine, andere Tiere, nur nie die eigene Art – und ignorieren Lagerfeuer. Gebäude greifen sie dabei nie an. Jeder Biss macht etwas satter, eine erlegte Beute ganz; was Tiere untereinander erlegen, lässt keine Beute fallen. Zombies jagen keine Tiere, wehren sich aber, wenn eines zubeißt (`predator` in `ENEMIES`).

**Tierbestand**: Jede Art hat einen Lebensraum (`habitat`) und eine Obergrenze (`cap`): z. B. höchstens ein Bär und zwei Wolfsrudel im Umkreis von 1600 um einen Spieler (`WILDLIFE`).

Gegner entdecken nur Spieler, die sie sehen können. Verschwindet man hinter Deckung, laufen sie noch `SIGHT.memory` Sekunden zur letzten bekannten Position und geben dann auf. Gegner holen vor einem Schlag kurz aus (`ENEMY_ATTACK`) – wer rechtzeitig wegläuft, weicht aus. Jeder angegriffene Gegner verfolgt seinen Angreifer für `ANGER_TIME` Sekunden – auch hinter Deckung. Spawn-Gewichte, Werte und Droptables stehen in `ENEMIES` in `server/config.js`.

## Struktur

### Server

| Datei | Inhalt |
|---|---|
| `server.js` | HTTP-Server, WebSocket, Game-Loop mit festen Schritten (TICK_RATE / SEND_RATE aus der Config), Speichern beim Beenden |
| `server/config.js` | **Alle Balancing-Werte** (Kosten, HP, Schaden, Spawnraten, Unterhalt, PvP-Schalter) |
| `server/game.js` | Die Klasse `Game`: Zustand der Welt und Ablauf eines Ticks. Die Logik steckt in `server/game/` |
| `server/game/players.js` | Verbindung, Login, Spawnen, Bewegung, Erfahrung |
| `server/game/items.js` | Inventar, Items am Boden, Hotbar, Ausrüstung, Herstellen |
| `server/game/building.js` | Gebäude bauen, upgraden, abreißen; Türme & Minen |
| `server/game/storage.js` | Truhen, Schmelzofen, Kern-Lager, Unterhalt & Verfall |
| `server/game/combat.js` | Schläge, Schüsse, Projektile, Schaden, Beute |
| `server/game/enemies.js` | Gegner spawnen, Zielwahl, Bewegung, Morgengrauen & Aufräumen |
| `server/game/practice.js` | Fähigkeiten durch Übung (Laufen, Holzfällen, Schießen …) |
| `server/game/sight.js` | Sichtlinien: Strahl durchs Raster, wer wen sehen kann |
| `server/game/resources.js` | Welt aufbauen, Ressourcen abbauen & nachwachsen |
| `server/game/social.js` | Teams & Chat |
| `server/game/persistence.js` | Charaktere & Basen speichern/laden |
| `server/game/network.js` | Nachrichten annehmen, Zustand senden (das Protokoll ist dort beschrieben) |
| `server/game/geometry.js`, `util.js` | Räumliches Raster, Kollisionen, kleine Helfer |
| `server/world.js` | Weltgenerator: Biome (Value-Noise), Seen, Städte mit Gebäudetypen, Autowracks & Fässern, Feldwege |
| `server/inventory.js` | Slot-Inventar (Stapeln, Verschieben, Bezahlen) |
| `server/db.js` | SQLite-Persistenz: Accounts, Charaktere, Basen, Welt-Seed |
| `server/ws.js` | Minimaler WebSocket-Server ohne Abhängigkeiten |

### Client (`public/js/`, ES-Module ohne Build-Schritt)

| Datei | Inhalt |
|---|---|
| `main.js` | Einstieg: Bildschirmgröße, Hauptschleife, Zeichenreihenfolge |
| `state.js` | Gemeinsamer Zustand (eigener Spieler, sichtbare Objekte, Kamera, offene Fenster) |
| `net.js` | Verbindung, Server-Nachrichten, Delta-Updates zusammensetzen |
| `interp.js` | Bewegung zeitgenau zwischen den Server-Zuständen abspielen (gegen Ruckeln) |
| `perf.js` | Leistungsanzeige [F3] |
| `input.js` | Tastatur & Maus, Drag & Drop, Bauen |
| `world.js` | Gelände & Ressourcen mit räumlichem Index |
| `rules.js` | Spielregeln für Vorschau & Hinweise (Bauplatz, Reichweiten, Team) |
| `menu.js`, `chat.js`, `effects.js` | Startmenü, Chat, Partikel & Meldungen |
| `draw/` | Gelände, Gebäude & Figuren, Items, Licht, Sonnen- & Sichtschatten, Zeichen-Grundfunktionen |
| `ui/` | HUD und je ein Modul pro Fenster (Inventar, Charakter, Schmiede, Baumenü, Fertigkeiten, Team, Karte) |
