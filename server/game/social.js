'use strict';
// Teams (Einladen, Beitreten, Verlassen, Entfernen) und Chat (Nähe bzw. Team).
//
// Teammitglieder verletzen sich nicht, gehen durch die Türen des anderen, nutzen seine Truhen,
// reparieren seine Gebäude und sehen sich auf den Karten. Teams werden nicht gespeichert.

const C = require('../config');
const { uid } = require('./util');

module.exports = {
  teamOf(p) {
    return (p && p.team && this.teams.get(p.team)) || null;
  },

  // Gehört ownerId zu p selbst oder zu seinem Team?
  allied(p, ownerId) {
    if (!p) return false;
    if (p.id === ownerId) return true;
    const other = this.players.get(ownerId);
    return !!(other && p.team && other.team === p.team);
  },

  teamMsg(team, text, v) {
    for (const id of team.members) {
      const member = this.players.get(id);
      if (member) this.msg(member, text, v);
    }
  },

  invite(p, targetId) {
    const target = this.players.get(targetId);
    if (!target || target === p) return;
    const team = this.teamOf(p);
    if (target.team && target.team === p.team) return this.msg(p, '{name} ist schon in deinem Team.', { name: target.name });
    if (target.team) return this.msg(p, '{name} ist bereits in einem Team.', { name: target.name });
    if (team && team.members.length >= C.TEAM.maxSize) return this.msg(p, 'Dein Team ist voll (max. {n}).', { n: C.TEAM.maxSize });
    const previous = target.invites.get(p.id);
    if (previous !== undefined && this.now - previous < 5) return; // nicht spammen
    target.invites.set(p.id, this.now);
    this.msg(target, '👥 {name} lädt dich in ein Team ein – [T] zum Annehmen.', { name: p.name });
    this.msg(p, 'Einladung an {name} gesendet.', { name: target.name });
  },

  // Einladung annehmen: Team des Einladenden beitreten (oder mit ihm ein neues gründen)
  acceptInvite(p, fromId) {
    const sentAt = p.invites.get(fromId);
    p.invites.delete(fromId);
    const from = this.players.get(fromId);
    if (sentAt === undefined || !from || this.now - sentAt > C.TEAM.inviteTime) return this.msg(p, 'Die Einladung ist abgelaufen.');
    if (p.team) return this.msg(p, 'Verlasse zuerst dein aktuelles Team.');
    let team = this.teamOf(from);
    if (!team) {
      team = { id: uid(), name: `Team ${from.name}`, leader: from.id, members: [from.id] };
      this.teams.set(team.id, team);
      from.team = team.id;
      from.invites.clear();
    }
    if (team.members.length >= C.TEAM.maxSize) return this.msg(p, 'Das Team ist bereits voll.');
    team.members.push(p.id);
    p.team = team.id;
    p.invites.clear();
    this.teamMsg(team, '👥 {name} ist {team} beigetreten.', { name: p.name, team: team.name });
  },

  // Verlassen; ein Team mit nur noch einem Mitglied löst sich auf
  leaveTeam(p, silent) {
    const team = this.teamOf(p);
    p.team = 0;
    if (!team) return;
    team.members = team.members.filter((id) => id !== p.id);
    if (!silent) this.msg(p, 'Du hast {team} verlassen.', { team: team.name });
    if (team.members.length < 2) {
      for (const id of team.members) {
        const member = this.players.get(id);
        if (member) { member.team = 0; this.msg(member, '{team} wurde aufgelöst.', { team: team.name }); }
      }
      this.teams.delete(team.id);
      return;
    }
    if (team.leader === p.id) team.leader = team.members[0];
    this.teamMsg(team, '👥 {name} hat das Team verlassen.', { name: p.name });
  },

  // Nur der Anführer darf Mitglieder entfernen
  kick(p, targetId) {
    const team = this.teamOf(p);
    const target = this.players.get(targetId);
    if (!team || team.leader !== p.id || !target || target === p || target.team !== team.id) return;
    this.msg(target, 'Du wurdest aus {team} entfernt.', { team: team.name });
    this.leaveTeam(target, true);
    if (this.teams.has(team.id)) this.teamMsg(team, '{name} wurde aus dem Team entfernt.', { name: target.name });
  },

  // Normale Nachrichten hören nur Spieler in der Nähe; "/t …" geht an alle Teammitglieder
  chat(p, raw) {
    let text = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!text || this.now - p.chatT < C.CHAT.cooldown) return;
    let toTeam = false;
    const command = /^\/(t|team)(\s+|$)/i.exec(text);
    if (command) {
      toTeam = true;
      text = text.slice(command[0].length).trim();
      if (!text) return;
      if (!p.team) return this.msg(p, 'Du bist in keinem Team – Teamchat geht nicht.');
    }
    text = text.slice(0, C.CHAT.maxLength);
    p.chatT = this.now;
    const out = JSON.stringify({ t: 'c', id: p.id, name: p.name, text, team: toTeam ? 1 : 0 });
    for (const o of this.players.values()) {
      const hears = toTeam ? o.team === p.team : Math.hypot(o.x - p.x, o.y - p.y) <= C.CHAT.range;
      if (hears) o.conn.send(out);
    }
  },
};
