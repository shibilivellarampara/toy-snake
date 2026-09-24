/**
 * Tiny ephemeral key/value relay used only to hand off the WebRTC
 * offer/answer between two devices when QR scanning isn't practical. Once
 * the data channel connects, all gameplay traffic is direct peer-to-peer —
 * this relay never sees game state, just a short-lived SDP blob per code.
 */
const BUCKET = "UbzvviNE82S3rcTFc8LdDi";
const BASE = `https://kvdb.io/${BUCKET}`;

export async function relayPut(key: string, value: string): Promise<void> {
  const res = await fetch(`${BASE}/${key}`, { method: "POST", body: value });
  if (!res.ok) throw new Error("Couldn't reach the pairing relay. Check your internet connection.");
}

export async function relayGet(key: string): Promise<string | null> {
  const res = await fetch(`${BASE}/${key}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Couldn't reach the pairing relay. Check your internet connection.");
  return res.text();
}

export function relayDelete(key: string): void {
  fetch(`${BASE}/${key}`, { method: "DELETE" }).catch(() => {
    /* best-effort cleanup only */
  });
}

export function randomRoomCode(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
