/**
 * WebSocket manager for real-time battle events.
 *
 * Rooms are keyed by battleId. Agents join their battle room on connect
 * and receive events: match_found, deposits_confirmed, round_result, battle_settled.
 */

interface WSClient {
  ws: WebSocket;
  address: string;
}

type BattleEvent = 'match_found' | 'deposits_confirmed' | 'round_result' | 'round_reveal_complete' | 'battle_settled' | 'round_started' | 'battle_forfeit';

interface BattleMessage {
  event: BattleEvent;
  battleId: string;
  data: unknown;
  timestamp: number;
}

class BattleWSManager {
  private rooms = new Map<string, WSClient[]>();

  join(battleId: string, ws: WebSocket, address: string): void {
    const room = this.rooms.get(battleId) ?? [];
    room.push({ ws, address });
    this.rooms.set(battleId, room);
  }

  leave(battleId: string, ws: WebSocket): void {
    const room = this.rooms.get(battleId);
    if (!room) return;
    const filtered = room.filter((c) => c.ws !== ws);
    if (filtered.length === 0) {
      this.rooms.delete(battleId);
    } else {
      this.rooms.set(battleId, filtered);
    }
  }

  broadcast(battleId: string, event: BattleEvent, data: unknown): void {
    const room = this.rooms.get(battleId);
    if (!room) return;

    const message: BattleMessage = {
      event,
      battleId,
      data,
      timestamp: Date.now(),
    };
    const payload = JSON.stringify(message, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );

    const alive: WSClient[] = [];
    for (const client of room) {
      try {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(payload);
          alive.push(client);
        }
      } catch {
        // Client disconnected, skip
      }
    }
    this.rooms.set(battleId, alive);
  }

  notifyAgent(battleId: string, address: string, event: BattleEvent, data: unknown): void {
    const room = this.rooms.get(battleId);
    if (!room) return;

    const message: BattleMessage = {
      event,
      battleId,
      data,
      timestamp: Date.now(),
    };
    const payload = JSON.stringify(message, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );

    for (const client of room) {
      if (client.address.toLowerCase() === address.toLowerCase() && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(payload);
        } catch {
          // ignore
        }
      }
    }
  }

  getRoomSize(battleId: string): number {
    return this.rooms.get(battleId)?.length ?? 0;
  }
}

export const battleWS = new BattleWSManager();
