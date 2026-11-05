// ─────────────────────────────────────────────────────────────
// Lobby overlay: pick a nickname, then host or join a room by code.
// Pure DOM; it sits on top of the canvas and hides once connected.
// ─────────────────────────────────────────────────────────────

import { makeRoomCode } from "../net/protocol";

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
  /** Re-open the lobby (e.g. after disconnect). */
  reopen: () => void;
}

export function mountLobby(onStart: (r: LobbyResult) => void): LobbyHandle {
  const root = document.createElement("div");
  root.id = "lobby";
  root.innerHTML = `
    <style>
      #lobby {
        position: fixed; inset: 0; z-index: 10;
        display: flex; align-items: center; justify-content: center;
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
    </style>
    <div class="card">
      <h1>Snow Go — multiplayer</h1>
      <p class="sub">Até 15 jogadores na mesma pista, P2P (WebRTC).</p>

      <label for="name">Seu apelido</label>
      <input id="name" maxlength="16" placeholder="Ex.: Nina" autocomplete="off" />

      <label for="code">Código da sala</label>
      <input id="code" maxlength="6" placeholder="ABCD" autocomplete="off" />

      <div class="row">
        <button class="primary" id="host">Criar sala</button>
        <button class="ghost" id="join">Entrar</button>
      </div>
      <div class="msg" id="msg"></div>
      <div class="hint">Criar sala gera um código — compartilhe com os amigos. Entrar pede o código de uma sala existente.</div>
    </div>
  `;
  document.body.appendChild(root);

  const nameEl = root.querySelector<HTMLInputElement>("#name")!;
  const codeEl = root.querySelector<HTMLInputElement>("#code")!;
  const hostBtn = root.querySelector<HTMLButtonElement>("#host")!;
  const joinBtn = root.querySelector<HTMLButtonElement>("#join")!;
  const msgEl = root.querySelector<HTMLDivElement>("#msg")!;

  nameEl.value = localStorage.getItem(NAME_KEY) ?? "";
  codeEl.value = makeRoomCode();
  if (!nameEl.value) nameEl.focus();
  else codeEl.focus();

  function setMsg(text: string, cls: "" | "err" | "ok" = "") {
    msgEl.textContent = text;
    msgEl.className = "msg " + cls;
  }
  function setBusy(busy: boolean) {
    hostBtn.disabled = busy;
    joinBtn.disabled = busy;
  }
  function go(mode: "host" | "join") {
    const name = nameEl.value.trim();
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
    },
  };
}
