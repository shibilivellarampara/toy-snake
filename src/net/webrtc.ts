import type { NetMessage } from "./protocol";

/**
 * No signaling server exists (by design: fully local/offline play). We rely
 * purely on locally-gathered ICE candidates (host + srflx if a router
 * provides one) exchanged out-of-band via QR codes. iceServers is left empty
 * so no STUN/TURN lookup (and therefore no internet access) is required.
 */
const RTC_CONFIG: RTCConfiguration = { iceServers: [] };

const CONTROL_LABEL = "control";
const STATE_LABEL = "state";

export interface PeerLink {
  pc: RTCPeerConnection;
  send: (msg: NetMessage) => void;
  onMessage: (handler: (msg: NetMessage) => void) => void;
  onClose: (handler: () => void) => void;
  close: () => void;
}

function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
    // Safety timeout: proceed with whatever candidates we have gathered.
    setTimeout(resolve, 2500);
  });
}

export interface CreatedOffer {
  pc: RTCPeerConnection;
  control: RTCDataChannel;
  state: RTCDataChannel;
  offer: RTCSessionDescriptionInit;
}

export async function createHostOffer(): Promise<CreatedOffer> {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const control = pc.createDataChannel(CONTROL_LABEL, { ordered: true });
  const state = pc.createDataChannel(STATE_LABEL, { ordered: false, maxRetransmits: 0 });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGatheringComplete(pc);
  return { pc, control, state, offer: pc.localDescription! };
}

export interface CreatedAnswer {
  pc: RTCPeerConnection;
  answer: RTCSessionDescriptionInit;
  channelsPromise: Promise<{ control: RTCDataChannel; state: RTCDataChannel }>;
}

export async function createGuestAnswer(offer: RTCSessionDescriptionInit): Promise<CreatedAnswer> {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const found: Partial<{ control: RTCDataChannel; state: RTCDataChannel }> = {};
  const channelsPromise = new Promise<{ control: RTCDataChannel; state: RTCDataChannel }>((resolve) => {
    pc.ondatachannel = (ev) => {
      if (ev.channel.label === CONTROL_LABEL) found.control = ev.channel;
      if (ev.channel.label === STATE_LABEL) found.state = ev.channel;
      if (found.control && found.state) resolve({ control: found.control, state: found.state });
    };
  });

  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGatheringComplete(pc);
  return { pc, answer: pc.localDescription!, channelsPromise };
}

export async function completeHostConnection(
  pc: RTCPeerConnection,
  control: RTCDataChannel,
  state: RTCDataChannel,
  answer: RTCSessionDescriptionInit,
): Promise<PeerLink> {
  await pc.setRemoteDescription(answer);
  await Promise.all([waitForChannelOpen(control), waitForChannelOpen(state)]);
  return wrapChannels(pc, control, state);
}

export async function completeGuestConnection(created: CreatedAnswer): Promise<PeerLink> {
  const { control, state } = await created.channelsPromise;
  await Promise.all([waitForChannelOpen(control), waitForChannelOpen(state)]);
  return wrapChannels(created.pc, control, state);
}

function waitForChannelOpen(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState === "open") return Promise.resolve();
  return new Promise((resolve) => {
    channel.addEventListener("open", () => resolve(), { once: true });
  });
}

function wrapChannels(pc: RTCPeerConnection, control: RTCDataChannel, state: RTCDataChannel): PeerLink {
  const parse = (raw: string): NetMessage | null => {
    try {
      return JSON.parse(raw) as NetMessage;
    } catch {
      return null;
    }
  };
  return {
    pc,
    send: (msg: NetMessage) => {
      const channel = msg.type === "state" ? state : control;
      if (channel.readyState === "open") channel.send(JSON.stringify(msg));
    },
    onMessage: (handler) => {
      const listen = (ch: RTCDataChannel) =>
        ch.addEventListener("message", (ev) => {
          const msg = parse(ev.data);
          if (msg) handler(msg);
        });
      listen(control);
      listen(state);
    },
    onClose: (handler) => {
      control.addEventListener("close", handler, { once: true });
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") handler();
      });
    },
    close: () => {
      try {
        control.close();
      } catch {}
      try {
        state.close();
      } catch {}
      try {
        pc.close();
      } catch {}
    },
  };
}
