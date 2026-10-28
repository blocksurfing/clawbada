/** Battle Friends lobby: the rules (service.ts), storage (repo.ts), and the process-wide instance. */
import { v3 } from '@clawbada/game-logic';
import { battleSessions, type PracticeLobster } from '../battle-session';
import { rollTeamRoster } from '../battle-session/random-roster';
import { DbFriendRoomRepo } from './repo';
import { FriendRoomService, type FriendTeam } from './service';

export * from './service';

/** A built team → three battle lobsters with genes that really carry the chosen purity (as the Dojo builder). */
export function lobstersFor(team: FriendTeam): PracticeLobster[] {
  const r = rollTeamRoster(team.classes, team.tier, Math.random, team.purity);
  return r.classes.map((cls, i) => ({ input: { id: `t-${i}`, class: cls, tier: r.tier, purity: r.purity[i], legend: false }, partClassIds: r.partClassIds[i] }));
}

export const friendRooms = new FriendRoomService({
  repo: new DbFriendRoomRepo(),
  startBattle: async (room) => {
    const session = await battleSessions.startFriend({
      host: room.host,
      guest: room.guest,
      hostTeam: lobstersFor(room.hostTeam),
      guestTeam: lobstersFor(room.guestTeam),
      arena: room.arena as v3.ArenaLayout['tier'],
    });
    return session.record.id;
  },
  battleActive: async (battleId) => {
    if (battleSessions.get(battleId)) return true;
    const row = await battleSessions['deps'].store.get(battleId);
    return !!row && row.status === 'active';
  },
});
