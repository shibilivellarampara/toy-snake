import {
  completeGuestConnection,
  completeHostConnection,
  createGuestAnswer,
  createHostOffer,
} from "./webrtc";
import type { PeerLink } from "./webrtc";
import { PLAYER_COLORS, randomPlayerId } from "./protocol";
import type { Accessory, NetMessage, PlayerInfo } from "./protocol";
import { randomRoomCode, relayDelete, relayGet, relayPut, sleep } from "./relay";

interface QRPayload {
  k: "offer" | "answer";
  sdp: RTCSessionDescriptionInit;
}

function encodePayload(p: QRPayload): string {
  return JSON.stringify(p);
}

function decodePayload(raw: string): QRPayload {
  const parsed = JSON.parse(raw);
  if (parsed.k !== "offer" && parsed.k !== "answer") throw new Error("Not a Toy Snake pairing code");
  return parsed as QRPayload;
}

type Listener<T> = (arg: T) => void;

const POLL_INTERVAL_MS = 1500;
const WAIT_TIMEOUT_MS = 5 * 60 * 1000;

export interface PendingInvite {
  code: string;
  waitForGuest: Promise<PlayerInfo>;
  cancel: () => void;
}

/** Runs on the device that starts the game; relays state between all guests. */
export class HostLobby {
  players: PlayerInfo[] = [];
  localPlayer: PlayerInfo;
  private links = new Map<string, PeerLink>();
  private nextSlot = 1;
  private rosterListeners: Listener<PlayerInfo[]>[] = [];
  private messageListeners: Listener<{ msg: NetMessage; fromId: string }>[] = [];

  constructor(localPlayer: PlayerInfo) {
    this.localPlayer = localPlayer;
    this.players = [localPlayer];
  }

  onRosterChange(fn: Listener<PlayerInfo[]>) {
    this.rosterListeners.push(fn);
  }

  onMessage(fn: Listener<{ msg: NetMessage; fromId: string }>) {
    this.messageListeners.push(fn);
  }

  /**
   * Generates a fresh invite (a short room code, backed by a relay so the
   * QR only needs to encode the code itself) and waits for a guest to
   * connect. Resolves once that guest's data channel is open and roster'd.
   */
  createInvite(): PendingInvite {
    const code = randomRoomCode();
    let cancelled = false;

    const waitForGuest = (async () => {
      const { pc, control, state, offer } = await createHostOffer();
      await relayPut(`offer-${code}`, encodePayload({ k: "offer", sdp: offer }));

      const deadline = Date.now() + WAIT_TIMEOUT_MS;
      while (!cancelled) {
        if (Date.now() > deadline) throw new Error("No one joined in time. Try generating a new code.");
        await sleep(POLL_INTERVAL_MS);
        if (cancelled) break;
        const answerText = await relayGet(`answer-${code}`);
        if (answerText) {
          relayDelete(`offer-${code}`);
          relayDelete(`answer-${code}`);
          return this.acceptAnswer(pc, control, state, answerText);
        }
      }
      pc.close();
      throw new Error("Cancelled");
    })();

    return {
      code,
      waitForGuest,
      cancel: () => {
        cancelled = true;
      },
    };
  }

  private async acceptAnswer(
    pc: RTCPeerConnection,
    control: RTCDataChannel,
    state: RTCDataChannel,
    answerPayload: string,
  ): Promise<PlayerInfo> {
    const parsed = decodePayload(answerPayload);
    if (parsed.k !== "answer") throw new Error("That code is an invite, not an answer.");
    const link = await completeHostConnection(pc, control, state, parsed.sdp);

    let resolvedId = randomPlayerId();
    return new Promise<PlayerInfo>((resolve) => {
      link.onMessage((msg) => {
        if (msg.type === "hello") {
          const slot = this.nextSlot++;
          const color = this.assignColor(msg.player.color);
          const info: PlayerInfo = {
            id: msg.player.id,
            name: msg.player.name || `Player ${slot + 1}`,
            color,
            slot,
            accessory: msg.player.accessory,
          };
          resolvedId = info.id;
          this.links.set(info.id, link);
          this.players = [...this.players.filter((p) => p.id !== info.id), info].sort(
            (a, b) => a.slot - b.slot,
          );
          this.broadcastRoster();
          resolve(info);
        } else {
          this.messageListeners.forEach((fn) => fn({ msg, fromId: resolvedId }));
          this.relay(msg, resolvedId);
        }
      });
      link.onClose(() => this.removePlayer(resolvedId));
    });
  }

  private assignColor(preferred: string) {
    const used = new Set(this.players.map((p) => p.color));
    if (preferred && !used.has(preferred)) return preferred;
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[this.players.length % PLAYER_COLORS.length];
  }

  private relay(msg: NetMessage, fromId: string) {
    for (const [id, link] of this.links) {
      if (id !== fromId) link.send(msg);
    }
  }

  /** Send to every connected guest (state messages go on the unreliable channel). */
  broadcast(msg: NetMessage) {
    for (const link of this.links.values()) link.send(msg);
    if (msg.type === "roster") this.rosterListeners.forEach((fn) => fn(this.players));
  }

  private broadcastRoster() {
    this.broadcast({ type: "roster", players: this.players });
  }

  private removePlayer(id: string) {
    if (!this.links.has(id)) return;
    this.links.delete(id);
    this.players = this.players.filter((p) => p.id !== id);
    this.broadcastRoster();
  }

  get connectedCount() {
    return this.links.size;
  }

  /** Closes every guest connection (e.g. when the host leaves for the menu). */
  close() {
    for (const link of this.links.values()) link.close();
    this.links.clear();
  }
}

/** Runs on a friend's device joining someone else's game. */
export class GuestLobby {
  private link: PeerLink | null = null;
  players: PlayerInfo[] = [];
  localPlayer: PlayerInfo;
  private rosterListeners: Listener<PlayerInfo[]>[] = [];
  private messageListeners: Listener<NetMessage>[] = [];

  constructor(name: string, preferredColor: string, accessory: Accessory) {
    this.localPlayer = { id: randomPlayerId(), name, color: preferredColor, slot: -1, accessory };
  }

  onRosterChange(fn: Listener<PlayerInfo[]>) {
    this.rosterListeners.push(fn);
  }

  onMessage(fn: Listener<NetMessage>) {
    this.messageListeners.push(fn);
  }

  /** Looks up the host's offer by room code, answers it, and connects. */
  async connectWithCode(code: string): Promise<void> {
    const offerText = await relayGet(`offer-${code}`);
    if (!offerText) throw new Error("No game found with that code. Double-check the digits with your host.");
    const parsed = decodePayload(offerText);
    if (parsed.k !== "offer") throw new Error("That code isn't a valid invite.");

    const created = await createGuestAnswer(parsed.sdp);
    const answerPayload = encodePayload({ k: "answer", sdp: created.answer });
    await relayPut(`answer-${code}`, answerPayload);

    const link = await completeGuestConnection(created);
    this.link = link;
    link.onMessage((msg) => this.handleMessage(msg));
    link.send({ type: "hello", player: this.localPlayer });
  }

  private handleMessage(msg: NetMessage) {
    if (msg.type === "roster") {
      this.players = msg.players;
      const me = msg.players.find((p) => p.id === this.localPlayer.id);
      if (me) this.localPlayer = me;
      this.rosterListeners.forEach((fn) => fn(this.players));
      return;
    }
    this.messageListeners.forEach((fn) => fn(msg));
  }

  send(msg: NetMessage) {
    this.link?.send(msg);
  }

  get connected() {
    return !!this.link;
  }

  /** Closes the connection to the host (e.g. when leaving for the menu). */
  close() {
    this.link?.close();
    this.link = null;
  }
}
