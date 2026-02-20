/** @typedef {{ x: number, y: number, z: number }} Vec3 */
/** @typedef {{ x: number, y: number, z: number, w: number }} Quat */

const MARBLE_RADIUS = 0.2;
const COLLISION_DIST = MARBLE_RADIUS * 2;
const COLLISION_RESTITUTION = 0.6;

/**
 * PartyKit server for Marble Blast multiplayer.
 * Syncs marble positions, orientations, and skin choices between all connected players.
 * Handles sphere-sphere collision between players for mutual bumping.
 */
export default class MarblePartyServer {
  constructor(room) {
    /** @type {import("partykit/server").Room} */
    this.room = room;

    /**
     * Player state keyed by connection ID.
     * @type {Record<string, { position: Vec3, orientation: Quat, velocity: Vec3, skinIndex: number }>}
     */
    this.players = {};
  }

  onConnect(conn) {
    this.players[conn.id] = {
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 0, y: 0, z: 0 },
      skinIndex: 0
    };

    // Send the new player their ID and the current state of all players
    conn.send(JSON.stringify({
      type: 'init',
      id: conn.id,
      players: this.players
    }));

    // Tell everyone else about the new player
    this.room.broadcast(JSON.stringify({
      type: 'player_joined',
      id: conn.id,
      player: this.players[conn.id]
    }), [conn.id]);
  }

  onMessage(message, sender) {
    let data;
    try {
      data = JSON.parse(/** @type {string} */ (message));
    } catch {
      return;
    }

    if (data.type === 'update') {
      const player = this.players[sender.id];
      if (!player) return;

      player.position = data.position;
      player.orientation = data.orientation;
      player.velocity = data.velocity;
      if (data.skinIndex !== undefined) player.skinIndex = data.skinIndex;

      // Check for collisions with other players
      this.checkCollisions(sender.id);

      this.room.broadcast(JSON.stringify({
        type: 'player_update',
        id: sender.id,
        position: player.position,
        orientation: player.orientation,
        velocity: player.velocity,
        skinIndex: player.skinIndex
      }), [sender.id]);
    }
  }

  /** Detect sphere-sphere collisions and apply elastic impulse to both players. */
  checkCollisions(senderId) {
    const sender = this.players[senderId];
    if (!sender) return;

    for (const otherId of Object.keys(this.players)) {
      if (otherId === senderId) continue;
      const other = this.players[otherId];

      const dx = sender.position.x - other.position.x;
      const dy = sender.position.y - other.position.y;
      const dz = sender.position.z - other.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq >= COLLISION_DIST * COLLISION_DIST || distSq < 0.0001) continue;

      const dist = Math.sqrt(distSq);
      // Collision normal from other towards sender
      const nx = dx / dist;
      const ny = dy / dist;
      const nz = dz / dist;

      // Relative velocity along the collision normal
      const rvx = sender.velocity.x - other.velocity.x;
      const rvy = sender.velocity.y - other.velocity.y;
      const rvz = sender.velocity.z - other.velocity.z;
      const relVelNormal = rvx * nx + rvy * ny + rvz * nz;

      // Only resolve if moving towards each other
      if (relVelNormal > 0) continue;

      // Elastic collision impulse (equal mass)
      const impulse = -(1 + COLLISION_RESTITUTION) * relVelNormal / 2;

      sender.velocity.x += impulse * nx;
      sender.velocity.y += impulse * ny;
      sender.velocity.z += impulse * nz;
      other.velocity.x -= impulse * nx;
      other.velocity.y -= impulse * ny;
      other.velocity.z -= impulse * nz;

      // Separate positions so they don't overlap
      const overlap = COLLISION_DIST - dist;
      const sep = overlap / 2 + 0.005;
      sender.position.x += nx * sep;
      sender.position.y += ny * sep;
      sender.position.z += nz * sep;
      other.position.x -= nx * sep;
      other.position.y -= ny * sep;
      other.position.z -= nz * sep;

      // Send collision correction to both players
      this.room.broadcast(JSON.stringify({
        type: 'collision',
        pairs: [
          { id: senderId, position: sender.position, velocity: sender.velocity },
          { id: otherId, position: other.position, velocity: other.velocity }
        ]
      }));
    }
  }

  onClose(conn) {
    delete this.players[conn.id];

    this.room.broadcast(JSON.stringify({
      type: 'player_left',
      id: conn.id
    }));
  }

  onError(conn, error) {
    console.error(`Connection error for ${conn.id}:`, error);
    this.onClose(conn);
  }
}
