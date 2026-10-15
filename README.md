# Bastion.io

2D Top-Down Survival .io Game – Fokus auf Basisverteidigung und Upgrades.

## Starten

```bash
node server.js
```

Dann im Browser `http://localhost:3000` öffnen (mehrere Tabs = mehrere Spieler).
Keine npm-Pakete nötig (Node.js ≥ 18).

Zum Testen mit kurzem Tag: `DAY_LENGTH=10 node server.js` (PowerShell: `$env:DAY_LENGTH=10; node server.js`).

## Deployment (Render)

Das Repo enthält eine `render.yaml`. Auf render.com **New → Blueprint** wählen, das GitHub-Repo verbinden, fertig.
Render setzt `PORT` automatisch, Client und WebSocket (`/ws`) laufen über denselben Service (HTTPS → `wss://`).

Hinweise zum Free-Plan: Der Service schläft nach ~15 Min. ohne Besucher ein (erster Aufruf dauert dann ~1 Min.),
und bei jedem Neustart/Deploy beginnt die Welt von vorn (der Spielstand liegt nur im Speicher).

## Spielablauf

- **Spawnschutz**: Neue Spieler sind bis zum ersten Einbruch der Nacht geschützt (keine Angriffe, keine Spawns in der Nähe, Schutzblase). Die erste Nacht danach bleibt ruhig: nur so viele Zombies wie tagsüber, die Basis wird nicht gezielt angegriffen. Ab der zweiten Nacht kommen die Horden
- **Welt** (10 000 × 10 000, bei jedem Serverstart neu; fester Seed per `SEED=123 node server.js`): Biome Wiese, Wald, Blumenwiese, Fels und Sandufer. Bäume wachsen dicht im Wald, Steine & Gold im Fels. **Seen** sind unpassierbar (Pfeile fliegen drüber), **Feldwege** verbinden die Städte
- **Ruinenstädte**: verfallene Häuser mit **Kisten** voller Beute (Gold, Schrott, Pfeile, selten Ausrüstung; kommen nach 2 Min. wieder). Dafür laufen dort mehr Zombies herum, und bauen darf man in Städten nicht. Städte haben ein Straßenraster mit Marktplatz; die Feldwege enden an Stadttoren, kein Weg führt durch ein Haus
- Zufälliger Spawn (außerhalb der Städte) → Holz, Stein, Gold farmen. Jede Ressource hat einen **Vorrat**: Sie schrumpft beim Abbau, zerfällt leer und wächst später an anderer Stelle nach (`RESOURCES` in `server/config.js`)
- **Sprinten** mit `Shift` kostet Ausdauer. Leer gesprintet ist man kurz erschöpft. Ein Ring um die Figur und eine Leiste im HUD zeigen die Ausdauer
- Alles landet im **Inventar** (`Tab`, 20 Slots mit Stapeln). Bauen/Upgraden zieht aus dem Inventar
- Stapel per Drag & Drop umsortieren oder aus dem Fenster ziehen = droppen (`Shift` = Hälfte); Items am Boden kann jeder aufheben
- Beim Tod fällt ein Teil des Inventars als Beute auf den Boden
- Gegner lassen Beute nach ihrer **Droptable** fallen (Gold, 🦴 Knochen, 🔩 Schrott, Fell, Fleisch; nachts ×1.5)
- Fleisch essen: `H` oder Rechtsklick im Inventar (+30 HP)
- **Hotbar** (`1`–`6`): Items aus dem Inventar auf einen Slot ziehen (oder Maus über das Item + Zahl drücken). Benutzen = Waffe/Kleidung anlegen, Fleisch essen, Munitionstyp wählen. Rechtsklick leert den Slot
- **Erfahrung**: EP für Kills, Abbau, Kisten, Herstellen und Bauen. Jedes Level gibt einen Skillpunkt (`XP` in `server/config.js`)
- **Fertigkeiten** (`K`): Stärke, Schütze, Vitalität, Kondition, Flinkheit, Zähigkeit, Erholung, Sammler, je 5 Ränge (`SKILLS`)
- Treffer zeigen den Schaden als rote Zahl über dem Getroffenen
- **Baumenü** (`B`): Gebäude nach Kategorien *Basis*, *Verteidigung* und *Wirtschaft*. Gewählt wird per Klick, platziert mit Linksklick (Ziehen baut Reihen). Der Bau-Button rechts neben der Hotbar wählt das zuletzt gebaute Gebäude
- **Basis-Kern** platzieren → definiert Bauradius & Gebäude-Limit
- Letzter Schlag auf eine Ressource gibt einen **Abbau-Bonus** (+10 Holz / +10 Stein / +5 Gold)
- Gebäude sind für alle massiv, auch für dich. **Türen** lassen nur ihren Besitzer durch, **Fenster** blockieren jeden, lassen aber Pfeile durch
- Mauern, Türen, Fenster, Stacheln, Türme, Minen im Radius bauen; mit `E` upgraden (5 Stufen: Holz → Stein → Gold → Diamant → Rubin)
- Gebäude können höchstens das Level des Kerns erreichen → Kern-Upgrades sind der Fortschritt
- **Schmiede** (max. 1): Mit `F` daneben öffnen und Äxte & Kleidung herstellen (Reiter *Äxte* / *Kleidung*). Das Schmiede-Level schaltet Rezepte frei
- **Charakter** (`C`): Ausrüstungs-Slots Mütze, Shirt, Hose, Schuhe und Waffe sowie alle Werte (Leben, Rüstung, Schaden, Abbau, Tempo, Angriffe/s, Regeneration, Reichweite). Öffnet zusammen mit dem Inventar (`Tab`) nebeneinander
- **Waffen**: Äxte (gut zum Abbauen), Schwerter (viel Schaden), Dolche (sehr schnell), Speere (große Reichweite), Bögen (Pfeile) und **Feuerwaffen**: Pistole, Schrotflinte (7 Schrotkugeln mit Streuung) und Gewehr (große Reichweite). Feuerwaffen verbrauchen Patronen bzw. Schrotpatronen aus der Schmiede. Schüsse sind laut und locken Gegner im Umkreis an (`noise`)
- **Pfeiltypen**: Holz-, Stein- und Metallpfeile (mehr Schaden, bleiben nach einem Treffer öfter liegen: 30 / 50 / 75 %). Der Bogen nimmt automatisch den besten, mit `R` wechselst du den Typ (`AMMO` in `server/config.js`)
- Waffen und Kleidung sind **einzelne Items**: per Drag & Drop oder Rechtsklick an- und ablegen, aus dem Fenster ziehen = droppen. Ohne Waffe kämpft man mit der Faust
- Rüstung reduziert Schaden um `Rüstung / (Rüstung + 50)`. Werte & Rezepte stehen in `EQUIPMENT` in `server/config.js`
- Kern zerstört = ganze Basis weg
- **Schatten**: Tagsüber werfen Bäume, Steine, Gebäude, Spieler und Tiere Sonnenschatten, die mit der Tageszeit wandern. Nachts verdecken Hindernisse das Licht von Spielern, Kernen, Türmen und Schmiede (Fenster lassen Licht durch)
- **Minimap**: Radar um den Spieler. Rot = feindlich, Rosa = friedliches Tier, Gelb = Spieler
- **Weltkarte** (`M`): ganze Welt mit Biomen, Seen, Wegen, Städten, deiner Basis und Planquadraten A–J / 1–10
- Das Baugitter erscheint nur beim Platzieren von Gebäuden rund um die Maus

## Gegner

| Gegner | Verhalten |
|---|---|
| Zombie / Läufer / Koloss | Jagen Spieler; nachts greifen sie gezielt Basen an. Kolosse werden mit jedem Tag häufiger |
| 🐺 Wolf | Spawnt im Rudel (2–4), schnell, jagt Spieler, ignoriert Basen |
| 🐗 Wildschwein | Friedlich; schlägt man es, verfolgt es den Angreifer |
| 🐻 Bär | Revier: greift erst aus der Nähe an, verfolgt dann bis zur Leine. Sehr stark |

Jeder angegriffene Gegner verfolgt seinen Angreifer für `ANGER_TIME` Sekunden. Spawn-Gewichte, Werte und Droptables stehen in `ENEMIES` in `server/config.js`.

## Struktur

| Datei | Inhalt |
|---|---|
| `server/config.js` | **Alle Balancing-Werte** (Kosten, HP, Schaden, Spawnraten, PvP-Schalter) |
| `server/game.js` | Autoritative Spielsimulation (Bewegung, Kampf, Bauen, Gegner-KI) |
| `server/world.js` | Weltgenerator: Biome (Value-Noise), Seen, Ruinenstädte, Feldwege |
| `server/inventory.js` | Slot-Inventar (Stapeln, Verschieben, Bezahlen) |
| `server/ws.js` | Minimaler WebSocket-Server ohne Abhängigkeiten |
| `server.js` | HTTP-Server + Game-Loop (30 Ticks/s, 15 Updates/s) |
| `public/client.js` | Canvas-Rendering, Eingabe, HUD, Licht |
