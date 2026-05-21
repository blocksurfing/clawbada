/**
 * WebSocket manager for real-time battle and queue events.
 *
 * Two routing dimensions:
 *  - **Battle rooms** keyed by battleId. Joined post-match. Receive battle
 *    lifecycle events: match_found, deposits_confirmed, round_result, etc.
 *  - **Address rooms** keyed by lowercase wallet address. Joined during queue.
 *    Receive queue lifecycle events: queue_joined, search_expanded, match_found,
 *    match_cancelled. A single address may have multiple sockets (e.g. a
 *    second tab); all receive the event.
 *
 * `match_found` is special: it's the boundary event between queue and battle.
 * The matchmaker emits it to both addresses via `notifyAddress`; clients then
 * call `join(battleId, ws, address)` to enter the battle room for subsequent
 * events.
 */

interface WSClient {
  ws: WebSocket;
  address: string;
}

type BattleEvent =
  | 'match_found'
  | 'deposits_confirmed'
  | 'round_result'
  | 'round_reveal_complete'
  | 'battle_settled'
  | 'round_started'
  | 'battle_forfeit'
  // V3 S1 queue lifecycle (sent to address rooms, not battle rooms):
  | 'queue_joined'
  | 'search_expanded'
  | 'match_cancelled';

interface BattleMessage {
  event: BattleEvent;
  /** battleId for battle-room events; empty string for address-room events
   *  (queue_joined, search_expanded, match_cancelled). `match_found` carries
   *  battleId in its `data` payload regardless of routing dimension. */
  battleId: string;
  data: unknown;
  timestamp: number;
}

function serialize(msg: BattleMessage): string {
  return JSON.stringify(msg, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

class BattleWSManager {
  /** Battle rooms — keyed by battleId. */
  private rooms = new Map<string, WSClient[]>();

  /** Address rooms — keyed by lowercased wallet address. Used for pre-battle
   *  queue events when no battleId exists yet. */
  private addressRooms = new Map<string, WSClient[]>();

  // ──────────── Battle-room API (post-match) ────────────

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
    const payload = serialize({ event, battleId, data, timestamp: Date.now() });
    this.sendAll(this.rooms, battleId, room, payload);
  }

  /** Notify a specific agent within a battle room. Used for player-targeted
   *  battle events (e.g. server-determined opponent action result). */
  notifyAgent(battleId: string, address: string, event: BattleEvent, data: unknown): void {
    const room = this.rooms.get(battleId);
    if (!room) return;
    const payload = serialize({ event, battleId, data, timestamp: Date.now() });
    const lower = address.toLowerCase();
    for (const client of room) {
      if (client.address.toLowerCase() === lower && client.ws.readyState === WebSocket.OPEN) {
        try { client.ws.send(payload); } catch { /* ignore */ }
      }
    }
  }

  getRoomSize(battleId: string): number {
    return this.rooms.get(battleId)?.length ?? 0;
  }

  // ──────────── Address-room API (pre-match / queue lifecycle) ────────────

  /** Subscribe a socket to its wallet's address room. Called when an agent's
   *  WebSocket authenticates (post-walletAuth). Multiple sockets per address
   *  are allowed — all receive notifications. */
  joinAddressRoom(address: string, ws: WebSocket): void {
    const lower = address.toLowerCase();
    const room = this.addressRooms.get(lower) ?? [];
    room.push({ ws, address: lower });
    this.addressRooms.set(lower, room);
  }

  /** Unsubscribe a socket from its address room. Called on disconnect. */
  leaveAddressRoom(address: string, ws: WebSocket): void {
    const lower = address.toLowerCase();
    const room = this.addressRooms.get(lower);
    if (!room) return;
    const filtered = room.filter((c) => c.ws !== ws);
    if (filtered.length === 0) {
      this.addressRooms.delete(lower);
    } else {
      this.addressRooms.set(lower, filtered);
    }
  }

  /** Push an event to every socket subscribed to an address. Safe to call for
   *  addresses with no live subscriber (no-op). */
  notifyAddress(address: string, event: BattleEvent, data: unknown): void {
    const lower = address.toLowerCase();
    const room = this.addressRooms.get(lower);
    if (!room) return;
    const payload = serialize({ event, battleId: '', data, timestamp: Date.now() });
    this.sendAll(this.addressRooms, lower, room, payload);
  }

  getAddressRoomSize(address: string): number {
    return this.addressRooms.get(address.toLowerCase())?.length ?? 0;
  }

  // ──────────── Internal ────────────

  /** Common send-and-prune used by both broadcast paths. */
  private sendAll(
    map: Map<string, WSClient[]>,
    key: string,
    room: WSClient[],
    payload: string,
  ): void {
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
    if (alive.length === 0) {
      map.delete(key);
    } else {
      map.set(key, alive);
    }
  }
}

export const battleWS = new BattleWSManager();
