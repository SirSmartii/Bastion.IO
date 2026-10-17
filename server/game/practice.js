'use strict';
// Fähigkeiten durch Übung (PRACTICE in der Config): Laufen, Holzfällen, Bergbau, Schießen, Nahkampf,
// Plündern. Sie steigen von selbst, wenn man die Tätigkeit ausübt, und bleiben auch nach dem Tod erhalten.
//
// p.practice = { id: [Stufe, EP in dieser Stufe] }. Die Boni pro Stufe stehen in PRACTICE.list[*].per
// und werden über practiceBonus(p, key) abgefragt (Summe über alle Fähigkeiten, die key haben).

const C = require('../config');
const { lookup } = require('./util');

const byId = Object.fromEntries(C.PRACTICE.list.map((s) => [s.id, s]));

module.exports = {
  practiceLevel(p, id) {
    return (p.practice[id] || [0])[0];
  },

  // EP für Stufe level → level + 1
  practiceNeeded(level) {
    return Math.round(C.PRACTICE.base * (level + 1) ** C.PRACTICE.exp);
  },

  // Übung gutschreiben; bei einem Stufenaufstieg Meldung und (falls nötig) Werte neu berechnen
  addPractice(p, id, amount) {
    const def = lookup(byId, id);
    if (!def || !p || !amount) return;
    const entry = p.practice[id] || (p.practice[id] = [0, 0]);
    if (entry[0] >= C.PRACTICE.max) return;
    entry[1] += amount;
    let leveled = false;
    while (entry[0] < C.PRACTICE.max && entry[1] >= this.practiceNeeded(entry[0])) {
      entry[1] -= this.practiceNeeded(entry[0]);
      entry[0]++;
      leveled = true;
    }
    if (entry[0] >= C.PRACTICE.max) entry[1] = 0;
    if (!leveled) return;
    this.msg(p, '{icon} {name} steigt auf Stufe {n}!', { icon: def.icon, name: def.name, n: entry[0] });
    if (def.stats) this.computeStats(p); // Tempo, Schaden, Schlagrate
  },

  // Summe eines Bonus (z. B. 'speedPct') über alle Fähigkeiten
  practiceBonus(p, key) {
    let sum = 0;
    for (const def of C.PRACTICE.list) if (def.per[key]) sum += def.per[key] * this.practiceLevel(p, def.id);
    return sum;
  },

  // Laufen: zurückgelegte Strecke sammeln (Sprinten zählt mehr)
  trackRunning(p, distance) {
    p.walked = (p.walked || 0) + distance * (p.sprinting ? 1.5 : 1);
    const step = C.PRACTICE.runDistance;
    if (p.walked < step) return;
    const n = Math.floor(p.walked / step);
    p.walked -= n * step;
    this.addPractice(p, 'running', n);
  },

  // Für den Client: [[id, Stufe, EP, nötige EP], …]
  practiceInfo(p) {
    return C.PRACTICE.list.map(({ id }) => {
      const [level, xp] = p.practice[id] || [0, 0];
      return [id, level, Math.floor(xp), level >= C.PRACTICE.max ? 0 : this.practiceNeeded(level)];
    });
  },
};
