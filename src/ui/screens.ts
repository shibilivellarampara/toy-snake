import { h, button } from "./dom";
import { GameLoop } from "../game/loop";
import { GameSession } from "../game/session";
import { InputManager } from "../game/input";
import { sound } from "../game/sound";
import { computeBoardLayout, drawBoard, drawDeathEffects, drawFood, drawSnake } from "../game/renderer";
import type { RenderSnake } from "../game/renderer";
import { GRID_COLS, GRID_ROWS } from "../game/grid";
import { PLAYER_COLORS, randomPlayerId } from "../net/protocol";
import type { Accessory, PlayerInfo } from "../net/protocol";
import { HostLobby, GuestLobby } from "../net/lobby";
import { renderQR, startQRScan } from "../net/qr";
import type { QRScanner } from "../net/qr";

const PROFILE_KEY = "toy-snake:profile";

interface Profile {
  name: string;
  color: string;
  muted: boolean;
  botCount: number;
  accessory: Accessory;
}

function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return { muted: false, botCount: 3, accessory: "none", ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { name: "Player", color: PLAYER_COLORS[3], muted: false, botCount: 3, accessory: "none" };
}

function saveProfile(p: Profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

// A real app URL (not just a short code) so scanning with the phone's own
// camera app opens Toy Snake directly and joins, without needing the
// in-app scanner already open.
function codeToQrPayload(code: string) {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("code", code);
  return url.toString();
}

function qrPayloadToCode(text: string): string {
  const trimmed = text.trim();
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    if (code && /^\d{4}$/.test(code)) return code;
  } catch {
    /* not a URL, fall through */
  }
  const m = trimmed.match(/^TS:(\d{4})$/);
  if (m) return m[1];
  throw new Error("That's not a Toy Snake code. Try typing the 4-digit code instead.");
}

const HUD_RESERVE_TOP = 64;
const MAX_BOTS = 7;

export class App {
  private uiRoot: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  private input?: InputManager;
  private loop?: GameLoop;
  private session?: GameSession;
  private activeScanner?: QRScanner;
  private profile: Profile = loadProfile();
  private resultsShown = false;

  private activeHostLobby?: HostLobby;
  private activeGuestLobby?: GuestLobby;
  private vsComputer = false;

  private prevCountdownSecond = -1;
  private wasLocalAlive = true;
  private deathFlashUntil = 0;

  constructor(mount: HTMLElement) {
    this.canvas = h("canvas", "game-canvas");
    this.uiRoot = h("div", "ui-root");
    mount.append(this.canvas, this.uiRoot);
    this.ctx = this.canvas.getContext("2d")!;
    sound.setMuted(this.profile.muted);

    window.addEventListener("resize", this.resizeCanvas);
    window.addEventListener("orientationchange", this.onOrientationChange);
    window.visualViewport?.addEventListener("resize", this.resizeCanvas);
    this.resizeCanvas();

    const deepLinkCode = new URLSearchParams(window.location.search).get("code");
    history.replaceState(null, "", window.location.pathname);
    if (deepLinkCode && /^\d{4}$/.test(deepLinkCode)) {
      this.showJoinLobby(deepLinkCode);
    } else {
      this.showMenu();
    }
  }

  private resizeCanvas = () => {
    const vv = window.visualViewport;
    const width = Math.round(vv?.width ?? window.innerWidth);
    const height = Math.round(vv?.height ?? window.innerHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);
    this.canvas.style.width = width + "px";
    this.canvas.style.height = height + "px";
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  private onOrientationChange = () => {
    this.resizeCanvas();
    setTimeout(this.resizeCanvas, 60);
    setTimeout(this.resizeCanvas, 250);
  };

  private ensureCanvasSize() {
    const cssWidth = this.canvas.clientWidth;
    const cssHeight = this.canvas.clientHeight;
    if (cssWidth <= 0 || cssHeight <= 0) return;
    const expectedW = Math.round(cssWidth * this.dpr);
    const expectedH = Math.round(cssHeight * this.dpr);
    if (Math.abs(this.canvas.width - expectedW) > 1 || Math.abs(this.canvas.height - expectedH) > 1) {
      this.resizeCanvas();
    }
  }

  private setScreen(el: HTMLElement) {
    this.stopScanner();
    this.uiRoot.replaceChildren(el);
  }

  private stopScanner() {
    this.activeScanner?.stop();
    this.activeScanner = undefined;
  }

  private teardownGame() {
    this.loop?.stop();
    this.loop = undefined;
    this.input?.destroy();
    this.input = undefined;
    this.session = undefined;
    this.resultsShown = false;
    this.wasLocalAlive = true;
  }

  // ---------------------------------------------------------------- Menu --

  private showMenu() {
    this.teardownGame();
    this.activeHostLobby?.close();
    this.activeHostLobby = undefined;
    this.activeGuestLobby?.close();
    this.activeGuestLobby = undefined;
    this.canvas.classList.remove("visible");

    const nameInput = h("input", "name-input") as HTMLInputElement;
    nameInput.maxLength = 14;
    nameInput.placeholder = "Your name";
    nameInput.value = this.profile.name;
    nameInput.addEventListener("input", () => {
      this.profile.name = nameInput.value.trim() || "Player";
      saveProfile(this.profile);
    });

    const swatches = h(
      "div",
      "color-swatches",
      ...PLAYER_COLORS.map((c) => {
        const dot = h("div", "swatch");
        dot.style.background = c;
        if (c === this.profile.color) dot.classList.add("selected");
        dot.addEventListener("click", () => {
          this.profile.color = c;
          saveProfile(this.profile);
          swatches.querySelectorAll(".swatch").forEach((s) => s.classList.remove("selected"));
          dot.classList.add("selected");
        });
        return dot;
      }),
    );

    const muteBtn = button(this.profile.muted ? "🔇 Off" : "🔊 On", "chip-btn", () => {
      this.profile.muted = !this.profile.muted;
      saveProfile(this.profile);
      sound.setMuted(this.profile.muted);
      muteBtn.textContent = this.profile.muted ? "🔇 Off" : "🔊 On";
    });

    const ACCESSORY_OPTIONS: { value: Accessory; label: string }[] = [
      { value: "none", label: "None" },
      { value: "crown", label: "👑 Crown" },
      { value: "clip", label: "🎀 Clip" },
    ];
    const accessoryRow = h("div", "color-swatches");
    const renderAccessoryRow = () => {
      accessoryRow.replaceChildren(
        ...ACCESSORY_OPTIONS.map((opt) =>
          button(opt.label, `chip-btn${opt.value === this.profile.accessory ? " selected" : ""}`, () => {
            this.profile.accessory = opt.value;
            saveProfile(this.profile);
            renderAccessoryRow();
          }),
        ),
      );
    };
    renderAccessoryRow();

    const screen = h(
      "div",
      "screen menu-screen",
      h("h1", "title", "🐍 Toy Snake"),
      h(
        "p",
        "subtitle",
        "Grid snake with apples, battle-royale style, with friends. Connect over the same Wi-Fi — no internet or account needed.",
      ),
      h("label", "field-label", "Name", nameInput),
      h("label", "field-label", "Color", swatches),
      h("label", "field-label", "Accessory", accessoryRow),
      h("div", "field-label", "Sound", muteBtn),
      h(
        "div",
        "menu-actions",
        button("Host a Game", "btn btn-primary", () => this.showHostLobby()),
        button("Join a Game", "btn btn-secondary", () => this.showJoinLobby()),
        button("🖥 Play vs Computer", "btn btn-secondary", () => this.showVsComputerSetup()),
      ),
      h(
        "p",
        "hint",
        "Bluetooth can't run inside an installed web app on iPhone, so nearby multiplayer works over a shared Wi-Fi/hotspot instead — the host shares a 4-digit code (or QR), everyone else enters it with Join. Highest score when the board clears wins.",
      ),
      h("p", "credit-line", "Developed by Shibil"),
    );
    this.setScreen(screen);
  }

  private localPlayerInfo(slot: number): PlayerInfo {
    return {
      id: randomPlayerId(),
      name: this.profile.name,
      color: this.profile.color,
      slot,
      accessory: this.profile.accessory,
    };
  }

  // ---------------------------------------------------------- Host lobby --

  private showHostLobby() {
    const localInfo = this.localPlayerInfo(0);
    const hostLobby = new HostLobby(localInfo);
    hostLobby.onMessage(({ msg }) => this.session?.handleNetMessage(msg));

    const rosterEl = h("div", "roster-list");
    const statusEl = h("p", "status-text", "");
    const inviteBox = h("div", "invite-box");

    const renderRoster = (players: PlayerInfo[]) => {
      rosterEl.replaceChildren(...players.map((p) => rosterItem(p, p.id === localInfo.id ? " (you, host)" : "")));
    };
    renderRoster(hostLobby.players);
    hostLobby.onRosterChange(renderRoster);

    const addPlayerBtn = button("+ Add Player", "btn btn-secondary", () => startInvite());

    const startInvite = () => {
      addPlayerBtn.disabled = true;
      inviteBox.replaceChildren();

      const invite = hostLobby.createInvite();
      const qrCanvas = h("canvas");
      const cancelBtn = button("Cancel", "btn btn-ghost", () => {
        invite.cancel();
        inviteBox.replaceChildren();
        addPlayerBtn.disabled = false;
        statusEl.textContent = "";
      });
      inviteBox.append(
        h("p", "hint", "Give your friend this code, or let them scan the QR:"),
        h("div", "room-code", invite.code),
        qrCanvas,
        cancelBtn,
      );
      renderQR(qrCanvas, codeToQrPayload(invite.code)).catch(() => {});
      statusEl.textContent = `Waiting for a friend to enter ${invite.code}…`;

      invite.waitForGuest
        .then(() => {
          statusEl.textContent = "Player connected! Add another, or start the game.";
          inviteBox.replaceChildren();
          addPlayerBtn.disabled = false;
        })
        .catch((err) => {
          inviteBox.replaceChildren();
          addPlayerBtn.disabled = false;
          if (!(err instanceof Error && err.message === "Cancelled")) {
            statusEl.textContent = errorMessage(err);
          }
        });
    };

    const startBtn = button("Start Game", "btn btn-primary btn-start", () => {
      startBtn.disabled = true;
      addPlayerBtn.disabled = true;
      this.runLobbyCountdown(() => this.beginHostGame(hostLobby));
    });

    const screen = h(
      "div",
      "screen lobby-screen",
      h("h2", "title", "Host a Game"),
      statusEl,
      rosterEl,
      inviteBox,
      h("div", "menu-actions", addPlayerBtn, startBtn),
      button("Back", "btn btn-ghost", () => this.showMenu()),
    );
    this.setScreen(screen);
  }

  private runLobbyCountdown(onDone: () => void, seconds = 3) {
    let remaining = seconds;
    const numberEl = h("div", "lobby-countdown-number", String(remaining));
    const overlay = h("div", "lobby-countdown-overlay", numberEl, h("p", "lobby-countdown-label", "Get ready…"));
    document.body.appendChild(overlay);
    sound.unlock();
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        overlay.remove();
        onDone();
        return;
      }
      numberEl.textContent = String(remaining);
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  }

  private beginHostGame(hostLobby: HostLobby) {
    this.vsComputer = false;
    const input = new InputManager();
    input.onDirection((dir) => this.session?.setDirection(hostLobby.localPlayer.id, dir));
    const session = new GameSession(hostLobby.localPlayer.id, hostLobby.players, true, (msg) => hostLobby.broadcast(msg));
    this.activeHostLobby = hostLobby;
    this.input = input;
    this.session = session;
    session.startCountdown();
    this.showGameScreen();
  }

  private showVsComputerSetup() {
    const countEl = h("div", "stepper-value", String(this.profile.botCount));
    const stepper = h(
      "div",
      "stepper",
      button("−", "stepper-btn", () => {
        this.profile.botCount = Math.max(1, this.profile.botCount - 1);
        saveProfile(this.profile);
        countEl.textContent = String(this.profile.botCount);
      }),
      countEl,
      button("+", "stepper-btn", () => {
        this.profile.botCount = Math.min(MAX_BOTS, this.profile.botCount + 1);
        saveProfile(this.profile);
        countEl.textContent = String(this.profile.botCount);
      }),
    );

    const screen = h(
      "div",
      "screen lobby-screen",
      h("h2", "title", "Play vs Computer"),
      h("label", "field-label", "Computer Snakes", stepper),
      h("p", "hint", "You + computer-controlled snakes on one board, no connection needed."),
      h("div", "menu-actions", button("Start Game", "btn btn-primary btn-start", () => this.startVsComputer())),
      button("Back", "btn btn-ghost", () => this.showMenu()),
    );
    this.setScreen(screen);
  }

  // Fully local — no lobby, no network — so it doesn't need any of the
  // WebRTC/relay machinery. isHost is still true because GameSession uses
  // that flag to decide who actually runs the simulation ticks, and here
  // that's trivially always us.
  private startVsComputer() {
    this.teardownGame();
    this.vsComputer = true;
    const localInfo = this.localPlayerInfo(0);
    const roster: PlayerInfo[] = [localInfo];
    for (let i = 0; i < this.profile.botCount; i++) {
      roster.push({
        id: randomPlayerId(),
        name: `CPU ${i + 1}`,
        color: PLAYER_COLORS[(i + 1) % PLAYER_COLORS.length],
        slot: i + 1,
        accessory: "none",
        isAI: true,
      });
    }
    const input = new InputManager();
    input.onDirection((dir) => this.session?.setDirection(localInfo.id, dir));
    const session = new GameSession(localInfo.id, roster, true, () => {});
    this.input = input;
    this.session = session;
    session.startCountdown();
    this.showGameScreen();
  }

  // ---------------------------------------------------------- Join lobby --

  private showJoinLobby(prefillCode?: string) {
    const guestLobby = new GuestLobby(this.profile.name, this.profile.color, this.profile.accessory);

    const statusEl = h("p", "status-text", "Ask your host for their 4-digit code.");
    const rosterEl = h("div", "roster-list");

    guestLobby.onRosterChange((players) => {
      rosterEl.replaceChildren(
        ...players.map((p) => rosterItem(p, p.id === guestLobby.localPlayer.id ? " (you)" : "")),
      );
      statusEl.textContent = "Connected! Waiting for the host to start the game…";
    });

    guestLobby.onMessage((msg) => {
      if (msg.type === "countdown" && (!this.session || this.session.over)) {
        this.teardownGame();
        this.beginGuestGame(guestLobby);
      }
      this.session?.handleNetMessage(msg);
    });

    const codeInput = h("input", "code-input") as HTMLInputElement;
    codeInput.inputMode = "numeric";
    codeInput.autocomplete = "off";
    codeInput.maxLength = 4;
    codeInput.placeholder = "0000";
    codeInput.addEventListener("input", () => {
      codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 4);
    });

    const connect = async (code: string) => {
      if (code.length !== 4) {
        statusEl.textContent = "Enter the 4-digit code your host gave you.";
        return;
      }
      connectBtn.disabled = true;
      scanBtn.disabled = true;
      statusEl.textContent = `Connecting to ${code}…`;
      try {
        await guestLobby.connectWithCode(code);
        statusEl.textContent = "Connected! Waiting for the host to start the game…";
      } catch (err) {
        statusEl.textContent = errorMessage(err);
        connectBtn.disabled = false;
        scanBtn.disabled = false;
      }
    };

    const connectBtn = button("Connect", "btn btn-primary", () => connect(codeInput.value));
    const scanBtn = button("Scan QR Instead", "btn btn-secondary", () => {
      scanBtn.disabled = true;
      statusEl.textContent = "Point your camera at the host's QR code…";
      this.openScanner(
        (text) => {
          try {
            const code = qrPayloadToCode(text);
            codeInput.value = code;
            connect(code);
          } catch (err) {
            statusEl.textContent = errorMessage(err);
            scanBtn.disabled = false;
          }
        },
        (err) => {
          statusEl.textContent = errorMessage(err);
          scanBtn.disabled = false;
        },
      );
    });

    const screen = h(
      "div",
      "screen lobby-screen",
      h("h2", "title", "Join a Game"),
      statusEl,
      h("label", "field-label", "Room Code", codeInput),
      h("div", "menu-actions", connectBtn, scanBtn),
      rosterEl,
      button("Back", "btn btn-ghost", () => this.showMenu()),
    );
    this.setScreen(screen);

    if (prefillCode) {
      codeInput.value = prefillCode;
      connect(prefillCode);
    }
  }

  private beginGuestGame(guestLobby: GuestLobby) {
    this.vsComputer = false;
    const input = new InputManager();
    input.onDirection((dir) => guestLobby.send({ type: "input", id: guestLobby.localPlayer.id, dir }));
    const session = new GameSession(guestLobby.localPlayer.id, guestLobby.players, false, (msg) => guestLobby.send(msg));
    this.activeGuestLobby = guestLobby;
    this.input = input;
    this.session = session;
    this.showGameScreen();
  }

  // --------------------------------------------------------------- Game --

  private showGameScreen() {
    this.canvas.classList.add("visible");
    this.prevCountdownSecond = -1;
    this.wasLocalAlive = true;
    this.deathFlashUntil = 0;

    const hud = h(
      "div",
      "hud",
      h("div", "hud-timer"),
      h("div", "hud-scoreboard"),
      h("div", "hud-countdown"),
      h("div", "hud-you-died", "💀 You Died"),
      button("☰ Menu", "hud-quit-btn", () => this.openPauseMenu()),
    );

    this.stopScanner();
    this.uiRoot.replaceChildren(hud, this.input!.element);

    this.loop = new GameLoop((dt) => this.frame(dt, hud));
    this.loop.start();
  }

  private openPauseMenu() {
    const session = this.session;
    if (!session || !this.loop) return;
    this.loop.stop();

    const close = () => overlay.remove();
    const resume = () => {
      close();
      this.loop?.start();
    };
    const restart = () => {
      close();
      const hostLobby = this.activeHostLobby;
      const wasVsComputer = this.vsComputer;
      this.teardownGame();
      if (wasVsComputer) this.startVsComputer();
      else if (hostLobby) this.beginHostGame(hostLobby);
      else this.showMenu();
    };

    const muteBtn = button(this.profile.muted ? "🔇 Sound Off" : "🔊 Sound On", "btn btn-secondary", () => {
      this.profile.muted = !this.profile.muted;
      saveProfile(this.profile);
      sound.setMuted(this.profile.muted);
      muteBtn.textContent = this.profile.muted ? "🔇 Sound Off" : "🔊 Sound On";
    });

    const overlay = h(
      "div",
      "pause-overlay",
      h(
        "div",
        "screen",
        h("h2", "title", "Paused"),
        h(
          "div",
          "menu-actions",
          button("▶ Resume", "btn btn-primary", resume),
          muteBtn,
          session.isHost
            ? button("⟲ Restart Game", "btn btn-secondary", restart)
            : h("p", "hint", "Only the host can restart the game."),
          button("🏠 Main Menu", "btn btn-ghost", () => this.showMenu()),
        ),
      ),
    );
    this.uiRoot.appendChild(overlay);
  }

  private frame(dt: number, hud: HTMLElement) {
    this.ensureCanvasSize();
    const session = this.session;
    if (!session) return;
    session.update(dt);

    this.render(session);
    this.updateHud(session, hud);
    this.updateSounds(session);

    if (session.over && !this.resultsShown) {
      this.resultsShown = true;
      sound.win();
      setTimeout(() => this.showResults(session), 1400);
    }
  }

  private updateSounds(session: GameSession) {
    if (session.countdownMs > 0) {
      const second = Math.ceil(session.countdownMs / 1000);
      if (second !== this.prevCountdownSecond) {
        sound.countdownTick();
        this.prevCountdownSecond = second;
      }
    } else if (this.prevCountdownSecond !== 0) {
      sound.countdownGo();
      this.prevCountdownSecond = 0;
    }

    const localSnap = session.getSnapshots().curr.get(session.localId);
    const localAlive = localSnap ? localSnap.alive : true;
    if (this.wasLocalAlive && !localAlive) {
      sound.crash();
      this.deathFlashUntil = performance.now() + 1600;
    }
    this.wasLocalAlive = localAlive;
  }

  private render(session: GameSession) {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const hgt = this.canvas.clientHeight;
    const layout = computeBoardLayout(w, hgt, GRID_COLS, GRID_ROWS, HUD_RESERVE_TOP);

    ctx.clearRect(0, 0, w, hgt);
    drawBoard(ctx, GRID_COLS, GRID_ROWS, layout);
    drawFood(ctx, session.food, layout);

    const renderSnakes: RenderSnake[] = session.getInterpolatedSnakes().map((s) => {
      const info = session.roster.find((p) => p.id === s.id);
      return {
        id: s.id,
        segments: s.segments,
        color: info?.color ?? "#888",
        label: info?.name ?? "Player",
        isLocal: s.id === session.localId,
        alive: s.alive,
        dir: s.dir,
        score: s.score,
        accessory: info?.accessory,
      };
    });
    for (const rs of renderSnakes) drawSnake(ctx, rs, layout);
    drawDeathEffects(ctx, session.deathEvents, session.elapsedMs, layout);
  }

  private updateHud(session: GameSession, hud: HTMLElement) {
    const timerEl = hud.querySelector(".hud-timer") as HTMLElement;
    const cdEl = hud.querySelector(".hud-countdown") as HTMLElement;
    const scoreboardEl = hud.querySelector(".hud-scoreboard") as HTMLElement;
    const diedEl = hud.querySelector(".hud-you-died") as HTMLElement;

    timerEl.textContent = formatTime(session.timeRemainingMs);

    scoreboardEl.replaceChildren(
      ...session
        .getLiveStandings()
        .map((s) =>
          h(
            "div",
            `score-row${s.isLocal ? " score-row--you" : ""}${!s.alive ? " score-row--dead" : ""}`,
            h("span", "", s.name),
            h("span", "", String(s.score)),
          ),
        ),
    );

    if (session.countdownMs > 0) {
      cdEl.textContent = String(Math.ceil(session.countdownMs / 1000));
      cdEl.classList.add("visible");
    } else {
      cdEl.classList.remove("visible");
    }

    diedEl.classList.toggle("visible", performance.now() < this.deathFlashUntil);
  }

  private showResults(session: GameSession) {
    this.loop?.stop();
    this.canvas.classList.remove("visible");

    const winner = session.standings[0];
    const winnerLine = winner
      ? h("p", "winner-line", `🏆 ${winner.name} wins with ${winner.score} points!`)
      : null;

    const list = h(
      "div",
      "results-list",
      ...session.standings.map((r) =>
        h(
          "div",
          "results-item",
          h("span", "results-place", `#${r.place}`),
          h("span", "results-name", r.name),
          h("span", "results-score", `${r.score} pts`),
        ),
      ),
    );

    const actions = h(
      "div",
      "menu-actions",
      session.isHost
        ? button("Play Again", "btn btn-primary", () => {
            const hostLobby = this.activeHostLobby;
            const wasVsComputer = this.vsComputer;
            this.teardownGame();
            if (wasVsComputer) this.startVsComputer();
            else if (hostLobby) this.beginHostGame(hostLobby);
            else this.showMenu();
          })
        : h("p", "hint", "Waiting for the host to start another game, or head back to the menu."),
      button("Back to Menu", "btn btn-secondary", () => this.showMenu()),
    );

    const screen = h(
      "div",
      "screen results-screen",
      h("h2", "title", "🏁 Results"),
      winnerLine,
      list,
      actions,
    );
    this.setScreen(screen);
  }

  // ------------------------------------------------------------ Scanning --

  private openScanner(onResult: (text: string) => void, onError: (err: unknown) => void) {
    this.stopScanner();
    const video = h("video", "scan-video");
    const overlay = h(
      "div",
      "scan-overlay",
      video,
      h("p", "hint", "Point the camera at the QR code"),
      button("Cancel", "btn btn-ghost", () => {
        this.stopScanner();
        overlay.remove();
      }),
    );
    this.uiRoot.append(overlay);
    this.activeScanner = startQRScan(
      video,
      (text) => {
        overlay.remove();
        onResult(text);
      },
      (err) => {
        overlay.remove();
        onError(err);
      },
    );
  }
}

function formatTime(ms: number) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong. Make sure camera permission is granted and try again.";
}

function rosterItem(p: PlayerInfo, suffix: string) {
  const dot = h("span", "roster-dot");
  dot.style.background = p.color;
  return h("div", "roster-item", dot, h("span", "roster-name", p.name + suffix));
}
