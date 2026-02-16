import type { IPage } from "../types/ipage";
import { startPongApp } from "../pong/app";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
import { getState as getPongState, getSettings as getPongSettings } from "../pong/game";
import { startGame as startPongGame, resetGame as resetPongGame, applySettings as applyPongSettings} from "../pong/ui";
import { ProfileService } from "../services/ProfileService";
import { MatchService, type MatchHistoryItem } from "../services/MatchService";
import { ws } from "../services/ws";
import { lang, getLang } from "../i18n/lang";
import {
  showTournamentSetup,
  updatePlayerInputs,
  isTournamentMode,
  isTournamentFinished,
  isTournamentMatchInProgress,
  withdrawTournamentPlayerByName,
  exitTournament,
  setTournamentExternalHandlers,
} from "../pong/tournament";

type GamePresenceState = "inLobby" | "inGame";

type Presence = {
  status: "online" | "offline";
  gameState: GamePresenceState;
};

type IncomingInvite = {
  inviteId: string;
  fromUserId: number;
  fromAlias: string;
  lobbyId: string;
  expiresAt: number;
};

type OutgoingInvite = {
  inviteId: string;
  toUserId: number;
  toAlias: string;
  lobbyId: string;
  expiresAt: number;
};

type LobbySnapshot = {
  lobbyId: string;
  hostUserId: number;
  members: Array<{ id: number; alias: string }>;
  activeOnlineMatch?:
  | {
    matchId: string;
    hostUserId: number;
    hostOnly?: boolean;
    phase?: "created" | "began";
    beganAt?: number | null;
    codes?: Record<string, string>;
  }
  | null;
};

export class GamePage implements IPage {
  private goTo: (path: string, params?: any) => void;
  private stop: (() => void) | null = null;

  private ws = ws;
  private unsubscribeMessage: (() => void) | null = null;
  private unsubscribeState: (() => void) | null = null;

  private friends: Array<{ id: number; alias: string; avatar_url?: string }> = [];
  private presence = new Map<number, Presence>();

  private incomingInvites = new Map<string, IncomingInvite>();
  private outgoingInvites = new Map<string, OutgoingInvite>();

  private lobby: LobbySnapshot | null = null;
  private myGameState: GamePresenceState = "inLobby";
  private myUserId: number | null = null;
  private wsState: "connecting" | "open" | "closed" | "error" = "closed";

  private tickTimer: number | null = null;

  private activeTournamentId: string | null = null;
  private activeTournamentFinished = false;
  private activeTournamentMatch: { matchId: string; player1Id: number; player2Id: number } | null = null;
  private onlineMatchInProgress = false;

  private activeOnlineMatchId: string | null = null;
  private onlineCodes: { myCode?: string; opponentCode?: string } = {};
  private lastAutoSubmittedOnlineScore: { myScore: number; opponentScore: number } | null = null;
  private onlineReadySent = false;
  private onlineHostOnly = false;
  private onlineSpectator = false;

  private pendingOnlineResultConfirm: { matchId: string; player1Score: number; player2Score: number } | null = null;

  constructor(goTo: (path: string, params?: any) => void) {
    this.goTo = goTo;
  }

  render(): string {
    return `
      <div class="min-h-screen bg-gray-950 text-gray-100">
        <header class="border-b border-gray-800 bg-gray-950/60 backdrop-blur">
          <div class="max-w-6xl mx-auto px-4 py-3 sm:py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <div class="flex items-center gap-3">
              <button id="backBtn" class="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-100 text-sm sm:text-base">
                ← ${lang('common.back')}
              </button>
              <h1 class="text-lg sm:text-xl font-semibold">${lang('game.title')}</h1>
            </div>
            <div class="flex flex-wrap items-center gap-2 sm:gap-4 text-xs text-gray-400">
              <span id="myStateLabel">${lang('game.stateLabel')}: ${lang('game.inLobby')}</span>
              <div class="hidden sm:block">${lang('game.controls')}</div>
            </div>
          </div>
        </header>

        <div id="tournamentAnnounceBanner" class="hidden max-w-6xl mx-auto px-4 mt-2"></div>

        <main class="max-w-6xl mx-auto px-4 py-4 sm:py-6">
          <h3 class="text-xs sm:text-sm text-gray-300 mb-3">${lang('game.modesTitle')}</h3>

          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <section class="lg:col-span-2">
              <div class="flex flex-col items-center">
                <canvas id="c" width="800" height="400" class="bg-black border border-gray-800 rounded-lg w-full max-w-[800px]"></canvas>

                <div class="mt-3 flex flex-wrap gap-2 justify-center">
                  <button id="startBtn" class="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white">${lang('game.startButton')}</button>
                  <button id="readyBtn" style="display:none" class="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white">${lang('game.readyButton')}</button>
                  <button id="resetBtn" class="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-100">${lang('game.resetButton')}</button>
                  <button id="customizeBtn" class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white">${lang('game.customizeButton')}</button>
                  <button id="tournamentBtn" class="px-4 py-2 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white">${lang('game.tournamentButton')}</button>
                </div>

                <div id="customPanel" style="display:none" class="mt-4 w-full max-w-md bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div class="space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-sm">${lang('game.customize.gameMode')}</span>
                  <select id="gameMode" class="bg-gray-950 border border-gray-800 rounded-lg px-2 py-1">
                    <option value="AI" selected>${lang('game.customize.modes.ai')}</option>
                    <option value="2P">${lang('game.customize.modes.twoPlayer')}</option>
                    <option value="AI_AI">${lang('game.customize.modes.aiVsAi')}</option>
                  </select>
                </div>

                <div class="flex items-center justify-between gap-3">
                  <span class="text-sm">${lang('game.customize.background')}</span>
                  <input type="color" id="bgColor" value="#000000" />
                </div>
                <div class="flex items-center justify-between gap-3">
                  <span class="text-sm">${lang('game.customize.ball')}</span>
                  <input type="color" id="ballColor" value="#ffffff" />
                </div>
                <div class="flex items-center justify-between gap-3">
                  <span class="text-sm">${lang('game.customize.paddle')}</span>
                  <input type="color" id="paddleColor" value="#ffffff" />
                </div>

                <div class="flex items-center justify-between gap-3">
                  <span class="text-sm">${lang('game.customize.map')}</span>
                  <select id="mapSelect" class="bg-gray-950 border border-gray-800 rounded-lg px-2 py-1">
                    <option value="classic" selected>${lang('game.customize.maps.classic')}</option>
                    <option value="mid_wall">${lang('game.customize.maps.midWall')}</option>
                    <option value="gates">${lang('game.customize.maps.gates')}</option>
                    <option value="map_42">${lang('game.customize.maps.map42')}</option>
                    <option value="star">${lang('game.customize.maps.star')}</option>
                  </select>
                </div>

                <div class="flex items-center justify-between gap-3">
                  <span class="text-sm">${lang('game.customize.winScore')}</span>
                  <select id="winScore" class="bg-gray-950 border border-gray-800 rounded-lg px-2 py-1">
                    <option>3</option>
                    <option selected>5</option>
                    <option>7</option>
                    <option value="0">${lang('game.customize.unlimited')}</option>
                  </select>
                </div>

                <div class="flex items-center justify-between gap-3">
                  <span class="text-sm">${lang('game.customize.aiDifficulty')}</span>
                  <select id="aiMode" class="bg-gray-950 border border-gray-800 rounded-lg px-2 py-1">
                    <option value="500">${lang('game.customize.difficulty.hard')}</option>
                    <option value="1000" selected>${lang('game.customize.difficulty.normal')}</option>
                    <option value="2000">${lang('game.customize.difficulty.easy')}</option>
                  </select>
                </div>

                <div class="flex items-center justify-between gap-3">
                  <span class="text-sm">${lang('game.customize.powerups')}:</span>
                  <select id="powerups" class="bg-gray-950 border border-gray-800 rounded-lg px-2 py-1">
                    <option value="off" selected>${lang('game.customize.no')}</option>
                    <option value="on">${lang('game.customize.yes')}</option>
                  </select>
                </div>

                <div id="versionLabel" class="text-xs text-gray-500">v1.2</div>

                <div class="flex justify-end">
                  <button id="exitCustomizeBtn" class="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700">${lang('game.customize.exit')}</button>
                </div>
              </div>
            </div>

                <div id="tournamentPanel" style="display:none" class="mt-4 w-full max-w-3xl bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 class="text-lg font-semibold">${lang('game.tournamentMode')}</h3>
              <div id="tournamentOnlineStatus" class="text-xs text-gray-400 mt-1"></div>

              <div id="tournamentSetupSection">
                <div class="mt-3 flex items-center justify-center gap-2">
                  <span>${lang('game.playerCount')}</span>
                  <select id="playerCount" class="bg-gray-950 border border-gray-800 rounded-lg px-2 py-1">
                    <option value="4" selected>4</option>
                    <option value="8">8</option>
                    <option value="12">12</option>
                    <option value="16">16</option>
                  </select>
                </div>

                <div id="playerInputs" class="mt-3"></div>

                <div class="mt-4 p-4 bg-gray-950 border border-gray-800 rounded-xl">
                  <h4 class="font-semibold">${lang('game.tournamentSettings')}</h4>

                <div class="mt-3 flex flex-wrap justify-center gap-4">
                  <div class="flex items-center gap-2">
                    <span>${lang('game.customize.aiDifficulty')}:</span>
                    <select id="tournamentAI" class="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1">
                      <option value="500">${lang('game.customize.difficulty.hard')}</option>
                      <option value="1000" selected>${lang('game.customize.difficulty.normal')}</option>
                      <option value="2000">${lang('game.customize.difficulty.easy')}</option>
                    </select>
                  </div>

                  <div class="flex items-center gap-2">
                    <span>Map:</span>
                    <select id="tournamentMap" class="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1">
                      <option value="classic" selected>${lang('game.customize.maps.classic')}</option>
                      <option value="mid_wall">${lang('game.customize.maps.midWall')}</option>
                      <option value="gates">${lang('game.customize.maps.gates')}</option>
                      <option value="map_42">${lang('game.customize.maps.map42')}</option>
                      <option value="star">${lang('game.customize.maps.star')}</option>
                    </select>
                  </div>

                  <div class="flex items-center gap-2">
                    <span>${lang('game.customize.powerups')}:</span>
                    <select id="tournamentPowerups" class="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1">
                      <option value="off" selected>${lang('game.customize.no')}</option>
                      <option value="on">${lang('game.customize.yes')}</option>
                    </select>
                  </div>
                </div>
                </div>

                <div id="tournamentSetupButtons" class="mt-4 flex gap-2 justify-center">
                  <button id="tournamentStartBtn" type="button" class="px-4 py-2 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white">${lang('game.startTournament')}</button>
                  <button id="tournamentCancelBtn" type="button" class="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700">${lang('game.cancelTournament')}</button>
                </div>
              </div>

              <div id="bracketView" style="display:none" class="mt-6">
                <div id="bracket" class="bracket flex flex-wrap gap-4 justify-center"></div>
                <div class="mt-3 flex gap-2 justify-center">
                  <button id="tournamentMatchBtn" type="button" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white">${lang('game.match')}</button>
                  <button id="tournamentPlayBtn" type="button" class="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white">${lang('game.playMatch')}</button>
                  <button id="tournamentCloseBtn" type="button" class="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700">${lang('game.close')}</button>
                </div>
              </div>

              <div id="championView" style="display:none" class="mt-6">
                <div class="p-6 rounded-xl bg-emerald-900/40 border border-emerald-800 text-2xl font-bold">
                  🏆 ${lang('game.champion')}: <span id="championName"></span> 🏆
                </div>
                <div class="mt-3 flex justify-center">
                  <button id="tournamentChampionCloseBtn" type="button" class="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700">${lang('game.close')}</button>
                </div>
              </div>
                </div>
              </div>
            </section>

            <aside class="lg:col-span-1">
              <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
                <div>
                  <h3 class="font-semibold">${lang('game.onlineFriends')}</h3>
                  <p class="text-xs text-gray-400 mt-1">${lang('game.onlineInfo')}</p>
                  <div id="onlineFriendsList" class="mt-3 flex flex-col gap-2"></div>
                </div>

                <div>
                  <h3 class="font-semibold">${lang('game.incomingInvites')}</h3>
                  <div id="incomingInvitesList" class="mt-3 flex flex-col gap-2"></div>
                </div>

                <div>
                  <h3 class="font-semibold">${lang('game.outgoingInvites')}</h3>
                  <div id="outgoingInvitesList" class="mt-3 flex flex-col gap-2"></div>
                </div>

                <div>
                  <div class="flex items-center justify-between">
                    <h3 class="font-semibold">${lang('game.lobby')}</h3>
                    <button id="refreshLobbyBtn" class="text-xs text-blue-400 hover:underline">${lang('chat.refresh')}</button>
                  </div>
                  <div id="lobbyBox" class="mt-3 text-sm text-gray-300 border border-gray-800 rounded-xl p-3 bg-gray-950/40">
                    <div class="text-xs text-gray-500">${lang('game.noLobby')}</div>
                  </div>
                  <div class="mt-3 flex gap-2">
                    <button id="lobbyLeaveBtn" class="flex-1 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700">${lang('game.leaveRoom')}</button>
                    <button id="lobbyCloseBtn" class="flex-1 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white">${lang('game.closeRoom')}</button>
                  </div>
                  <button id="start1v1Btn" class="mt-3 w-full px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white" style="display:none">
                    ${lang('game.play1v1')}
                  </button>
                  <button id="useLobbyTournamentBtn" class="mt-3 w-full px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white">
                    ${lang('game.fillTournamentFromLobby')}
                  </button>
                </div>

                <div>
                  <div class="flex items-center justify-between">
                    <h3 class="font-semibold">${lang('game.matchHistory')}</h3>
                    <button id="refreshMatchHistoryBtn" class="text-xs text-blue-400 hover:underline">${lang('chat.refresh')}</button>
                  </div>
                  <div id="matchHistoryList" class="mt-3 flex flex-col gap-2"></div>
                </div>

                <div id="gameToast" class="text-xs text-gray-400"></div>
              </div>
            </aside>
          </div>
        </main>
      </div>
    `;
  }

  async mount(): Promise<void> {
    try {
      const me = await ProfileService.profileData();
      if (!me || !me.user) {
        this.goTo("/login");
        return;
      }
      if (me.user && typeof me.user.id === "number") {
        this.myUserId = me.user.id;
      }
    } catch {
      this.goTo("/login");
      return;
    }

    

    const backBtn = document.getElementById("backBtn");
    backBtn?.addEventListener("click", () => {
      this.goTo("/home");
    });

    const myStateLabel = document.getElementById("myStateLabel");
    const toastEl = document.getElementById("gameToast");

    const onlineFriendsList = document.getElementById("onlineFriendsList");
    const incomingInvitesList = document.getElementById("incomingInvitesList");
    const outgoingInvitesList = document.getElementById("outgoingInvitesList");
    const lobbyBox = document.getElementById("lobbyBox");
    const refreshLobbyBtn = document.getElementById("refreshLobbyBtn");
    const matchHistoryList = document.getElementById("matchHistoryList");
    const refreshMatchHistoryBtn = document.getElementById("refreshMatchHistoryBtn");
    const useLobbyTournamentBtn = document.getElementById("useLobbyTournamentBtn") as HTMLButtonElement | null;
    const lobbyLeaveBtn = document.getElementById("lobbyLeaveBtn") as HTMLButtonElement | null;
    const lobbyCloseBtn = document.getElementById("lobbyCloseBtn") as HTMLButtonElement | null;
    const start1v1Btn = document.getElementById("start1v1Btn") as HTMLButtonElement | null;

    const startBtn = document.getElementById("startBtn") as HTMLButtonElement | null;
    const readyBtn = document.getElementById("readyBtn") as HTMLButtonElement | null;
    const resetBtn = document.getElementById("resetBtn") as HTMLButtonElement | null;
    const customizeBtn = document.getElementById("customizeBtn") as HTMLButtonElement | null;
    const tournamentBtn = document.getElementById("tournamentBtn") as HTMLButtonElement | null;

    let onlineSessionStartProbeTimer: number | null = null;

    const syncLobbyButtons = () => {
      const hasLobby = !!this.lobby;
      const isHost =
        !!this.lobby && this.myUserId != null && this.lobby.hostUserId === this.myUserId;

      const is1v1Lobby = !!this.lobby && Array.isArray(this.lobby.members) && this.lobby.members.length === 2;
      const active1v1Match = is1v1Lobby && this.onlineMatchInProgress;

      const activeTournamentMatch = !!this.activeTournamentMatch;

      if (readyBtn) {
        const wsOpen = this.wsState === "open";
        const tournamentRunning = !!this.activeTournamentId && !this.activeTournamentFinished;

        readyBtn.style.display = hasLobby && is1v1Lobby ? "" : "none";
        readyBtn.textContent = this.onlineReadySent ? lang('game.readyWaiting') : lang('game.readyButton');

        const canReady =
          wsOpen &&
          hasLobby &&
          is1v1Lobby &&
          !!this.activeOnlineMatchId &&
          !this.onlineMatchInProgress &&
          !tournamentRunning;

        readyBtn.disabled = !canReady;
        if (readyBtn.disabled) readyBtn.classList.add("opacity-40", "cursor-not-allowed");
        else readyBtn.classList.remove("opacity-40", "cursor-not-allowed");
      }

      if (start1v1Btn) {
        start1v1Btn.style.display = hasLobby && is1v1Lobby ? "" : "none";
        start1v1Btn.disabled =
          !hasLobby ||
          !is1v1Lobby ||
          !isHost ||
          active1v1Match ||
          activeTournamentMatch ||
          (!!this.activeTournamentId && !this.activeTournamentFinished);
        if (start1v1Btn.disabled) start1v1Btn.classList.add("opacity-40", "cursor-not-allowed");
        else start1v1Btn.classList.remove("opacity-40", "cursor-not-allowed");
      }

      if (lobbyLeaveBtn) lobbyLeaveBtn.disabled = !hasLobby;
      if (lobbyCloseBtn) {
        lobbyCloseBtn.disabled = !hasLobby || !isHost;
        lobbyCloseBtn.style.display = hasLobby && isHost ? "" : "none";
      }

      if (lobbyLeaveBtn) {
        if (!hasLobby) lobbyLeaveBtn.classList.add("opacity-40", "cursor-not-allowed");
        else lobbyLeaveBtn.classList.remove("opacity-40", "cursor-not-allowed");
      }
      if (lobbyCloseBtn) {
        if (!hasLobby) lobbyCloseBtn.classList.add("opacity-40", "cursor-not-allowed");
        else lobbyCloseBtn.classList.remove("opacity-40", "cursor-not-allowed");
      }
    };

    const forceOnline1v1Mode = () => {
      const gameMode = document.getElementById("gameMode") as HTMLSelectElement | null;
      if (gameMode) gameMode.value = "2P";
      applyPongSettings();
    };


    const syncTournamentLockButtons = () => {
      const running = (!!this.activeTournamentId && !this.activeTournamentFinished) || (isTournamentMode() && !isTournamentFinished());
      if (useLobbyTournamentBtn) {
        useLobbyTournamentBtn.disabled = running;
        if (running) useLobbyTournamentBtn.classList.add("opacity-40", "cursor-not-allowed");
        else useLobbyTournamentBtn.classList.remove("opacity-40", "cursor-not-allowed");
      }
    };

    const syncTournamentControls = () => {
      const statusEl = document.getElementById("tournamentOnlineStatus") as HTMLDivElement | null;
      const tournamentStartBtn = document.getElementById("tournamentStartBtn") as HTMLButtonElement | null;
      const tournamentMatchBtn = document.getElementById("tournamentMatchBtn") as HTMLButtonElement | null;
      const tournamentPlayBtn = document.getElementById("tournamentPlayBtn") as HTMLButtonElement | null;

      const wsOpen = this.wsState === "open";
      const hasLobby = !!this.lobby;
      const isHost = !!this.lobby && this.myUserId != null && this.lobby.hostUserId === this.myUserId;
      const lobbySize = this.lobby?.members?.length ?? 0;
      const lobbyOk = lobbySize >= 4 && lobbySize % 2 === 0;

      const onlineTournamentRunning = !!this.activeTournamentId && !this.activeTournamentFinished;

      const startDisabled = !wsOpen || !hasLobby || !isHost || !lobbyOk || onlineTournamentRunning;
      if (tournamentStartBtn) {
        tournamentStartBtn.disabled = startDisabled;
        if (startDisabled) tournamentStartBtn.classList.add("opacity-40", "cursor-not-allowed");
        else tournamentStartBtn.classList.remove("opacity-40", "cursor-not-allowed");
      }

      const matchDisabled =
        !wsOpen ||
        !hasLobby ||
        !isHost ||
        !this.activeTournamentId ||
        this.activeTournamentFinished ||
        !!this.activeTournamentMatch;

      if (tournamentMatchBtn) {
        tournamentMatchBtn.disabled = matchDisabled;
        if (matchDisabled) tournamentMatchBtn.classList.add("opacity-40", "cursor-not-allowed");
        else tournamentMatchBtn.classList.remove("opacity-40", "cursor-not-allowed");
      }

      const activeMatchBlocksPlay = this.activeTournamentMatch &&
        this.myUserId != null &&
        this.activeTournamentMatch.player1Id !== this.myUserId &&
        this.activeTournamentMatch.player2Id !== this.myUserId;

      const playDisabled =
        !wsOpen ||
        !hasLobby ||
        !isHost ||
        !this.activeTournamentId ||
        this.activeTournamentFinished ||
        !this.activeTournamentMatch ||
        !!activeMatchBlocksPlay;

      if (tournamentPlayBtn) {
        tournamentPlayBtn.disabled = playDisabled;
        if (playDisabled) tournamentPlayBtn.classList.add("opacity-40", "cursor-not-allowed");
        else tournamentPlayBtn.classList.remove("opacity-40", "cursor-not-allowed");
      }

      if (!statusEl) return;
      if (!wsOpen) {
        statusEl.textContent = lang('game.wsRequired');
        return;
      }
      if (!hasLobby) {
        statusEl.textContent = lang('game.noLobbyTournament');
        return;
      }
      if (!lobbyOk) {
        statusEl.textContent = lang('game.notEnoughPlayers');
        return;
      }
      if (!isHost) {
        statusEl.textContent = lang('game.notHost');
        return;
      }
      if (onlineTournamentRunning) {
        statusEl.textContent = lang('game.tournamentRunning') ;
        return;
      }
      statusEl.textContent = lang('game.readyToStart') + lobbySize + lang('game.startAsHost');
    };

    const ensureLobbyTournamentInputs = () => {
      if (!this.lobby || !Array.isArray(this.lobby.members)) return false;
      const size = this.lobby.members.length;
      if (size < 4 || size % 2 !== 0) return false;

      const playerCountEl = document.getElementById("playerCount") as HTMLSelectElement | null;
      if (playerCountEl) {
        const value = String(size);
        if (!Array.from(playerCountEl.options).some((o) => o.value === value)) {
          const opt = document.createElement("option");
          opt.value = value;
          opt.textContent = value;
          playerCountEl.appendChild(opt);
        }
        playerCountEl.value = value;
        playerCountEl.disabled = true;
        playerCountEl.classList.add("opacity-60", "cursor-not-allowed");
      }
      updatePlayerInputs();

      for (let i = 1; i <= size; i++) {
        const member = this.lobby.members[i - 1];
        const nameInput = document.getElementById(`p${i}`) as HTMLInputElement | null;
        const typeSelect = document.getElementById(`pType${i}`) as HTMLSelectElement | null;

        if (nameInput) {
          nameInput.value = member?.alias || `${lang('game.player')} ${i}`;
          nameInput.disabled = true;
        }
        if (typeSelect) {
          typeSelect.value = "human";
          typeSelect.disabled = true;
        }
      }

      return true;
    };

    const applyLockUI = () => {
      const tournamentRunning = !!this.activeTournamentId && !this.activeTournamentFinished;
      const hasLobby = !!this.lobby;
      const locked = this.myGameState === "inGame" || tournamentRunning || hasLobby;

      const buttons: Array<HTMLButtonElement | null> = [startBtn, resetBtn, customizeBtn, tournamentBtn];
      for (const b of buttons) {
        if (!b) continue;
        b.disabled = locked;
        if (locked) b.classList.add("opacity-40", "cursor-not-allowed");
        else b.classList.remove("opacity-40", "cursor-not-allowed");
      }

      if (readyBtn) {
        const isOnline1v1Lobby = !!this.lobby && Array.isArray(this.lobby.members) && this.lobby.members.length === 2;
        const canReadyNow =
          isOnline1v1Lobby &&
          !!this.activeOnlineMatchId &&
          !this.onlineMatchInProgress &&
          !tournamentRunning;

        readyBtn.disabled = !canReadyNow;
        if (!canReadyNow) readyBtn.classList.add("opacity-40", "cursor-not-allowed");
        else readyBtn.classList.remove("opacity-40", "cursor-not-allowed");
      }

      const canvas = document.getElementById("c") as HTMLCanvasElement | null;
      if (canvas) {
        if (locked) canvas.classList.add("opacity-60");
        else canvas.classList.remove("opacity-60");
      }
      const bannerId = "gameLockBanner";
      const existing = document.getElementById(bannerId);
      if (!locked) {
        existing?.remove();
        return;
      }

      if (!existing) {
        const banner = document.createElement("div");
        banner.id = bannerId;
        banner.className =
          "mt-3 w-full max-w-[800px] border border-amber-700 bg-amber-900/20 text-amber-200 rounded-xl px-3 py-2 text-sm";

        const msg = tournamentRunning
          ? lang('game.tournamentActiveDisabled')
          : lang('game.locked');

        banner.innerHTML = msg;

        const canvasEl = document.getElementById("c");
        if (canvasEl && canvasEl.parentElement) {
          canvasEl.parentElement.appendChild(banner);
        }
      }
    };

    const toast = (text: string) => {
      if (!toastEl) return;
      toastEl.textContent = text;
      if (text) {
        setTimeout(() => {
          if (toastEl.textContent === text) toastEl.textContent = "";
        }, 3500);
      }
    };

    let announceBannerTimer: number | null = null;
    let announcePulseTimer: number | null = null;
    const showAnnounceBanner = (text: string, colorClass = "bg-yellow-600/90") => {
      const banner = document.getElementById("tournamentAnnounceBanner");
      if (!banner) return;

      if (announceBannerTimer) { clearTimeout(announceBannerTimer); announceBannerTimer = null; }
      if (announcePulseTimer) { clearTimeout(announcePulseTimer); announcePulseTimer = null; }

      banner.className = `max-w-6xl mx-auto px-4 mt-2 py-3 rounded-lg ${colorClass} text-white text-center font-semibold text-sm animate-pulse`;
      banner.textContent = text;

      announcePulseTimer = window.setTimeout(() => {
        banner.classList.remove("animate-pulse");
        announcePulseTimer = null;
      }, 3000);

      announceBannerTimer = window.setTimeout(() => {
        banner.className = "hidden max-w-6xl mx-auto px-4 mt-2";
        banner.textContent = "";
        announceBannerTimer = null;
      }, 12000);
    };

    const maybeHandlePendingOnlineConfirm = () => {
      const pending = this.pendingOnlineResultConfirm;
      if (!pending) return;

      const isHost = this.lobby != null && this.myUserId != null && this.lobby.hostUserId === this.myUserId;
      if (isHost) {
        this.pendingOnlineResultConfirm = null;
        return;
      }

      const knownMatchId = this.activeOnlineMatchId || (this.lobby?.activeOnlineMatch?.matchId ?? null);
      if (!knownMatchId || String(knownMatchId) !== String(pending.matchId)) return;

      this.pendingOnlineResultConfirm = null;
      const ok = window.confirm(lang('game.hostScoreConfirm').replace('{{p1}}', String(pending.player1Score)).replace('{{p2}}', String(pending.player2Score)));
      this.ws.send({ type: "match/result/confirm", matchId: pending.matchId, accept: ok });
      toast(ok ? lang('game.scoreApproved') : lang('game.scoreRejected'));
    };

    const unlockTournamentSetupInputs = () => {
      const playerCountEl = document.getElementById("playerCount") as HTMLSelectElement | null;
      if (playerCountEl) {
        playerCountEl.disabled = false;
        playerCountEl.classList.remove("opacity-60", "cursor-not-allowed");
      }

      const container = document.getElementById("playerInputs");
      if (container) {
        container.querySelectorAll("input").forEach((el) => {
          const i = el as HTMLInputElement;
          i.disabled = false;
          i.classList.remove("opacity-60", "cursor-not-allowed");
        });
        container.querySelectorAll("select").forEach((el) => {
          const s = el as HTMLSelectElement;
          s.disabled = false;
          s.classList.remove("opacity-60", "cursor-not-allowed");
        });
      }
    };

    const showTournamentBracketView = () => {
      const tournamentPanel = document.getElementById("tournamentPanel") as HTMLDivElement | null;
      const setup = document.getElementById("tournamentSetupSection") as HTMLDivElement | null;
      const setupButtons = document.getElementById("tournamentSetupButtons") as HTMLDivElement | null;
      const bracketView = document.getElementById("bracketView") as HTMLDivElement | null;
      const championView = document.getElementById("championView") as HTMLDivElement | null;
      if (tournamentPanel) tournamentPanel.style.display = "block";
      if (setup) setup.style.display = "none";
      if (setupButtons) setupButtons.style.display = "none";
      if (bracketView) bracketView.style.display = "block";
      if (championView) championView.style.display = "none";
    };

    const showTournamentChampionView = (placements: Array<{ userId: number; place: number }>) => {
      const championView = document.getElementById("championView") as HTMLDivElement | null;
      const bracketView = document.getElementById("bracketView") as HTMLDivElement | null;
      const championName = document.getElementById("championName") as HTMLSpanElement | null;

      const aliasById = new Map<number, string>();
      if (this.lobby?.members) {
        for (const m of this.lobby.members) aliasById.set(m.id, m.alias);
      }

      const sorted = [...placements].sort((a, b) => a.place - b.place);
      const label = (uid: number) => aliasById.get(uid) || `#${uid}`;
      const line = (p?: { userId: number; place: number }) => (p ? `${p.place}. ${label(p.userId)}` : "");

      const first = sorted.find((p) => p.place === 1);
      const second = sorted.find((p) => p.place === 2);
      const third = sorted.find((p) => p.place === 3);

      if (championName) {
        championName.textContent = [line(first), line(second), line(third)].filter(Boolean).join(" | ");
      }

      if (bracketView) bracketView.style.display = "none";
      if (championView) championView.style.display = "block";
    };

    const stageLabel = (stage: string) => {
      const s = String(stage || "").toUpperCase();
      if (s === "ROUND1") return lang('game.stageRound1');
      if (s === "QUARTERFINAL") return lang('game.stageQuarterFinal');
      if (s === "SEMIFINAL") return lang('game.stageSemiFinal');
      if (s === "THIRD_PLACE") return lang('game.stageThirdPlace');
      if (s === "FINAL") return lang('game.stageFinal');
      return s || lang('game.stageMatch');
    };

    const renderOnlineTournamentState = (state: {
      tournamentId: string;
      finished: boolean;
      activeMatch: { matchId: string; player1Id: number; player2Id: number; stage?: string } | null;
      participantUserIds: number[];
      matches: Array<{
        matchId: string;
        stage: string;
        player1Id: number | null;
        player2Id: number | null;
        player1Score: number | null;
        player2Score: number | null;
        winnerId: number | null;
        completed: boolean;
      }>;
    }) => {
      const bracket = document.getElementById("bracket") as HTMLDivElement | null;

      showTournamentBracketView();

      if (!bracket) return;

      const aliasById = new Map<number, string>();
      if (this.lobby?.members) {
        for (const m of this.lobby.members) aliasById.set(m.id, m.alias);
      }
      const label = (uid: number | null) => {
        if (uid == null) return "?";
        return aliasById.get(uid) || `#${uid}`;
      };

      const byStage = new Map<string, typeof state.matches>();
      for (const m of state.matches) {
        const k = String(m.stage || "");
        const arr = byStage.get(k) || [];
        arr.push(m);
        byStage.set(k, arr);
      }

      const stageOrder = ["ROUND1", "QUARTERFINAL", "SEMIFINAL", "THIRD_PLACE", "FINAL"];
      const orderedStages = [...byStage.keys()].sort((a, b) => {
        const ia = stageOrder.indexOf(String(a).toUpperCase());
        const ib = stageOrder.indexOf(String(b).toUpperCase());
        if (ia === -1 && ib === -1) return String(a).localeCompare(String(b));
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });

      const active = state.activeMatch;
      const activeText = active
        ? lang('game.activeMatch').replace('{{stage}}', stageLabel(active.stage || "")).replace('{{p1}}', escapeHtml(label(active.player1Id))).replace('{{p2}}', escapeHtml(label(active.player2Id)))
        : state.finished
          ? lang('game.tournamentCompleted')
          : lang('game.nextMatchWaiting');

      bracket.innerHTML = `
        <div class="w-full text-center text-sm text-gray-300 mb-3">${activeText}</div>
      `;

      for (const st of orderedStages) {
        const matches = byStage.get(st) || [];
        const stageBlock = document.createElement("div");
        stageBlock.className = "border border-gray-800 rounded-xl p-3 bg-gray-950/20 min-w-[240px]";
        stageBlock.innerHTML = `<div class="font-semibold mb-2">${stageLabel(st)}</div>`;

        for (const m of matches) {
          const row = document.createElement("div");
          row.className = "text-xs text-gray-300 flex items-center justify-between gap-2 border-t border-gray-800/60 py-2";

          const left = `${escapeHtml(label(m.player1Id))} vs ${escapeHtml(label(m.player2Id))}`;
          const score = m.completed && m.player1Score != null && m.player2Score != null ? `${m.player1Score}-${m.player2Score}` : "?-?";
          const win = m.completed && m.winnerId != null ? ` (${escapeHtml(label(m.winnerId))} ${lang('game.won')})` : "";

          row.innerHTML = `<span class="truncate">${left}${win}</span><span class="shrink-0 text-gray-400">${score}</span>`;
          stageBlock.appendChild(row);
        }

        bracket.appendChild(stageBlock);
      }

    };

    setTournamentExternalHandlers({
      onStartRequested: () => {
        const isHost = !!this.lobby && this.myUserId != null && this.lobby.hostUserId === this.myUserId;
        if (!isHost) {
          toast(lang('game.onlyHostStartTournament'));
          return;
        }

        if (!ensureLobbyTournamentInputs()) {
          toast(lang('game.tournamentNeed4Players'));
          return;
        }

        this.ws.send({ type: "tournament/create" });
      },
      onMatchRequested: () => {
        try {
          const isHost = !!this.lobby && this.myUserId != null && this.lobby.hostUserId === this.myUserId;
          if (!isHost) {
            toast(lang('game.onlyHostMatch'));
            return;
          }
          if (!this.activeTournamentId || !this.lobby) {
            toast(lang('game.tournamentNotActive'));
            return;
          }

          if (this.activeTournamentFinished) {
            toast(lang('game.tournamentEnded'));
            return;
          }

          if (this.activeTournamentMatch) {
            toast(lang('game.matchAlreadyActive'));
            return;
          }

          this.ws.send({ type: "tournament/match/start", tournamentId: this.activeTournamentId });
          toast(lang('game.matching'));
        } catch {
        }
      },
      onPlayRequested: () => {
        try {
          const isHost = !!this.lobby && this.myUserId != null && this.lobby.hostUserId === this.myUserId;
          if (!isHost) {
            toast(lang('game.onlyHostStartMatch'));
            return;
          }
          if (!this.activeTournamentId || !this.lobby) {
            toast(lang('game.tournamentNotActive'));
            return;
          }

          if (this.activeTournamentFinished) {
            toast(lang('game.tournamentEnded'));
            return;
          }

          if (this.myGameState === "inGame") {
            toast(lang('game.matchAlreadyStarted'));
            return;
          }

          if (!this.activeTournamentMatch) {
            toast(lang('game.matchNotPaired'));
            return;
          }

          const myId = this.myUserId;
          const p1 = this.activeTournamentMatch.player1Id;
          const p2 = this.activeTournamentMatch.player2Id;

          if (myId === p1 || myId === p2) {
            resetPongGame();

            const gameMode = document.getElementById("gameMode") as HTMLSelectElement | null;
            if (gameMode) gameMode.value = "2P";
            applyPongSettings();

            this.myGameState = "inGame";
            this.ws.send({ type: "game/state", state: "inGame" });

            startPongGame();
            toast(lang('game.matchStarted'));
          } else {
            toast(lang('game.youAreSpectator'));
          }
        } catch {
        }
      },
      onExitRequested: () => {
        try {
          const isHost = !!this.lobby && this.myUserId != null && this.lobby.hostUserId === this.myUserId;
          if (isHost && this.activeTournamentId) {
            this.ws.send({ type: "tournament/close" });
          }
        } catch {
        }
      },
    });

    const formatDate = (isoOrSql: string) => {
      const d = new Date(isoOrSql);
      if (Number.isNaN(d.getTime())) return String(isoOrSql);
      const localeMap: Record<string, string> = { tr: 'tr-TR', en: 'en-US', fr: 'fr-FR' };
      const locale = localeMap[getLang()] || 'en-US';
      return d.toLocaleString(locale);
    };

    const renderMatchHistory = (matches: MatchHistoryItem[]) => {
      if (!matchHistoryList) return;
      matchHistoryList.innerHTML = "";

      if (!matches.length) {
        const empty = document.createElement("div");
        empty.className = "text-xs text-gray-500";
        empty.textContent = lang('game.noMatchesYet');
        matchHistoryList.appendChild(empty);
        return;
      }

      for (const m of matches) {
        const isVerified = m.is_verified === true;
        const badgeClass =
          m.result === "win"
            ? "bg-emerald-900/40 border-emerald-800 text-emerald-200"
            : m.result === "loss"
              ? "bg-red-900/30 border-red-800 text-red-200"
              : "bg-gray-900/40 border-gray-800 text-gray-200";

        const scoreText = isVerified && m.myScore != null && m.opponentScore != null ? `${m.myScore} - ${m.opponentScore}` : "?-?";

        const getModeLabel = () => {
          const rawMode = String(m.mode || "").trim().toUpperCase();
          if (rawMode === "AI") return lang('game.customize.modes.AI');
          if (rawMode === "2P") return lang('game.customize.modes.twoPlayerLocal');
          if (rawMode === "ONLINE") return lang('game.online');
          if (rawMode === "TOURNAMENT") return lang('game.tournament');
          if (rawMode === "CUSTOM") return lang('api.customGame');
          return rawMode || lang('game.unverified');
        };

        const getBadgeText = () => {
          const res = String(m.result || "").toLowerCase();

          if (res === "win") return lang('game.win');
          if (res === "loss") return lang('game.loss');
          if (res === "draw") return lang('game.draw');
          return getModeLabel();
        };

        const badgeText = getBadgeText();
        const translateStage = (raw: string) => {
          const s = String(raw).trim().toUpperCase();
          if (s === 'ROUND1') return lang('game.stageRound1');
          if (s === 'QUARTERFINAL') return lang('game.stageQuarterFinal');
          if (s === 'SEMIFINAL') return lang('game.stageSemiFinal');
          if (s === 'THIRD_PLACE') return lang('game.stageThirdPlace');
          if (s === 'FINAL') return lang('game.stageFinal');
          if (s.startsWith('ROUND')) return lang('game.stageMatch');
          return raw;
        };

        const tournamentMeta: string[] = [];
        if (isVerified && m.tournament_id) tournamentMeta.push("🏆");
        if (isVerified && m.stage) tournamentMeta.push(translateStage(m.stage));
        if (isVerified && m.placement != null) tournamentMeta.push(`#${m.placement}`);

        const metaText = tournamentMeta.length ? ` <span class="text-[11px] text-gray-500">${tournamentMeta.join(" ")}</span>` : "";

        const row = document.createElement("div");
        row.className = "border border-gray-800 rounded-xl px-3 py-2 bg-gray-950/30";
        row.innerHTML = `
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="font-medium truncate">${escapeHtml(m.opponent)} <span class="text-xs text-gray-500">(${getModeLabel()})</span>${metaText}</div>
              <div class="text-xs text-gray-500">${formatDate(m.created_at)}</div>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-sm">${scoreText}</span>
              <span class="text-xs px-2 py-1 rounded-lg border ${badgeClass}">${badgeText}</span>
            </div>
          </div>
        `;
        matchHistoryList.appendChild(row);
      }
    };

    const loadMatchHistory = async () => {
      const data = await MatchService.getMyMatches(5, 0);
      if (data) {
        renderMatchHistory(data.matches || []);
      }
    };

    refreshMatchHistoryBtn?.addEventListener("click", () => {
      loadMatchHistory();
    });

    const getFriendAlias = (userId: number) => {
      return this.friends.find((f) => f.id === userId)?.alias || String(userId);
    };

    const renderOnlineFriends = () => {
      if (!onlineFriendsList) return;
      onlineFriendsList.innerHTML = "";

      const online = this.friends
        .map((f) => {
          const p = this.presence.get(f.id) || { status: "offline", gameState: "inLobby" as const };
          return { ...f, presence: p };
        })
        .filter((x) => x.presence.status === "online");

      if (!online.length) {
        const empty = document.createElement("div");
        empty.className = "text-xs text-gray-500";
        empty.textContent = lang('game.noOnlineFriends');
        onlineFriendsList.appendChild(empty);
        return;
      }

      for (const f of online) {
        const disabled = f.presence.gameState === "inGame";
        const row = document.createElement("div");
        row.className = "flex items-center justify-between gap-2 border border-gray-800 rounded-xl px-3 py-2";
        row.innerHTML = `
          <div class="min-w-0">
            <div class="font-medium truncate">${escapeHtml(f.alias)}</div>
            <div class="text-xs ${disabled ? "text-amber-400" : "text-emerald-400"}">
              ${disabled ? lang('game.inGame') : lang('game.inLobby')}
            </div>
          </div>
          <button class="inviteBtn px-2 py-1 rounded-lg text-xs ${disabled ? "bg-gray-800 text-gray-500" : "bg-blue-600 hover:bg-blue-500 text-white"}"
            data-id="${f.id}" ${disabled ? "disabled" : ""}>
            ${lang('game.invite')}
          </button>
        `;
        onlineFriendsList.appendChild(row);
      }

      onlineFriendsList.querySelectorAll("button.inviteBtn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const toUserId = Number((btn as HTMLButtonElement).dataset.id);
          if (!Number.isFinite(toUserId)) return;
          this.ws.send({ type: "game/invite/send", toUserId });
        });
      });
    };

    const formatLeft = (expiresAt: number) => {
      const ms = expiresAt - Date.now();
      const s = Math.max(0, Math.ceil(ms / 1000));
      return `${s}s`;
    };

    const renderIncomingInvites = () => {
      if (!incomingInvitesList) return;
      incomingInvitesList.innerHTML = "";

      const invites = Array.from(this.incomingInvites.values()).sort((a, b) => a.expiresAt - b.expiresAt);
      if (!invites.length) {
        const empty = document.createElement("div");
        empty.className = "text-xs text-gray-500";
        empty.textContent = `${lang('game.noInvite')}`;
        incomingInvitesList.appendChild(empty);
        return;
      }

      for (const inv of invites) {
        const row = document.createElement("div");
        row.className = "border border-gray-800 rounded-xl px-3 py-2";
        row.innerHTML = `
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="font-medium truncate">${escapeHtml(inv.fromAlias)}</div>
              <div class="text-xs text-gray-500">${lang('game.timeout')}: ${formatLeft(inv.expiresAt)}</div>
            </div>
            <div class="flex gap-2">
              <button class="acceptInviteBtn px-2 py-1 rounded-lg text-xs bg-emerald-600 hover:bg-emerald-500 text-white" data-id="${inv.inviteId}">${lang('chat.accept')}</button>
              <button class="rejectInviteBtn px-2 py-1 rounded-lg text-xs bg-gray-800 hover:bg-gray-700" data-id="${inv.inviteId}">${lang('chat.decline')}</button>
            </div>
          </div>
        `;
        incomingInvitesList.appendChild(row);
      }

      incomingInvitesList.querySelectorAll("button.acceptInviteBtn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const inviteId = String((btn as HTMLButtonElement).dataset.id || "");
          if (!inviteId) return;
          this.ws.send({ type: "game/invite/accept", inviteId });
        });
      });
      incomingInvitesList.querySelectorAll("button.rejectInviteBtn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const inviteId = String((btn as HTMLButtonElement).dataset.id || "");
          if (!inviteId) return;
          this.ws.send({ type: "game/invite/reject", inviteId });
        });
      });
    };

    const renderOutgoingInvites = () => {
      if (!outgoingInvitesList) return;
      outgoingInvitesList.innerHTML = "";

      const invites = Array.from(this.outgoingInvites.values()).sort((a, b) => a.expiresAt - b.expiresAt);
      if (!invites.length) {
        const empty = document.createElement("div");
        empty.className = "text-xs text-gray-500";
        empty.textContent = `${lang('game.noInvite')}`;
        outgoingInvitesList.appendChild(empty);
        return;
      }

      for (const inv of invites) {
        const row = document.createElement("div");
        row.className = "border border-gray-800 rounded-xl px-3 py-2";
        row.innerHTML = `
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="font-medium truncate">${escapeHtml(inv.toAlias)}</div>
              <div class="text-xs text-gray-500">${lang('game.timeout')}: ${formatLeft(inv.expiresAt)}</div>
            </div>
            <div class="text-xs text-gray-500">${lang('game.waiting')}</div>
          </div>
        `;
        outgoingInvitesList.appendChild(row);
      }
    };

    const renderLobby = () => {
      if (!lobbyBox) return;
      if (!this.lobby) {
        lobbyBox.innerHTML = `<div class="text-xs text-gray-500">${lang('game.noLobby')}</div>`;
        syncLobbyButtons();
        return;
      }

      const members = this.lobby.members;
      lobbyBox.innerHTML = `
        <div class="text-xs text-gray-500">${lang('game.lobby')}: ${this.lobby.lobbyId}</div>
        <div class="mt-2 flex flex-col gap-1">
          ${members
          .map(
            (m) =>
              `<div class="flex items-center justify-between"><span>${escapeHtml(m.alias)}${m.id === this.lobby!.hostUserId ? " <span class=\"text-[11px] text-amber-400\">(host)</span>" : ""}</span><span class="text-[11px] text-gray-500">#${m.id}</span></div>`,
          )
          .join("")}
        </div>
      `;

      syncLobbyButtons();
    };

    const syncOnlineSessionFromLobby = (rawLobby: any) => {
      if (!rawLobby || typeof rawLobby !== "object") return;

      const snap = normalizeLobbySnapshot(rawLobby);
      if (!snap) return;

      const is1v1 = Array.isArray(snap.members) && snap.members.length === 2;

      const rawActive = rawLobby.activeOnlineMatch;
      const matchId = rawActive && typeof rawActive.matchId === "string" ? rawActive.matchId : String(rawActive?.matchId || "");

      if (!is1v1) {
        if (this.activeOnlineMatchId || this.onlineMatchInProgress) {
          this.activeOnlineMatchId = null;
          this.onlineCodes = {};
          this.onlineReadySent = false;
          this.onlineMatchInProgress = false;
          this.lastAutoSubmittedOnlineScore = null;
          this.onlineHostOnly = false;
          this.onlineSpectator = false;
          this.pendingOnlineResultConfirm = null;
          resetPongGame();
        }
        return;
      }

      if (!matchId) {
        if (this.activeOnlineMatchId || this.onlineMatchInProgress) {
          this.activeOnlineMatchId = null;
          this.onlineCodes = {};
          this.onlineReadySent = false;
          this.onlineMatchInProgress = false;
          this.lastAutoSubmittedOnlineScore = null;
          this.onlineHostOnly = false;
          this.onlineSpectator = false;
          this.pendingOnlineResultConfirm = null;
          resetPongGame();
        }
        return;
      }

      if (this.activeOnlineMatchId !== matchId) {
        this.activeOnlineMatchId = matchId;
        this.onlineReadySent = false;
        this.lastAutoSubmittedOnlineScore = null;
      }

      this.onlineHostOnly = rawActive?.hostOnly !== false;

      const hostId = Number(rawActive?.hostUserId ?? snap.hostUserId);
      this.onlineSpectator =
        Number.isFinite(hostId) && this.myUserId != null && Number(this.myUserId) !== Number(hostId);

      const phase = String(rawActive?.phase || "created");
      this.onlineMatchInProgress = phase === "began";

      try {
        const codes = rawActive?.codes as Record<string, string> | undefined;
        const myId = this.myUserId;
        if (codes && myId != null) {
          const myCode = codes[String(myId)];
          const oppId = snap.members.find((m) => m.id !== myId)?.id;
          const oppCode = oppId != null ? codes[String(oppId)] : undefined;
          this.onlineCodes = { myCode, opponentCode: oppCode };
        }
      } catch {
      }
    };

    const normalizeLobbySnapshot = (raw: any): LobbySnapshot | null => {
      if (!raw || typeof raw !== "object") return null;
      const lobbyId = String(raw.lobbyId || "");
      const hostUserId = Number(raw.hostUserId);
      const membersRaw = Array.isArray(raw.members) ? raw.members : [];
      if (!lobbyId || !Number.isFinite(hostUserId) || hostUserId <= 0) return null;

      const members = membersRaw
        .map((m: any) => ({ id: Number(m?.id), alias: String(m?.alias || "") }))
        .filter((m: any) => Number.isFinite(m.id) && m.id > 0)
        .map((m: any) => ({ id: m.id, alias: m.alias || String(m.id) }));

      const activeRaw = raw.activeOnlineMatch
      let activeOnlineMatch: LobbySnapshot["activeOnlineMatch"] = null
      if (activeRaw && typeof activeRaw === "object" && activeRaw.matchId != null) {
        const matchId = String(activeRaw.matchId || "")
        if (matchId) {
          activeOnlineMatch = {
            matchId,
            hostUserId: Number(activeRaw.hostUserId ?? hostUserId),
            hostOnly: activeRaw.hostOnly !== false,
            phase: activeRaw.phase === "began" ? "began" : "created",
            beganAt: activeRaw.beganAt == null ? null : Number(activeRaw.beganAt),
            codes: activeRaw.codes && typeof activeRaw.codes === "object" ? (activeRaw.codes as Record<string, string>) : undefined,
          }
        }
      }

      return { lobbyId, hostUserId, members, activeOnlineMatch };
    };

    const applyLobbyToTournament = () => {
      if (isTournamentMatchInProgress()) {
        toast(lang('game.matchInProgressNoChange'));
        return;
      }
      if (isTournamentMode() && !isTournamentFinished()) {
        toast(lang('game.tournamentStartedNoReset'));
        return;
      }
      if (!this.lobby) {
        toast(`${lang('game.noLobby')}`);
        return;
      }

      if (!Array.isArray(this.lobby.members) || this.lobby.members.length < 4 || this.lobby.members.length % 2 !== 0) {
        toast(lang('game.tournamentNeed4PlayersLobby'));
        return;
      }

      showTournamentSetup();

      const participants = this.lobby.members.map((m) => ({ name: m.alias, type: "human" as const }));

      const playerCountEl = document.getElementById("playerCount") as HTMLSelectElement | null;
      if (playerCountEl) {
        const value = String(participants.length);
        if (!Array.from(playerCountEl.options).some((o) => o.value === value)) {
          const opt = document.createElement("option");
          opt.value = value;
          opt.textContent = value;
          playerCountEl.appendChild(opt);
        }
        playerCountEl.value = value;
        playerCountEl.disabled = true;
        playerCountEl.classList.add("opacity-60", "cursor-not-allowed");
      }

      updatePlayerInputs();

      for (let i = 0; i < participants.length; i++) {
        const p = participants[i];
        const idx = i + 1;
        const nameInput = document.getElementById(`p${idx}`) as HTMLInputElement | null;
        const typeSelect = document.getElementById(`pType${idx}`) as HTMLSelectElement | null;
        if (nameInput) nameInput.value = p.name;
        if (typeSelect) typeSelect.value = p.type;

        if (nameInput) {
          nameInput.disabled = true;
          nameInput.classList.add("opacity-60", "cursor-not-allowed");
        }
        if (typeSelect) {
          typeSelect.value = "human";
          typeSelect.disabled = true;
          typeSelect.classList.add("opacity-60", "cursor-not-allowed");
        }
      }

      toast(lang('game.lobbyFilledTournament'));
      syncTournamentLockButtons();
    };

    refreshLobbyBtn?.addEventListener("click", () => {
      this.ws.send({ type: "game/lobby/get" });
    });
    useLobbyTournamentBtn?.addEventListener("click", applyLobbyToTournament);

    start1v1Btn?.addEventListener("click", (e) => {
      e.preventDefault();
      const is1v1Lobby = !!this.lobby && Array.isArray(this.lobby.members) && this.lobby.members.length === 2;
      if (!is1v1Lobby) return;
      if (this.activeTournamentId && !this.activeTournamentFinished) return;

      const isHost = this.myUserId != null && this.lobby?.hostUserId === this.myUserId;
      if (!isHost) {
        toast(lang('game.onlyHost1v1'));
        return;
      }

      this.ws.send({ type: "game/match/start" });
      toast(lang('game.session1v1Created'));

      if (onlineSessionStartProbeTimer) window.clearTimeout(onlineSessionStartProbeTimer);
      onlineSessionStartProbeTimer = window.setTimeout(() => {
        onlineSessionStartProbeTimer = null;
        if (!this.activeOnlineMatchId) {
          this.ws.send({ type: "game/lobby/get" });
        }
      }, 1200);

      if (this.myGameState !== "inGame") {
        this.ws.send({ type: "game/state", state: "inGame" });
      }
      syncLobbyButtons();
    });

    readyBtn?.addEventListener(
      "click",
      (e) => {
        const is1v1Lobby = !!this.lobby && Array.isArray(this.lobby.members) && this.lobby.members.length === 2;
        if (!is1v1Lobby) return;
        if (this.activeTournamentId && !this.activeTournamentFinished) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        if (!this.activeOnlineMatchId) {
          this.ws.send({ type: "game/lobby/get" });
          toast(lang('game.waitForHost1v1'));
          return;
        }
        if (this.onlineMatchInProgress) return;

        if (!this.onlineReadySent) {
          this.onlineReadySent = true;
          this.ws.send({ type: "game/match/ready", matchId: this.activeOnlineMatchId });
          toast(lang('game.readyWaitingOpponent'));
          syncLobbyButtons();
        } else {
          toast(lang('game.waitingForOpponent'));
        }
      },
      true,
    );

    lobbyLeaveBtn?.addEventListener("click", () => {
      const activeMatch = !!this.activeTournamentMatch || this.onlineMatchInProgress;
      if (activeMatch) {
        const ok = window.confirm(
          lang('game.leaveMatchConfirm'),
        );
        if (!ok) return;
      }
      this.ws.send({ type: "game/lobby/leave" });
    });
    lobbyCloseBtn?.addEventListener("click", () => {
      const activeMatch = !!this.activeTournamentMatch || this.onlineMatchInProgress;
      if (activeMatch) {
        const ok = window.confirm(
          lang('game.closeMatchConfirm'),
        );
        if (!ok) return;
      }
      this.ws.send({ type: "game/lobby/close" });
    });

    try {
      const res = await ProfileService.getFriends();
      this.friends = res?.friends || [];
      for (const f of this.friends) {
        if (!this.presence.has(f.id)) this.presence.set(f.id, { status: "offline", gameState: "inLobby" });
      }
    } catch {
    }

    renderOnlineFriends();
    renderIncomingInvites();
    renderOutgoingInvites();
    renderLobby();
    syncTournamentLockButtons();
    syncTournamentControls();

    this.unsubscribeState?.();
    this.unsubscribeMessage?.();

    this.unsubscribeState = this.ws.onState((s) => {
      this.wsState = s;
      if (s === "open") {
        this.ws.send({ type: "presence/request" });
        this.ws.send({ type: "game/page/enter" });
      }
      syncTournamentControls();
    });

    this.unsubscribeMessage = this.ws.onMessage((payload) => {
      if (!payload || typeof payload.type !== "string") return;

      if (payload.type === "presence/initial" && Array.isArray(payload.presence)) {
        for (const p of payload.presence) {
          if (typeof p.userId === "number" && (p.status === "online" || p.status === "offline")) {
            const gs: GamePresenceState = p.gameState === "inGame" ? "inGame" : "inLobby";
            this.presence.set(p.userId, { status: p.status, gameState: gs });
          }
        }
        renderOnlineFriends();
        return;
      }

      if (payload.type === "presence/update") {
        if (typeof payload.userId === "number" && (payload.status === "online" || payload.status === "offline")) {
          const gs: GamePresenceState = payload.gameState === "inGame" ? "inGame" : "inLobby";
          this.presence.set(payload.userId, { status: payload.status, gameState: gs });
          renderOnlineFriends();
        }
        return;
      }

      if (payload.type === "game/invite/received") {
        const inviteId = String(payload.inviteId || "");
        const lobbyId = String(payload.lobbyId || "");
        const fromUserId = Number(payload.fromUserId);
        const fromAlias = String(payload.fromAlias || getFriendAlias(fromUserId));
        const expiresAt = Number(payload.expiresAt);

        if (inviteId && lobbyId && Number.isFinite(fromUserId) && Number.isFinite(expiresAt)) {
          this.incomingInvites.set(inviteId, { inviteId, lobbyId, fromUserId, fromAlias, expiresAt });
          renderIncomingInvites();
          toast(lang('game.inviteReceived').replace('{{alias}}', fromAlias));
        }
        return;
      }

      if (payload.type === "game/invite/sent") {
        const inviteId = String(payload.inviteId || "");
        const lobbyId = String(payload.lobbyId || "");
        const toUserId = Number(payload.toUserId);
        const expiresAt = Number(payload.expiresAt);

        if (inviteId && lobbyId && Number.isFinite(toUserId) && Number.isFinite(expiresAt)) {
          this.outgoingInvites.set(inviteId, {
            inviteId,
            lobbyId,
            toUserId,
            toAlias: getFriendAlias(toUserId),
            expiresAt,
          });
          renderOutgoingInvites();
          toast(lang('game.inviteSent'));
        }
        return;
      }

      if (payload.type === "game/invite/expired") {
        const inviteId = String(payload.inviteId || "");
        if (inviteId) {
          this.incomingInvites.delete(inviteId);
          this.outgoingInvites.delete(inviteId);
          renderIncomingInvites();
          renderOutgoingInvites();
        }
        return;
      }

      if (payload.type === "game/invite/rejected") {
        const inviteId = String(payload.inviteId || "");
        if (inviteId) {
          this.incomingInvites.delete(inviteId);
          this.outgoingInvites.delete(inviteId);
          renderIncomingInvites();
          renderOutgoingInvites();
          toast(lang('game.inviteRejected'));
        }
        return;
      }

      if (payload.type === "game/invite/accepted") {
        const inviteId = String(payload.inviteId || "");
        if (inviteId) {
          this.incomingInvites.delete(inviteId);
          this.outgoingInvites.delete(inviteId);
          renderIncomingInvites();
          renderOutgoingInvites();
        }

        if (payload.lobby) {
          const snap = normalizeLobbySnapshot(payload.lobby);
          if (snap) {
            this.lobby = snap;
            syncOnlineSessionFromLobby(payload.lobby);
            renderLobby();
            syncLobbyButtons();
            syncTournamentControls();
          }
        }

        this.myGameState = "inGame";
        if (myStateLabel) myStateLabel.textContent = `${lang('game.stateLabel')}: ${lang('game.inGame')}`;
        applyLockUI();
        syncTournamentLockButtons();
        toast(lang('game.inviteAccepted'));
        return;
      }

      if (payload.type === "game/match/start") {
        try {
          const t = (onlineSessionStartProbeTimer as any) as number | null;
          if (t) window.clearTimeout(t);
        } catch {
        }
        onlineSessionStartProbeTimer = null;

        const lobbyId = String(payload.lobbyId || "");
        if (!this.lobby || !lobbyId || this.lobby.lobbyId !== lobbyId) return;
        if (!Array.isArray(this.lobby.members) || this.lobby.members.length !== 2) return;


        this.activeOnlineMatchId = payload.matchId ? String(payload.matchId) : null;
        this.onlineReadySent = false;
        this.onlineHostOnly = (payload as any).hostOnly !== false;
        this.onlineSpectator = false;
        try {
          const codes = payload.codes as Record<string, string> | undefined;
          const myId = this.myUserId;
          if (codes && myId != null) {
            const myCode = codes[String(myId)];
            const oppId = this.lobby.members.find((m) => m.id !== myId)?.id;
            const oppCode = oppId != null ? codes[String(oppId)] : undefined;
            this.onlineCodes = { myCode, opponentCode: oppCode };
          }
        } catch {
        }

        toast(lang('game.session1v1Ready'));
        syncLobbyButtons();
        return;
      }

      if (payload.type === "game/match/begin") {
        const lobbyId = String(payload.lobbyId || "");
        if (!this.lobby || !lobbyId || this.lobby.lobbyId !== lobbyId) return;
        const mid = payload.matchId ? String(payload.matchId) : null;
        if (!mid || !this.activeOnlineMatchId || mid !== this.activeOnlineMatchId) return;
        if (this.onlineMatchInProgress) return;

        const hostId = payload.hostUserId != null ? Number(payload.hostUserId) : null;
        this.onlineHostOnly = true;
        if (this.myUserId == null) {
          this.onlineSpectator = true;
          this.onlineMatchInProgress = true;
          toast(lang('game.onlineMatchFailed'));
          syncLobbyButtons();
          return;
        }

        this.onlineSpectator = hostId != null && Number(this.myUserId) !== Number(hostId);
        this.onlineMatchInProgress = true;

        if (this.onlineSpectator) {
          toast(lang('game.matchStartedHostPlaying'));
          syncLobbyButtons();
          return;
        }

        forceOnline1v1Mode();
        startPongGame();
        return;
      }

      if (payload.type === "game/match/spectate") {
        const lobbyId = String(payload.lobbyId || "");
        if (!this.lobby || !lobbyId || this.lobby.lobbyId !== lobbyId) return;
        const mid = payload.matchId ? String(payload.matchId) : null;
        if (!mid || !this.activeOnlineMatchId || mid !== this.activeOnlineMatchId) return;

        this.onlineHostOnly = true;
        this.onlineSpectator = true;
        this.onlineMatchInProgress = true;
        toast(lang('game.matchReadySpectating'));
        syncLobbyButtons();
        return;
      }

      if (payload.type === "game/match/cancelled") {
        this.activeOnlineMatchId = null;
        this.onlineCodes = {};
        this.onlineReadySent = false;
        this.onlineMatchInProgress = false;
        this.onlineHostOnly = false;
        this.onlineSpectator = false;
        this.pendingOnlineResultConfirm = null;
        resetPongGame();
        this.ws.send({ type: "game/state", state: "inLobby" });
        toast(lang('game.session1v1Cancelled'));
        syncLobbyButtons();
        return;
      }

      if (payload.type === "game/lobby/update") {
        if (payload.lobby && payload.lobby.lobbyId && Array.isArray(payload.lobby.members)) {
          const prevLobby = this.lobby;
          const nextLobby = normalizeLobbySnapshot(payload.lobby);
          if (!nextLobby) return;

          if (prevLobby && prevLobby.lobbyId === nextLobby.lobbyId) {
            const prevIds = new Set(prevLobby.members.map((m) => m.id));
            const nextIds = new Set(nextLobby.members.map((m) => m.id));
            const removed = prevLobby.members.filter((m) => prevIds.has(m.id) && !nextIds.has(m.id));

            if (isTournamentMode() && !isTournamentFinished()) {
              for (const r of removed) {
                withdrawTournamentPlayerByName(r.alias);
              }
            }
          }

          this.lobby = nextLobby;
          syncOnlineSessionFromLobby(payload.lobby);
          maybeHandlePendingOnlineConfirm();
          renderLobby();
          syncLobbyButtons();
          syncTournamentControls();
        }
        return;
      }

      if (payload.type === "game/lobby/closed") {
        const lobbyId = String(payload.lobbyId || "");
        if (this.lobby && lobbyId && this.lobby.lobbyId === lobbyId) {
          this.lobby = null;
          renderLobby();
        }

        this.activeTournamentId = null;
        this.activeTournamentFinished = false;
        this.activeTournamentMatch = null;
        this.activeOnlineMatchId = null;
        this.onlineCodes = {};
        this.pendingOnlineResultConfirm = null;
        exitTournament(true);
        unlockTournamentSetupInputs();

        this.myGameState = "inLobby";
        if (myStateLabel) myStateLabel.textContent = `${lang('game.stateLabel')}: ${lang('game.inLobby')}`;
        applyLockUI();
        syncTournamentLockButtons();
        syncTournamentControls();
        toast(lang('game.lobbyClosed'));
        return;
      }

      if (payload.type === "game/lobby/left") {
        if (isTournamentMode() && !isTournamentFinished() && this.lobby && this.myUserId != null) {
          const me = this.lobby.members.find((m) => m.id === this.myUserId);
          if (me?.alias) withdrawTournamentPlayerByName(me.alias);
        }
        this.lobby = null;
        renderLobby();

        this.activeTournamentId = null;
        this.activeTournamentFinished = false;
        this.activeTournamentMatch = null;
        this.activeOnlineMatchId = null;
        this.onlineCodes = {};
        this.pendingOnlineResultConfirm = null;
        exitTournament(true);
        unlockTournamentSetupInputs();

        this.myGameState = "inLobby";
        if (myStateLabel) myStateLabel.textContent = `${lang('game.stateLabel')}: ${lang('game.inLobby')}`;
        applyLockUI();
        syncTournamentLockButtons();
        syncTournamentControls();
        toast(lang('game.lobbyLeft'));
        return;
      }

      if (payload.type === "game/lobby/snapshot") {
        if (!payload.lobby) {
          this.lobby = null;
          this.activeOnlineMatchId = null;
          this.onlineCodes = {};
          this.onlineReadySent = false;
          this.onlineMatchInProgress = false;
          this.lastAutoSubmittedOnlineScore = null;
          this.onlineHostOnly = false;
          this.onlineSpectator = false;
          this.pendingOnlineResultConfirm = null;
          renderLobby();
          syncLobbyButtons();
          syncTournamentControls();
          return;
        }
        const snap = normalizeLobbySnapshot(payload.lobby);
        if (snap) {
          this.lobby = snap;
          syncOnlineSessionFromLobby(payload.lobby);
          maybeHandlePendingOnlineConfirm();
          renderLobby();
          syncLobbyButtons();
          syncTournamentControls();
        }
        return;
      }

      if (payload.type === "game/state/ack") {
        const gs: GamePresenceState = payload.state === "inGame" ? "inGame" : "inLobby";
        this.myGameState = gs;
        if (myStateLabel) myStateLabel.textContent = `${lang('game.stateLabel')}: ${gs === 'inGame' ? lang('game.inGame') : lang('game.inLobby')}`;
        applyLockUI();
        syncTournamentLockButtons();
        syncTournamentControls();
        return;
      }

      if (payload.type === "game/state/update") {
        const gs: GamePresenceState = payload.state === "inGame" ? "inGame" : "inLobby";
        this.myGameState = gs;
        if (myStateLabel) myStateLabel.textContent = `${lang('game.stateLabel')}: ${gs === 'inGame' ? lang('game.inGame') : lang('game.inLobby')}`;
        applyLockUI();
        syncTournamentLockButtons();
        syncTournamentControls();
        return;
      }

      if (payload.type === "error") {
        const code = String(payload.error || "unknown");
        const friendly: Record<string, string> = {
          tournament_requires_4_players: lang('game.errTournament4Players'),
          tournament_already_exists: lang('game.errTournamentExists'),
          participants_must_match_lobby: lang('game.errParticipantsMismatch'),
          match_already_active: lang('game.errMatchAlreadyActive'),
          match_in_progress: lang('game.errMatchInProgress'),
          no_active_match: lang('game.errNoActiveMatch'),
          match_mismatch: lang('game.errMatchMismatch'),
          no_lobby: lang('game.errNoLobby'),
          not_host: lang('game.errNotHost'),
          lobby_not_found: lang('game.errLobbyNotFound'),
          already_in_game: lang('game.errAlreadyInGame'),
          already_in_lobby: lang('game.errAlreadyInLobby'),
          user_in_game: lang('game.errUserInGame'),
          user_in_lobby: lang('game.errUserInLobby'),
          user_offline: lang('game.errUserOffline'),
          invite_already_pending: lang('game.errInvitePending'),
          not_friends: lang('game.errNotFriends'),
          blocked: lang('game.errBlocked'),
        };
        toast(friendly[code] || lang('game.errGeneric').replace('{{code}}', code));
        syncTournamentControls();
        return;
      }

      if (payload.type === "tournament/closed") {
        this.activeTournamentId = null;
        this.activeTournamentFinished = false;
        this.activeTournamentMatch = null;
        exitTournament(true);
        unlockTournamentSetupInputs();
        syncLobbyButtons();
        syncTournamentControls();
        toast(lang('game.tournamentClosed'));
        return;
      }

      if (payload.type === "tournament/match/announce") {
        const p1 = escapeHtml(String(payload.player1Alias || "?"));
        const p2 = escapeHtml(String(payload.player2Alias || "?"));
        const stage = escapeHtml(String(payload.stage || ""));
        const announceText = lang('game.tournamentMatchAnnounce')
          .replace('{{p1}}', p1)
          .replace('{{p2}}', p2)
          .replace('{{stage}}', stage);

        showAnnounceBanner(announceText, "bg-yellow-600/90");
        toast(announceText);
        return;
      }

      if (payload.type === "tournament/notification") {
        const evt = String(payload.event || "");
        if (evt === "created") {
          showAnnounceBanner(lang('game.notifyTournamentCreated'), "bg-emerald-600/90");
          toast(lang('game.notifyTournamentCreated'));
        } else if (evt === "next_match") {
          const p1 = escapeHtml(String(payload.player1Alias || "?"));
          const p2 = escapeHtml(String(payload.player2Alias || "?"));
          const stage = String(payload.stage || "");
          const text = lang('game.notifyTournamentNextMatch').replace('{{p1}}', p1).replace('{{p2}}', p2).replace('{{stage}}', stage);
          showAnnounceBanner(text, "bg-yellow-600/90");
          toast(text);
        } else if (evt === "match_won") {
          const winner = escapeHtml(String(payload.winnerAlias || "?"));
          const score = String(payload.score || "");
          const text = lang('game.notifyTournamentMatchWon').replace('{{winner}}', winner).replace('{{score}}', score);
          showAnnounceBanner(text, "bg-green-600/90");
          toast(text);
        } else if (evt === "champion") {
          const champion = escapeHtml(String(payload.championAlias || "?"));
          const text = lang('game.notifyTournamentChampion').replace('{{champion}}', champion);
          showAnnounceBanner(text, "bg-amber-500/90");
          toast(text);
        }
        return;
      }

      if (payload.type === "tournament/created") {
        if (payload.tournamentId) {
          this.activeTournamentId = String(payload.tournamentId);
          this.activeTournamentFinished = false;
          this.activeTournamentMatch = null;
        }
        syncTournamentControls();
        return;
      }

      if (payload.type === "tournament/state") {
        const tid = payload.tournamentId ? String(payload.tournamentId) : null;
        if (!tid) return;

        this.activeTournamentId = tid;
        this.activeTournamentFinished = !!payload.finished;

        let activeMatch: { matchId: string; player1Id: number; player2Id: number; stage?: string } | null = null;
        if (payload.activeMatch && payload.activeMatch.matchId) {
          const mid = String(payload.activeMatch.matchId);
          const p1 = Number(payload.activeMatch.player1Id);
          const p2 = Number(payload.activeMatch.player2Id);
          if (mid && Number.isFinite(p1) && Number.isFinite(p2)) {
            activeMatch = { matchId: mid, player1Id: p1, player2Id: p2, stage: payload.activeMatch.stage };
          }
        }

        this.activeTournamentMatch = activeMatch ? { matchId: activeMatch.matchId, player1Id: activeMatch.player1Id, player2Id: activeMatch.player2Id } : null;

        const st = {
          tournamentId: tid,
          finished: !!payload.finished,
          activeMatch,
          participantUserIds: Array.isArray(payload.participantUserIds) ? payload.participantUserIds.map((n: any) => Number(n)).filter((n: any) => Number.isFinite(n)) : [],
          matches: Array.isArray(payload.matches)
            ? payload.matches
              .map((m: any) => ({
                matchId: String(m.matchId || ""),
                stage: String(m.stage || ""),
                player1Id: m.player1Id == null ? null : Number(m.player1Id),
                player2Id: m.player2Id == null ? null : Number(m.player2Id),
                player1Score: m.player1Score == null ? null : Number(m.player1Score),
                player2Score: m.player2Score == null ? null : Number(m.player2Score),
                winnerId: m.winnerId == null ? null : Number(m.winnerId),
                completed: !!m.completed,
              }))
              .filter((m: any) => !!m.matchId)
            : [],
        };

        renderOnlineTournamentState(st);
        syncTournamentLockButtons();
        syncLobbyButtons();
        syncTournamentControls();
        return;
      }

      if (payload.type === "tournament/finished") {
        const placements = Array.isArray(payload.placements)
          ? payload.placements
            .map((p: any) => ({ userId: Number(p.userId), place: Number(p.place) }))
            .filter((p: any) => Number.isFinite(p.userId) && Number.isFinite(p.place))
          : [];

        this.activeTournamentFinished = true;
        this.activeTournamentMatch = null;
        showTournamentChampionView(placements);
        syncTournamentControls();
        toast(lang('game.tournamentFinished'));
        void loadMatchHistory();
        return;
      }

      if (payload.type === "tournament/match/started") {
        const tid = payload.tournamentId ? String(payload.tournamentId) : null;
        const mid = payload.matchId ? String(payload.matchId) : null;
        const p1 = Number(payload.player1Id);
        const p2 = Number(payload.player2Id);

        if (tid && mid && Number.isFinite(p1) && Number.isFinite(p2)) {
          this.activeTournamentId = tid;
          this.activeTournamentFinished = false;
          this.activeTournamentMatch = { matchId: mid, player1Id: p1, player2Id: p2 };
        }
        syncTournamentControls();
        return;
      }

      if (payload.type === "tournament/match/begin") {
        const tid = payload.tournamentId ? String(payload.tournamentId) : null;
        const mid = payload.matchId ? String(payload.matchId) : null;
        const p1 = Number(payload.player1Id);
        const p2 = Number(payload.player2Id);

        if (!tid || !mid || !Number.isFinite(p1) || !Number.isFinite(p2)) return;

        if (this.myUserId !== p1) {
          toast(lang('game.spectatorInTournament'));
          return;
        }

        this.activeTournamentId = tid;
        this.activeTournamentFinished = false;
        this.activeTournamentMatch = { matchId: mid, player1Id: p1, player2Id: p2 };

        resetPongGame();
        const gameMode = document.getElementById("gameMode") as HTMLSelectElement | null;
        if (gameMode) gameMode.value = "2P";
        applyPongSettings();

        this.myGameState = "inGame";
        this.ws.send({ type: "game/state", state: "inGame" });

        startPongGame();
        const stageLabel = payload.stage ? String(payload.stage) : lang('game.match');
        toast(lang('game.tournamentMatchStarted').replace('{{stage}}', stageLabel));
        syncTournamentControls();
        return;
      }

      if (payload.type === "tournament/match/spectate") {
        const tid = payload.tournamentId ? String(payload.tournamentId) : null;
        const mid = payload.matchId ? String(payload.matchId) : null;
        const p1 = Number(payload.player1Id);
        const p2 = Number(payload.player2Id);

        if (!tid || !mid || !Number.isFinite(p1) || !Number.isFinite(p2)) return;

        this.activeTournamentId = tid;
        this.activeTournamentFinished = false;
        this.activeTournamentMatch = { matchId: mid, player1Id: p1, player2Id: p2 };

        const stageLabel = payload.stage ? String(payload.stage) : lang('game.match');
        toast(lang('game.tournamentMatchSpectating').replace('{{stage}}', stageLabel));
        syncTournamentControls();
        return;
      }

      if (payload.type === "match/result/pending") {
        toast(lang('game.scoreSentPending'));
        return;
      }

      if (payload.type === "match/result/confirm_request") {
        const mid = payload.matchId ? String(payload.matchId) : null;
        if (!mid) return;

        try {
          const handledKey = `ws:match_confirm:handled:${mid}`;
          const promptingKey = `ws:match_confirm:prompting:${mid}`;

          const handledAt = Number(window.localStorage.getItem(handledKey) || 0);
          if (Number.isFinite(handledAt) && handledAt > 0 && Date.now() - handledAt < 60_000) {
            return;
          }

          const promptingAt = Number(window.localStorage.getItem(promptingKey) || 0);
          if (Number.isFinite(promptingAt) && promptingAt > 0 && Date.now() - promptingAt < 30_000) {
            return;
          }
        } catch {
        }

        const p1s = Number(payload.player1Score);
        const p2s = Number(payload.player2Score);
        if (!Number.isFinite(p1s) || !Number.isFinite(p2s)) return;

        const isHost = this.lobby != null && this.myUserId != null && this.lobby.hostUserId === this.myUserId;
        if (isHost) return;

        const knownMatchId = this.activeOnlineMatchId || (this.lobby?.activeOnlineMatch?.matchId ?? null);
        if (!knownMatchId) {
          this.pendingOnlineResultConfirm = { matchId: mid, player1Score: p1s, player2Score: p2s };
          this.ws.send({ type: "game/lobby/get" });
          toast(lang('game.scoreLobbyFetching'));
          return;
        }

        if (String(knownMatchId) !== String(mid)) return;

        try {
          window.localStorage.setItem(`ws:match_confirm:prompting:${mid}`, String(Date.now()));
        } catch {
        }

        const ok = window.confirm(lang('game.hostScoreConfirm').replace('{{p1}}', String(p1s)).replace('{{p2}}', String(p2s)));

        try {
          window.localStorage.setItem(`ws:match_confirm:handled:${mid}`, String(Date.now()));
          window.localStorage.removeItem(`ws:match_confirm:prompting:${mid}`);
        } catch {
        }

        this.ws.send({ type: "match/result/confirm", matchId: mid, accept: ok });
        toast(ok ? lang('game.scoreApproved') : lang('game.scoreRejected'));
        return;
      }

      if (payload.type === "match/result/confirmed") {
        toast(lang('game.scoreRecorded'));
        try {
          const mid = payload.matchId ? String(payload.matchId) : null;
          const isTournamentMatch = !!payload.tournamentId;

          if (this.activeTournamentMatch && mid && this.activeTournamentMatch.matchId === mid) {
            this.activeTournamentMatch = null;
          }

          if (isTournamentMatch) {
            this.myGameState = "inLobby";
            this.ws.send({ type: "game/state", state: "inLobby" });
            resetPongGame();
          } else {
            this.activeOnlineMatchId = null;
            this.onlineCodes = {};
            this.onlineMatchInProgress = false;
            this.lastAutoSubmittedOnlineScore = null;
            this.onlineReadySent = false;
            this.onlineHostOnly = false;
            this.onlineSpectator = false;
            this.pendingOnlineResultConfirm = null;
            resetPongGame();
            this.ws.send({ type: "game/state", state: "inLobby" });
          }
        } catch {
        }
        void loadMatchHistory();
        syncTournamentControls();
        return;
      }

      if (payload.type === "match/result/rejected") {
        const reason = String(payload.reason || "unknown");
        this.pendingOnlineResultConfirm = null;

        const friendlyReasons: Record<string, string> = {
          timeout: lang('game.rejTimeout'),
          mismatch: lang('game.rejMismatch'),
          rejected_by_opponent: lang('game.rejRejected'),
          persist_failed: lang('game.rejPersistFailed'),
          missing_player1: lang('game.rejMissingPlayer'),
        };

        const friendlyMsg = friendlyReasons[reason] || lang('game.rejGeneric').replace('{{reason}}', reason);
        toast(friendlyMsg);

        if (
          this.activeOnlineMatchId &&
          (reason === "timeout" ||
            reason === "mismatch" ||
            reason === "rejected_by_opponent" ||
            reason === "persist_failed" ||
            reason === "missing_player1")
        ) {
          this.activeOnlineMatchId = null;
          this.onlineCodes = {};
          this.onlineReadySent = false;
          this.onlineMatchInProgress = false;
          this.lastAutoSubmittedOnlineScore = null;
          this.onlineHostOnly = false;
          this.onlineSpectator = false;
          resetPongGame();
          this.ws.send({ type: "game/state", state: "inLobby" });
          syncLobbyButtons();
        }

        if (!this.onlineHostOnly && reason === "mismatch" && this.activeOnlineMatchId && this.lobby && this.myUserId != null) {
          const members = Array.isArray(this.lobby.members) ? this.lobby.members : [];
          if (members.length === 2) {
            const myId = this.myUserId;
            const opponentId = members.find((m) => m.id !== myId)?.id;
            if (opponentId != null) {
              const myCode = this.onlineCodes.myCode || "-";
              const oppCode = this.onlineCodes.opponentCode || "-";
              const defMy = this.lastAutoSubmittedOnlineScore?.myScore ?? 0;
              const defOpp = this.lastAutoSubmittedOnlineScore?.opponentScore ?? 0;
              const myScoreStr = window.prompt(
                lang('game.scoreMismatchFix').replace('{{myCode}}', myCode).replace('{{oppCode}}', oppCode),
                String(defMy),
              );
              if (myScoreStr == null) return;
              const oppScoreStr = window.prompt(lang('game.opponentScore'), String(defOpp));
              if (oppScoreStr == null) return;
              const myScore = Math.max(0, Math.min(50, Number(myScoreStr)));
              const opponentScore = Math.max(0, Math.min(50, Number(oppScoreStr)));
              if (!Number.isInteger(myScore) || !Number.isInteger(opponentScore)) return;
              toast(lang('game.correctedScoreSending'));
              this.ws.send({
                type: "match/result/submit",
                matchId: this.activeOnlineMatchId,
                opponentUserId: opponentId,
                myScore,
                opponentScore,
              });
            }
          }
        }

        if (this.onlineHostOnly && reason === "rejected_by_opponent" && this.lastAutoSubmittedOnlineScore && this.lobby && this.myUserId != null) {
          const retry = window.confirm(
            lang('game.opponentRejectedRetry').replace('{{myScore}}', String(this.lastAutoSubmittedOnlineScore.myScore)).replace('{{oppScore}}', String(this.lastAutoSubmittedOnlineScore.opponentScore))
          );
          if (retry && this.activeOnlineMatchId) {
            const members = Array.isArray(this.lobby.members) ? this.lobby.members : [];
            const myId = this.myUserId;
            const opponentId = members.find((m) => m.id !== myId)?.id;
            if (opponentId != null && members.length === 2) {
              toast(lang('game.scoreResending'));
              this.ws.send({
                type: "match/result/submit",
                matchId: this.activeOnlineMatchId,
                opponentUserId: opponentId,
                myScore: this.lastAutoSubmittedOnlineScore.myScore,
                opponentScore: this.lastAutoSubmittedOnlineScore.opponentScore,
              });
            }
          }
        }
        return;
      }
    });

    this.ws.connect();

    this.incomingInvites.clear();
    this.outgoingInvites.clear();
    this.ws.send({ type: "game/page/enter" });

    const bufferedInvites = this.ws.getPendingInvites();
    for (const [inviteId, inv] of bufferedInvites) {
      if (inv.expiresAt > Date.now()) {
        this.incomingInvites.set(inviteId, {
          inviteId,
          lobbyId: inv.lobbyId,
          fromUserId: inv.fromUserId,
          fromAlias: inv.fromAlias,
          expiresAt: inv.expiresAt,
        });
      }
    }
    renderIncomingInvites();

    if (this.tickTimer) window.clearInterval(this.tickTimer);
    this.tickTimer = window.setInterval(() => {
      renderIncomingInvites();
      renderOutgoingInvites();
      syncTournamentLockButtons();
      syncTournamentControls();
    }, 1000);

    loadMatchHistory();


    startBtn?.addEventListener("click", () => {
      if (this.myGameState === "inGame") return;
      this.ws.send({ type: "game/state", state: "inGame" });
    });
    resetBtn?.addEventListener("click", () => {
      if (this.myGameState === "inGame") return;
      this.ws.send({ type: "game/state", state: "inLobby" });
    });

    this.stop = startPongApp({
      onMatchEnd: ({ tournament, tournamentFinished }) => {
        try {
          const settings = getPongSettings();
          const st = getPongState();

          if (settings.mode !== "AI_AI") {
            const isLobby1v1 = !!this.lobby && Array.isArray(this.lobby.members) && this.lobby.members.length === 2;
            const myId = this.myUserId;
            const opponentId =
              isLobby1v1 && myId != null ? this.lobby!.members.find((m) => m.id !== myId)?.id : undefined;

            const hasOnlineTournamentMatch = !!this.activeTournamentId && !!this.activeTournamentMatch && myId != null;

            if (hasOnlineTournamentMatch) {
              const m = this.activeTournamentMatch!;
              if (myId === m.player1Id) {
                const player1Score = st.scoreL;
                const player2Score = st.scoreR;

                this.ws.send({
                  type: "match/result/submit",
                  tournamentId: this.activeTournamentId,
                  matchId: m.matchId,
                  opponentUserId: m.player2Id,
                  myScore: player1Score,
                  opponentScore: player2Score,
                });

                toast(lang('game.tournamentScoreSent').replace('{{p1}}', String(player1Score)).replace('{{p2}}', String(player2Score)));

                this.activeTournamentMatch = null;
                this.myGameState = "inLobby";
                this.ws.send({ type: "game/state", state: "inLobby" });
              } else {
                toast(lang('game.spectatorScoreByHost'));
              }
              return;
            }

            if (tournament && !hasOnlineTournamentMatch) {
              return;
            }

            if (!tournament && isLobby1v1 && myId != null && opponentId != null) {
              const mid = this.activeOnlineMatchId;
              if (!mid) return;

              const isHost = this.lobby != null && this.myUserId != null && this.lobby.hostUserId === this.myUserId;
              if (!isHost || this.onlineSpectator) {
                toast(lang('game.hostOnlyScoreNote'));
                return;
              }

              const myScore = isHost ? st.scoreL : st.scoreR;
              const opponentScore = isHost ? st.scoreR : st.scoreL;
              this.lastAutoSubmittedOnlineScore = { myScore, opponentScore };
              toast(lang('game.scoreAutoSubmitted'));
              this.ws.send({
                type: "match/result/submit",
                matchId: mid,
                opponentUserId: opponentId,
                myScore,
                opponentScore,
              });
            } else {
              if (isLobby1v1 || this.onlineMatchInProgress || this.activeOnlineMatchId) {
                toast(lang('game.onlineContextUnclear'));
                return;
              }
              const mode = tournament ? "TOURNAMENT" : settings.mode;

              void MatchService.createMatch({
                myScore: 0,
                opponentScore: 0,
                mode,
                opponentLabel:
                  settings.mode === "AI" ? "AI" : tournament ? "Tournament" : settings.mode === "2P" ? "Local" : undefined,
              }).then(() => {
                void loadMatchHistory();
              });
            }
          }
        } catch {
        }

        if (!tournament) {
          this.onlineMatchInProgress = false;
          this.ws.send({ type: "game/state", state: "inLobby" });
          return;
        }

        if (tournamentFinished) {
          if (this.lobby && this.myUserId && this.lobby.hostUserId === this.myUserId) {
            this.ws.send({ type: "game/lobby/close" });
            return;
          }

          this.ws.send({ type: "game/lobby/leave" });
        }
      },
    });
  }

  unmount(): void {
    this.ws.send({ type: "game/page/leave" });

    this.unsubscribeState?.();
    this.unsubscribeState = null;
    this.unsubscribeMessage?.();
    this.unsubscribeMessage = null;

    const banner = document.getElementById("gameLockBanner");
    banner?.remove();

    if (this.tickTimer) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    if (this.stop) {
      this.stop();
      this.stop = null;
    }
  }
}