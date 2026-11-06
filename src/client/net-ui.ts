// ─────────────────────────────────────────────────────────────
// Lobby overlay: pick a nickname, then host or join a room by code.
// Pure DOM; it sits on top of the canvas. Hidden by default: the game starts
// in solo mode and the lobby only opens from the "Multiplayer" button (or M).
//
// Room bar: small top-center bar with the Multiplayer button (solo) or the
// room code, host controls (mode, restart) and "Sair" (in a room).
// ─────────────────────────────────────────────────────────────

import { MAX_NAME_LEN, makeRoomCode, type GameMode } from "../net/protocol";

export interface LobbyResult {
  mode: "host" | "join";
  code: string;
  name: string;
}

const NAME_KEY = "snowgo:name";

export interface LobbyHandle {
  /** Show a transient error inside the lobby (e.g. room full). */
  showError: (msg: string) => void;
  /** Reflect connection progress. */
  setStatus: (msg: string) => void;
  /** Remove the overlay once we're racing. */
  close: () => void;
  /** Re-open the lobby (Multiplayer button, or after a disconnect). */
  reopen: () => void;
}

export function mountLobby(onStart: (r: LobbyResult) => void, onCancel: () => void): LobbyHandle {
  const root = document.createElement("div");
  root.id = "lobby";
  root.innerHTML = `
    <style>
      #lobby {
        position: fixed; inset: 0; z-index: 10;
        display: none; align-items: center; justify-content: center;
        background: rgba(8,16,28,0.82); backdrop-filter: blur(4px);
        font-family: "Avenir Next","Segoe UI",system-ui,sans-serif; color: #e8f1f7;
      }
      #lobby .card {
        width: min(380px, 90vw); background: #11223a; border: 1px solid #22405f;
        border-radius: 16px; padding: 24px; box-shadow: 0 18px 60px rgba(0,0,0,0.45);
      }
      #lobby h1 { margin: 0 0 4px; font-size: 22px; }
      #lobby p.sub { margin: 0 0 18px; color: #8aa3b8; font-size: 13px; }
      #lobby label { display: block; font-size: 12px; color: #8aa3b8; margin: 14px 0 6px; }
      #lobby input {
        width: 100%; box-sizing: border-box; background: #0c1726; color: #e8f1f7;
        border: 1px solid #2b4866; border-radius: 10px; padding: 10px 12px; font-size: 15px;
        text-transform: none; letter-spacing: 0.5px;
      }
      #lobby input#code { text-transform: uppercase; letter-spacing: 3px; font-family: ui-monospace, monospace; }
      #lobby .row { display: flex; gap: 10px; margin-top: 18px; }
      #lobby button {
        flex: 1; border: 0; border-radius: 10px; padding: 12px; font-size: 14px; font-weight: 600;
        cursor: pointer; color: #07121f;
      }
      #lobby button.primary { background: #3da5ff; }
      #lobby button.ghost { background: #2b4866; color: #e8f1f7; }
      #lobby button:disabled { opacity: 0.5; cursor: default; }
      #lobby .msg { margin-top: 14px; font-size: 13px; min-height: 18px; }
      #lobby .msg.err { color: #ff8a3d; }
      #lobby .msg.ok { color: #45d483; }
      #lobby .hint { margin-top: 10px; font-size: 12px; color: #6f879c; }
      #lobby button.link {
        flex: none; display: block; width: 100%; margin-top: 12px; padding: 8px;
        background: transparent; color: #8aa3b8; font-weight: 500; text-decoration: underline;
      }
    </style>
    <div class="card">
      <h1>Snow Go — multiplayer</h1>
      <p class="sub">Até 15 jogadores na mesma pista, P2P (WebRTC).</p>

      <label for="name">Seu apelido</label>
      <input id="name" maxlength="${MAX_NAME_LEN}" placeholder="Ex.: Nina" autocomplete="off" />

      <label for="code">Código da sala</label>
      <input id="code" maxlength="6" placeholder="ABCD" autocomplete="off" />

      <div class="row">
        <button class="primary" id="host">Criar sala</button>
        <button class="ghost" id="join">Entrar</button>
      </div>
      <div class="msg" id="msg"></div>
      <div class="hint">Criar sala gera um código — compartilhe com os amigos. Entrar pede o código de uma sala existente.</div>
      <button class="link" id="solo">Voltar ao solo</button>
    </div>
  `;
  document.body.appendChild(root);

  const nameEl = root.querySelector<HTMLInputElement>("#name")!;
  const codeEl = root.querySelector<HTMLInputElement>("#code")!;
  const hostBtn = root.querySelector<HTMLButtonElement>("#host")!;
  const joinBtn = root.querySelector<HTMLButtonElement>("#join")!;
  const msgEl = root.querySelector<HTMLDivElement>("#msg")!;
  const soloBtn = root.querySelector<HTMLButtonElement>("#solo")!;

  nameEl.value = (localStorage.getItem(NAME_KEY) ?? "").slice(0, MAX_NAME_LEN);
  codeEl.value = makeRoomCode();

  function setMsg(text: string, cls: "" | "err" | "ok" = "") {
    msgEl.textContent = text;
    msgEl.className = "msg " + cls;
  }
  function setBusy(busy: boolean) {
    hostBtn.disabled = busy;
    joinBtn.disabled = busy;
  }
  function go(mode: "host" | "join") {
    const name = nameEl.value.trim().slice(0, MAX_NAME_LEN);
    const code = codeEl.value.trim().toUpperCase();
    if (!name) return setMsg("Digite um apelido.", "err");
    if (!code) return setMsg("Digite um código de sala.", "err");
    localStorage.setItem(NAME_KEY, name);
    setBusy(true);
    setMsg(mode === "host" ? "Criando sala…" : "Entrando…");
    onStart({ mode, code, name });
  }

  hostBtn.addEventListener("click", () => go("host"));
  joinBtn.addEventListener("click", () => go("join"));
  codeEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go("join");
  });
  soloBtn.addEventListener("click", () => onCancel());
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") onCancel();
  });

  return {
    showError: (m) => {
      setBusy(false);
      setMsg(m, "err");
    },
    setStatus: (m) => setMsg(m, "ok"),
    close: () => {
      root.style.display = "none";
    },
    reopen: () => {
      setBusy(false);
      root.style.display = "flex";
      if (!nameEl.value) nameEl.focus();
      else codeEl.focus();
    },
  };
}

export interface RoomBarState {
  inRoom: boolean;
  code: string;
  isHost: boolean;
  mode: GameMode;
  canRestart: boolean;
  trackId: string;
  /** solo: always; in a room: only the host */
  canPickTrack: boolean;
  /** seconds until restarting is allowed, once someone finished (null: nobody has finished yet) */
  restartInS: number | null;
}

export interface RoomBarActions {
  onMultiplayer: () => void;
  onLeave: () => void;
  onMode: (mode: GameMode) => void;
  onRestart: () => void;
  onTrack: (id: string) => void;
}

export function mountRoomBar(
  actions: RoomBarActions,
  /** `error`: the drawing is invalid, so it is listed (disabled) with the reason instead of crashing the game */
  tracks: { id: string; name: string; error?: string }[],
): { update: (s: RoomBarState) => void } {
  const root = document.createElement("div");
  root.id = "roombar";
  root.innerHTML = `
    <style>
      #roombar {
        position: fixed; top: 15px; left: 50%; transform: translateX(-50%); z-index: 5;
        display: flex; gap: 7.5px; align-items: center;
        font-family: "Avenir Next","Segoe UI",system-ui,sans-serif; font-size: 16.25px; color: #e8f1f7;
      }
      #roombar .code {
        padding: 7.5px 12.5px; border-radius: 10px; background: rgba(17,34,58,0.85);
        font-family: ui-monospace, monospace; letter-spacing: 2.5px;
      }
      #roombar button {
        border: 1px solid #2b4866; border-radius: 10px; padding: 7.5px 15px; font-size: 16.25px; font-weight: 600;
        cursor: pointer; background: rgba(17,34,58,0.85); color: #e8f1f7;
      }
      #roombar button.on { background: #3da5ff; color: #07121f; border-color: #3da5ff; }
      #roombar button:disabled { opacity: 0.45; cursor: default; }
      #roombar select {
        border: 1px solid #2b4866; border-radius: 10px; padding: 7.5px 10px; font-size: 16.25px; font-weight: 600;
        background: rgba(17,34,58,0.85); color: #e8f1f7; max-width: 212px;
      }
      #roombar select:disabled { opacity: 0.7; }
      #roombar .seg { display: flex; }
      #roombar .seg button:first-child { border-radius: 10px 0 0 10px; }
      #roombar .seg button:last-child { border-radius: 0 10px 10px 0; border-left: 0; }
    </style>
    <select id="rb-track" title="Pista"></select>
    <button id="rb-mp">Multiplayer</button>
    <span class="code" id="rb-code"></span>
    <span class="seg" id="rb-modes">
      <button id="rb-free">Livre</button>
      <button id="rb-race">Corrida</button>
    </span>
    <button id="rb-restart">Reiniciar corrida</button>
    <button id="rb-leave">Sair</button>
  `;
  document.body.appendChild(root);

  const $ = (id: string) => root.querySelector<HTMLElement>("#" + id)!;
  const mp = $("rb-mp"), code = $("rb-code"), modes = $("rb-modes");
  const free = $("rb-free"), race = $("rb-race");
  const restart = $("rb-restart") as HTMLButtonElement, leave = $("rb-leave");
  const trackSel = $("rb-track") as HTMLSelectElement;
  for (const t of tracks) {
    const opt = new Option(t.error ? `${t.name} ⚠ inválida` : t.name, t.id);
    if (t.error) {
      opt.disabled = true;
      opt.title = t.error;
    }
    trackSel.add(opt);
  }
  trackSel.addEventListener("change", () => {
    trackSel.blur(); // hand the keyboard back to the game (a focused <select> would eat the arrow keys)
    actions.onTrack(trackSel.value);
  });

  // blur after each click so Space/Enter while racing don't re-trigger the button
  const on = (el: HTMLElement, fn: () => void) =>
    el.addEventListener("click", () => {
      el.blur();
      fn();
    });
  on(mp, actions.onMultiplayer);
  on(leave, actions.onLeave);
  on(free, () => actions.onMode("free"));
  on(race, () => actions.onMode("race"));
  on(restart, actions.onRestart);

  const show = (el: HTMLElement, v: boolean) => (el.style.display = v ? "" : "none");
  let lastKey = "";

  return {
    update: (s) => {
      const key = JSON.stringify(s);
      if (key === lastKey) return; // called every frame: only touch the DOM on change
      lastKey = key;
      trackSel.value = s.trackId;
      trackSel.disabled = !s.canPickTrack;
      trackSel.title = s.canPickTrack ? "Pista" : "Só o host escolhe a pista";
      show(mp, !s.inRoom);
      show(code, s.inRoom);
      show(leave, s.inRoom);
      show(modes, s.inRoom && s.isHost);
      show(restart, s.inRoom && s.isHost && s.mode === "race");
      code.textContent = `Sala ${s.code}`;
      free.classList.toggle("on", s.mode === "free");
      race.classList.toggle("on", s.mode === "race");
      restart.disabled = !s.canRestart;
      restart.textContent = s.restartInS !== null && s.restartInS > 0 ? `Reiniciar corrida (${s.restartInS}s)` : "Reiniciar corrida";
      restart.title = s.canRestart ? "" : "Disponível 5 s depois de o 1º colocado terminar";
    },
  };
}
