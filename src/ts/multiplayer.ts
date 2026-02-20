import { Group } from "./rendering/group";
import { Geometry } from "./rendering/geometry";
import { Material } from "./rendering/material";
import { Mesh } from "./rendering/mesh";
import { Texture } from "./rendering/texture";
import { Scene } from "./rendering/scene";
import { Level } from "./level";
import { Vector3 } from "./math/vector3";
import { Quaternion } from "./math/quaternion";
import { ResourceManager } from "./resources";

const MAX_REMOTE_PLAYERS = 8;
const SEND_RATE_MS = 1000 / 30; // 30 Hz position updates

/** All available skin textures that can be chosen. Pre-loaded before scene compile. */
const ALL_SKINS = [
	"shapes/balls/pack1/uskin1.marble.png",
	"shapes/balls/pack1/uskin3.marble.png",
	"shapes/balls/pack1/uskin5.marble.png",
	"shapes/balls/pack1/uskin7.marble.png",
	"shapes/balls/pack1/uskin10.marble.png",
	"shapes/balls/pack1/uskin12.marble.png",
	"shapes/balls/pack1/uskin15.marble.png",
	"shapes/balls/pack1/uskin18.marble.png",
	"shapes/balls/pack1/uskin20.marble.png",
	"shapes/balls/pack1/uskin22.marble.png",
	"shapes/balls/pack1/uskin25.marble.png",
	"shapes/balls/pack1/uskin28.marble.png",
	"shapes/balls/pack1/uskin30.marble.png",
	"shapes/balls/pack1/uskin34.marble.png",
	"shapes/balls/pack1/uskin37.marble.png",
	"shapes/balls/pack1/uskin40.marble.png",
];

/** Player display names based on ghost slot */
const GHOST_NAMES = [
	"Player 2", "Player 3", "Player 4", "Player 5",
	"Player 6", "Player 7", "Player 8", "Player 9"
];

interface Vec3Like {
	x: number; y: number; z: number;
}

interface QuatLike {
	x: number; y: number; z: number; w: number;
}

interface RemotePlayerState {
	prevPosition: Vec3Like;
	prevOrientation: QuatLike;
	targetPosition: Vec3Like;
	targetOrientation: QuatLike;
	velocity: Vec3Like;
	targetTime: number;
	prevTime: number;
	skinIndex: number;
	ghostIndex: number;
}

interface GhostMarble {
	group: Group;
	innerGroup: Group;
	mesh: Mesh;
	active: boolean;
}

/**
 * Manages multiplayer connectivity via PartyKit.
 * Pre-allocates ghost marbles that get added to the scene before compile.
 */
export class Multiplayer {
	level: Level;
	socket: WebSocket;
	myId: string = null;
	remotePlayers: Map<string, RemotePlayerState> = new Map();
	ghostMarbles: GhostMarble[] = [];
	lastSendTime = 0;
	connected = false;

	/** All pre-loaded skin textures, indexed by skin index. */
	skinTextures: Texture[] = [];
	/** The local player's chosen skin index. */
	mySkinIndex: number = 0;

	constructor(level: Level) {
		this.level = level;
		// Restore saved skin choice
		let saved = localStorage.getItem('mp-skin-index');
		if (saved !== null) this.mySkinIndex = parseInt(saved) || 0;
	}

	/** Pre-load all skin textures and create ghost marble meshes. Call BEFORE scene.compile(). */
	async initGhostMarbles(scene: Scene) {
		// Load all skin textures
		for (let i = 0; i < ALL_SKINS.length; i++) {
			let texture = await ResourceManager.getTexture(ALL_SKINS[i], './assets/data_mbp/');
			this.skinTextures.push(texture);
		}

		// Create ghost marbles (all start with skin 0, swapped at runtime)
		for (let i = 0; i < MAX_REMOTE_PLAYERS; i++) {
			let group = new Group();
			let innerGroup = new Group();
			group.add(innerGroup);

			let geometry = Geometry.createSphereGeometry(1, 32, 16);
			let material = new Material();
			material.diffuseMap = this.skinTextures[0];
			material.normalizeNormals = true;
			material.flipY = true;
			material.differentiator = 'ghost_' + i;

			let mesh = new Mesh(geometry, [material]);
			mesh.opacity = 0;
			mesh.castShadows = true;
			innerGroup.add(mesh);

			group.scale.setScalar(0.2);
			group.position.set(0, 0, -1000);
			group.recomputeTransform();
			innerGroup.recomputeTransform();

			scene.add(group);

			this.ghostMarbles.push({
				group,
				innerGroup,
				mesh,
				active: false
			});
		}

		// Now that textures are loaded, build the skin picker and player list
		this.initUI();
	}

	/** Connect to the PartyKit server with fast retry for slow mobile connections. */
	connect(host: string, room: string) {
		let protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
		let url = `${protocol}://${host}/party/${room}`;
		this.attemptConnect(url, host, room, 0);
	}

	private attemptConnect(url: string, host: string, room: string, attempt: number) {
		try {
			console.log(`[Multiplayer] Connecting to ${url} (attempt ${attempt + 1})`);
			let socketOpened = false;
			let socket = new WebSocket(url);
			this.socket = socket;

			let retryTimeout = setTimeout(() => {
				if (!socketOpened && socket.readyState === WebSocket.CONNECTING) {
					console.warn(`[Multiplayer] Attempt ${attempt + 1} hung for 3s, retrying...`);
					socket.onopen = null;
					socket.onclose = null;
					socket.onerror = null;
					socket.onmessage = null;
					socket.close();
					if (attempt < 5 && !this.level.stopped) {
						this.attemptConnect(url, host, room, attempt + 1);
					}
				}
			}, 3000);

			socket.onopen = () => {
				socketOpened = true;
				clearTimeout(retryTimeout);
				this.connected = true;
				console.log('[Multiplayer] Connected to party server');
				this.updatePlayerList();
			};

			socket.onmessage = (event) => {
				this.handleMessage(event.data);
			};

			socket.onclose = (event) => {
				clearTimeout(retryTimeout);
				if (!socketOpened) {
					console.warn('[Multiplayer] Connection failed. code:', event.code);
				} else {
					this.connected = false;
					console.log('[Multiplayer] Disconnected. code:', event.code, 'wasClean:', event.wasClean);
				}
				this.updatePlayerList();
				if (this.socket === socket) {
					setTimeout(() => {
						if (!this.level.stopped) this.connect(host, room);
					}, 3000);
				}
			};

			socket.onerror = () => {
				console.error('[Multiplayer] WebSocket error. readyState:', socket.readyState);
			};
		} catch (e) {
			console.error('[Multiplayer] Failed to create WebSocket:', e);
		}
	}

	private handleMessage(data: string) {
		let msg: any;
		try {
			msg = JSON.parse(data);
		} catch {
			return;
		}

		switch (msg.type) {
			case 'init': {
				this.myId = msg.id;
				for (let [id, player] of Object.entries(msg.players)) {
					if (id === this.myId) continue;
					this.addRemotePlayer(id, player as any);
				}
				break;
			}
			case 'player_joined': {
				if (msg.id === this.myId) break;
				this.addRemotePlayer(msg.id, msg.player);
				break;
			}
			case 'player_update': {
				let remote = this.remotePlayers.get(msg.id);
				if (!remote) break;
				remote.prevPosition = { ...remote.targetPosition };
				remote.prevOrientation = { ...remote.targetOrientation };
				remote.prevTime = remote.targetTime;
				remote.targetPosition = msg.position;
				remote.targetOrientation = msg.orientation;
				remote.velocity = msg.velocity;
				remote.targetTime = performance.now();
				// Update skin if changed
				if (msg.skinIndex !== undefined && msg.skinIndex !== remote.skinIndex) {
					remote.skinIndex = msg.skinIndex;
					this.applyGhostSkin(remote.ghostIndex, remote.skinIndex);
				}
				break;
			}
			case 'player_left': {
				this.removeRemotePlayer(msg.id);
				break;
			}
			case 'collision': {
				if (!msg.pairs) break;
				for (let pair of msg.pairs) {
					if (pair.id === this.myId) {
						// Apply correction to local marble
						let marble = this.level.marble;
						if (marble && marble.body) {
							marble.body.position.set(pair.position.x, pair.position.y, pair.position.z);
							marble.body.linearVelocity.set(pair.velocity.x, pair.velocity.y, pair.velocity.z);
							marble.body.syncShapes();
						}
					} else {
						// Update remote player's target position from the collision correction
						let remote = this.remotePlayers.get(pair.id);
						if (remote) {
							remote.prevPosition = { ...remote.targetPosition };
							remote.prevTime = remote.targetTime;
							remote.targetPosition = pair.position;
							remote.velocity = pair.velocity;
							remote.targetTime = performance.now();
						}
					}
				}
				break;
			}
		}
	}

	private addRemotePlayer(id: string, playerData: any) {
		let ghostIndex = -1;
		for (let i = 0; i < this.ghostMarbles.length; i++) {
			if (!this.ghostMarbles[i].active) {
				ghostIndex = i;
				break;
			}
		}
		if (ghostIndex === -1) return;

		this.ghostMarbles[ghostIndex].active = true;
		this.ghostMarbles[ghostIndex].mesh.opacity = 1;

		let pos = playerData.position || { x: 0, y: 0, z: 0 };
		let ori = playerData.orientation || { x: 0, y: 0, z: 0, w: 1 };
		let skinIndex = playerData.skinIndex || 0;
		let now = performance.now();

		this.remotePlayers.set(id, {
			prevPosition: { ...pos },
			prevOrientation: { ...ori },
			targetPosition: { ...pos },
			targetOrientation: { ...ori },
			velocity: playerData.velocity || { x: 0, y: 0, z: 0 },
			prevTime: now,
			targetTime: now,
			skinIndex,
			ghostIndex
		});

		// Apply the remote player's chosen skin to their ghost marble
		this.applyGhostSkin(ghostIndex, skinIndex);

		console.log(`[Multiplayer] Player joined: ${id} (ghost ${ghostIndex}, skin ${skinIndex})`);
		this.updatePlayerList();
	}

	/** Swap the texture on a ghost marble to match a skin index. */
	private applyGhostSkin(ghostIndex: number, skinIndex: number) {
		let ghost = this.ghostMarbles[ghostIndex];
		if (!ghost) return;
		let texture = this.skinTextures[skinIndex % this.skinTextures.length];
		if (texture) {
			ghost.mesh.materials[0].diffuseMap = texture;
		}
	}

	private removeRemotePlayer(id: string) {
		let remote = this.remotePlayers.get(id);
		if (!remote) return;

		let ghost = this.ghostMarbles[remote.ghostIndex];
		ghost.active = false;
		ghost.mesh.opacity = 0;
		ghost.group.position.set(0, 0, -1000);
		ghost.group.recomputeTransform();

		this.remotePlayers.delete(id);
		console.log(`[Multiplayer] Player left: ${id}`);
		this.updatePlayerList();
	}

	/** Send local marble state to the server. */
	sendUpdate() {
		if (!this.connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;

		let now = performance.now();
		if (now - this.lastSendTime < SEND_RATE_MS) return;
		this.lastSendTime = now;

		let marble = this.level.marble;
		if (!marble || !marble.body) return;

		let pos = marble.body.position;
		let ori = marble.body.orientation;
		let vel = marble.body.linearVelocity;

		this.socket.send(JSON.stringify({
			type: 'update',
			position: { x: pos.x, y: pos.y, z: pos.z },
			orientation: { x: ori.x, y: ori.y, z: ori.z, w: ori.w },
			velocity: { x: vel.x, y: vel.y, z: vel.z },
			skinIndex: this.mySkinIndex
		}));
	}

	/** Update ghost marble positions with smooth entity interpolation. */
	updateGhostMarbles(_physicsTickCompletion: number) {
		let renderTime = performance.now() - SEND_RATE_MS;

		for (let [_id, remote] of this.remotePlayers) {
			let ghost = this.ghostMarbles[remote.ghostIndex];
			if (!ghost || !ghost.active) continue;

			let interval = remote.targetTime - remote.prevTime;
			if (interval <= 0) interval = SEND_RATE_MS;

			let t = (renderTime - remote.prevTime) / interval;
			if (t < 0) t = 0;

			let px: number, py: number, pz: number;
			if (t <= 1) {
				px = remote.prevPosition.x + (remote.targetPosition.x - remote.prevPosition.x) * t;
				py = remote.prevPosition.y + (remote.targetPosition.y - remote.prevPosition.y) * t;
				pz = remote.prevPosition.z + (remote.targetPosition.z - remote.prevPosition.z) * t;
			} else {
				let extraSec = (t - 1) * interval / 1000;
				if (extraSec > 0.15) extraSec = 0.15;
				px = remote.targetPosition.x + remote.velocity.x * extraSec;
				py = remote.targetPosition.y + remote.velocity.y * extraSec;
				pz = remote.targetPosition.z + remote.velocity.z * extraSec;
			}
			ghost.group.position.set(px, py, pz);

			let ot = t > 1 ? 1 : t;
			let ax = remote.prevOrientation.x, ay = remote.prevOrientation.y;
			let az = remote.prevOrientation.z, aw = remote.prevOrientation.w;
			let bx = remote.targetOrientation.x, by = remote.targetOrientation.y;
			let bz = remote.targetOrientation.z, bw = remote.targetOrientation.w;

			let dot = ax * bx + ay * by + az * bz + aw * bw;
			if (dot < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; dot = -dot; }

			let rx: number, ry: number, rz: number, rw: number;
			if (dot > 0.9995) {
				rx = ax + (bx - ax) * ot; ry = ay + (by - ay) * ot;
				rz = az + (bz - az) * ot; rw = aw + (bw - aw) * ot;
			} else {
				let theta = Math.acos(dot);
				let sinTheta = Math.sin(theta);
				let wa = Math.sin((1 - ot) * theta) / sinTheta;
				let wb = Math.sin(ot * theta) / sinTheta;
				rx = ax * wa + bx * wb; ry = ay * wa + by * wb;
				rz = az * wa + bz * wb; rw = aw * wa + bw * wb;
			}

			let len = Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw);
			if (len > 0) { rx /= len; ry /= len; rz /= len; rw /= len; }

			ghost.innerGroup.orientation.set(rx, ry, rz, rw);
			ghost.group.scale.setScalar(0.2);
			ghost.group.recomputeTransform();
			ghost.innerGroup.recomputeTransform();
		}
	}

	/** Build the skin picker and player list UI. */
	private initUI() {
		this.buildSkinPicker();
		this.updatePlayerList();
	}

	/** Apply the chosen skin to the local player's marble. */
	private applyLocalSkin(skinIndex: number) {
		let texture = this.skinTextures[skinIndex % this.skinTextures.length];
		if (!texture) return;

		let marble = this.level.marble;
		if (!marble) return;

		// Update the sphere mesh material
		if (marble.sphere && marble.sphere.materials[0]) {
			marble.sphere.materials[0].diffuseMap = texture;
		}
	}

	/** Create the skin picker with thumbnail previews (collapsible). */
	private buildSkinPicker() {
		let container = document.getElementById('mp-skin-picker-container');
		let picker = document.getElementById('mp-skin-picker');
		let toggle = document.getElementById('mp-skin-picker-toggle');
		if (!picker || !container || !toggle) return;

		// Toggle expand/collapse
		toggle.addEventListener('click', () => {
			container.classList.toggle('expanded');
		});

		for (let i = 0; i < ALL_SKINS.length; i++) {
			let btn = document.createElement('div');
			btn.className = 'mp-skin-option' + (i === this.mySkinIndex ? ' selected' : '');
			btn.dataset.index = String(i);

			let tex = this.skinTextures[i];
			if (tex && tex.image) {
				let img = document.createElement('img');
				img.src = (tex.image as HTMLImageElement).src;
				btn.appendChild(img);
			}

			btn.addEventListener('click', () => {
				this.mySkinIndex = i;
				localStorage.setItem('mp-skin-index', String(i));
				picker.querySelectorAll('.mp-skin-option').forEach(el => el.classList.remove('selected'));
				btn.classList.add('selected');
				// Apply to local marble immediately
				this.applyLocalSkin(i);
			});

			picker.appendChild(btn);
		}

		// Apply saved skin on load
		this.applyLocalSkin(this.mySkinIndex);
	}

	/** Update the player list UI. */
	private updatePlayerList() {
		let container = document.getElementById('mp-player-list-entries');
		if (!container) return;

		container.innerHTML = '';

		let selfEntry = document.createElement('div');
		selfEntry.className = 'mp-player-entry';
		selfEntry.innerHTML = `
			<span class="mp-player-dot ${this.connected ? 'online' : 'offline'}"></span>
			<span class="mp-player-name you">You</span>
		`;
		container.appendChild(selfEntry);

		for (let [_id, remote] of this.remotePlayers) {
			let name = GHOST_NAMES[remote.ghostIndex] || `Player ${remote.ghostIndex + 2}`;
			let entry = document.createElement('div');
			entry.className = 'mp-player-entry';
			entry.innerHTML = `
				<span class="mp-player-dot online"></span>
				<span class="mp-player-name">${name}</span>
			`;
			container.appendChild(entry);
		}
	}

	/** Clean up on level exit. */
	dispose() {
		if (this.socket) {
			this.socket.close();
			this.socket = null;
		}
		this.connected = false;
		this.remotePlayers.clear();
	}
}
