import { resetCustomizeToDefaults, getSettings, setAIMode } from "./ui";
import { startGameEngine, resetGameEngine, getState, serveBall } from "./game";
import { lang } from "../i18n/lang";

interface Player {
  name: string;
  type: "human" | "ai";
}

interface Match {
  player1: Player | null;
  player2: Player | null;
  score1: number;
  score2: number;
  winner: Player | null;
  completed: boolean;
  player1OnLeft?: boolean;
}

interface Tournament {
  players: Player[];
  rounds: Match[][];
  matches: Match[];
  currentMatchIndex: number;
}

let tournamentMode = false;
let matchInProgress = false;
let tournamentFinished = false;
let tournament: Tournament = {
  players: [],
  rounds: [],
  matches: [],
  currentMatchIndex: 0,
};

type TournamentExternalHandlers = {
  onStartRequested?: () => void;
  onMatchRequested?: () => void;
  onPlayRequested?: () => void;
  onExitRequested?: () => void;
};

let externalHandlers: TournamentExternalHandlers = {};

export function setTournamentExternalHandlers(handlers: TournamentExternalHandlers): void {
  externalHandlers = handlers || {};
}

export function initTournament(): void {
  const tournamentBtn = document.getElementById("tournamentBtn");
  if (tournamentBtn) tournamentBtn.addEventListener("click", showTournamentSetup);

  const playerCountEl = document.getElementById("playerCount") as HTMLSelectElement | null;
  if (playerCountEl) playerCountEl.addEventListener("change", updatePlayerInputs);

  const tournamentPanel = document.getElementById("tournamentPanel");
  if (tournamentPanel) {
    tournamentPanel.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName !== "BUTTON") return;

      const id = target.id;
      if (id === "tournamentStartBtn") {
        if (externalHandlers.onStartRequested) {
          externalHandlers.onStartRequested();
        } else {
          startTournament();
        }
        return;
      }
      if (id === "tournamentCancelBtn") {
        externalHandlers.onExitRequested?.();
        exitTournament(true);
        return;
      }
      if (id === "tournamentMatchBtn") {
        if (externalHandlers.onMatchRequested) {
          externalHandlers.onMatchRequested();
        } else {
          playCurrentMatch();
        }
        return;
      }
      if (id === "tournamentPlayBtn") {
        if (externalHandlers.onPlayRequested) {
          externalHandlers.onPlayRequested();
        } else {
          playCurrentMatch();
        }
        return;
      }
      if (id === "tournamentCloseBtn" || id === "tournamentChampionCloseBtn") {
        externalHandlers.onExitRequested?.();
        exitTournament(true);
        return;
      }
    });
  }
}

export function isTournamentMode(): boolean {
  return tournamentMode;
}

export function isTournamentFinished(): boolean {
  return tournamentFinished;
}

export function isTournamentMatchInProgress(): boolean {
  return matchInProgress;
}

function setTournamentButtonState() {
  const startBtn = document.getElementById("tournamentStartBtn") as HTMLButtonElement | null;
  const cancelBtn = document.getElementById("tournamentCancelBtn") as HTMLButtonElement | null;
  const playBtn = document.getElementById("tournamentPlayBtn") as HTMLButtonElement | null;
  const closeBtn = document.getElementById("tournamentCloseBtn") as HTMLButtonElement | null;
  const championCloseBtn = document.getElementById("tournamentChampionCloseBtn") as HTMLButtonElement | null;

  const running = tournamentMode && !tournamentFinished;

  if (startBtn) startBtn.disabled = running;
  if (cancelBtn) cancelBtn.disabled = running;
  if (closeBtn) closeBtn.disabled = false;

  if (playBtn) {
    playBtn.disabled = matchInProgress || tournamentFinished;
  }

  if (championCloseBtn) {
    championCloseBtn.disabled = !tournamentFinished;
  }
}

function lockTournamentViewToBracket() {
  const setup = document.getElementById("tournamentSetupSection");
  const setupButtons = document.getElementById("tournamentSetupButtons");
  const bracketView = document.getElementById("bracketView");
  const championView = document.getElementById("championView");

  if (setup) setup.style.display = "none";
  if (setupButtons) setupButtons.style.display = "none";
  if (bracketView) bracketView.style.display = "block";
  if (championView && !tournamentFinished) championView.style.display = "none";

  setTournamentButtonState();
}

export function showTournamentSetup(): void {
  const tournamentPanel = document.getElementById("tournamentPanel");
  if (!tournamentPanel) return;

  tournamentPanel.style.display = "block";

  const bracketView = document.getElementById("bracketView");
  const championView = document.getElementById("championView");
  const customPanel = document.getElementById("customPanel");

  if (bracketView) bracketView.style.display = "none";
  if (championView) championView.style.display = "none";
  if (customPanel) customPanel.style.display = "none";

  const customizeBtn = document.getElementById("customizeBtn") as HTMLButtonElement | null;
  const startBtn = document.getElementById("startBtn") as HTMLButtonElement | null;
  const resetBtn = document.getElementById("resetBtn") as HTMLButtonElement | null;

  if (customizeBtn) customizeBtn.disabled = true;
  if (startBtn) startBtn.disabled = true;
  if (resetBtn) resetBtn.disabled = true;

  if (tournamentMode) {
    lockTournamentViewToBracket();
    if (tournamentFinished) {
      if (championView) championView.style.display = "block";
      if (bracketView) bracketView.style.display = "none";
    }
    return;
  }

  const setup = document.getElementById("tournamentSetupSection");
  const setupButtons = document.getElementById("tournamentSetupButtons");
  if (setup) setup.style.display = "block";
  if (setupButtons) setupButtons.style.display = "flex";

  updatePlayerInputs();
  setTournamentButtonState();
}

export function updatePlayerInputs(): void {
  const playerCountEl = document.getElementById("playerCount") as HTMLSelectElement | null;
  const container = document.getElementById("playerInputs");
  if (!playerCountEl || !container) return;

  const count = parseInt(playerCountEl.value);
  container.innerHTML = "";

  for (let i = 1; i <= count; i++) {
    const div = document.createElement("div");
    div.className = "player-input";
    div.appendChild(document.createTextNode(`${lang('game.player')} ${i}: `));

    const input = document.createElement("input");
    input.type = "text";
    input.id = `p${i}`;
    input.value = `${lang('game.player')} ${i}`;
    input.maxLength = 15;

    const select = document.createElement("select");
    select.id = `pType${i}`;

    const optHuman = document.createElement("option");
    optHuman.value = "human";
    optHuman.textContent = lang('game.human');

    const optAi = document.createElement("option");
    optAi.value = "ai";
    optAi.textContent = lang('game.ai');

    select.appendChild(optHuman);
    select.appendChild(optAi);

    div.appendChild(input);
    div.appendChild(select);
    container.appendChild(div);
  }
}

export function exitTournament(force = false): void {
  if (tournamentMode && !tournamentFinished && !force) {
    setTournamentButtonState();
    return;
  }

  if (tournamentMode && !tournamentFinished && force) {
    const ok = confirm(lang('game.tournamentExitConfirm'));
    if (!ok) {
      setTournamentButtonState();
      return;
    }
  }

  if (matchInProgress) {
    resetGameEngine();
    matchInProgress = false;
  }

  const tournamentPanel = document.getElementById("tournamentPanel");
  if (tournamentPanel) tournamentPanel.style.display = "none";

  tournamentMode = false;
  matchInProgress = false;
  tournamentFinished = false;
  tournament = {
    players: [],
    rounds: [],
    matches: [],
    currentMatchIndex: 0,
  };

  const customizeBtn = document.getElementById("customizeBtn") as HTMLButtonElement | null;
  const startBtn = document.getElementById("startBtn") as HTMLButtonElement | null;
  const resetBtn = document.getElementById("resetBtn") as HTMLButtonElement | null;

  if (customizeBtn) customizeBtn.disabled = false;
  if (startBtn) startBtn.disabled = false;
  if (resetBtn) resetBtn.disabled = false;

  const setup = document.getElementById("tournamentSetupSection");
  const setupButtons = document.getElementById("tournamentSetupButtons");
  const bracketView = document.getElementById("bracketView");
  const championView = document.getElementById("championView");
  if (setup) setup.style.display = "block";
  if (setupButtons) setupButtons.style.display = "flex";
  if (bracketView) bracketView.style.display = "none";
  if (championView) championView.style.display = "none";
}

function nextPow2(n: number): number {
  let x = 1;
  while (x < n) x *= 2;
  return x;
}

function flattenRounds(rounds: Match[][]): Match[] {
  const out: Match[] = [];
  for (const r of rounds) out.push(...r);
  return out;
}

function assignWinnerToNext(roundIndex: number, matchIndexInRound: number, winner: Player): void {
  if (roundIndex >= tournament.rounds.length - 1) return;
  const nextRound = tournament.rounds[roundIndex + 1];
  const nextMatchIndex = Math.floor(matchIndexInRound / 2);
  const nextMatch = nextRound[nextMatchIndex];
  if (!nextMatch) return;

  if (matchIndexInRound % 2 === 0) nextMatch.player1 = winner;
  else nextMatch.player2 = winner;
}

function propagateWalkovers(): void {
  const maxIterations = tournament.rounds.length * 6 + 8;
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    for (let r = 0; r < tournament.rounds.length; r++) {
      const round = tournament.rounds[r];
      const prevRound = r > 0 ? tournament.rounds[r - 1] : null;

      for (let m = 0; m < round.length; m++) {
        const match = round[m];

        const slot1Ready = r === 0 ? true : !!prevRound && !!prevRound[m * 2]?.completed;
        const slot2Ready = r === 0 ? true : !!prevRound && !!prevRound[m * 2 + 1]?.completed;

        if (!match.completed && slot1Ready && slot2Ready) {
          if (match.player1 && !match.player2) {
            match.winner = match.player1;
            match.completed = true;
            changed = true;
          } else if (!match.player1 && match.player2) {
            match.winner = match.player2;
            match.completed = true;
            changed = true;
          } else if (!match.player1 && !match.player2) {
            match.winner = null;
            match.completed = true;
            changed = true;
          }
        }

        if (match.completed && match.winner) {
          const before =
            r < tournament.rounds.length - 1
              ? {
                p1: tournament.rounds[r + 1][Math.floor(m / 2)]?.player1 ?? null,
                p2: tournament.rounds[r + 1][Math.floor(m / 2)]?.player2 ?? null,
              }
              : null;

          assignWinnerToNext(r, m, match.winner);

          const after =
            r < tournament.rounds.length - 1
              ? {
                p1: tournament.rounds[r + 1][Math.floor(m / 2)]?.player1 ?? null,
                p2: tournament.rounds[r + 1][Math.floor(m / 2)]?.player2 ?? null,
              }
              : null;

          if (before && after && (before.p1 !== after.p1 || before.p2 !== after.p2)) {
            changed = true;
          }
        }
      }
    }

    if (!changed) break;
  }
}

export function withdrawTournamentPlayerByName(name: string): void {
  if (!tournamentMode || tournamentFinished) return;
  const n = String(name || "").trim();
  if (!n) return;

  let touched = false;
  for (const match of tournament.matches) {
    if (match.completed) continue;
    if (match.player1?.name === n) {
      match.player1 = null;
      touched = true;
    }
    if (match.player2?.name === n) {
      match.player2 = null;
      touched = true;
    }
  }

  if (!touched) return;

  propagateWalkovers();
  tournament.currentMatchIndex = findNextPlayableMatchIndex(0);
  renderBracket();
  setTournamentButtonState();

  if (tournament.currentMatchIndex >= tournament.matches.length) showChampion();
}

function findNextPlayableMatchIndex(startIndex: number): number {
  for (let i = startIndex; i < tournament.matches.length; i++) {
    const m = tournament.matches[i];
    if (!m.completed && m.player1 && m.player2) return i;
  }
  return tournament.matches.length;
}

export function startTournament(): void {
  if (tournamentMode && !tournamentFinished) {
    lockTournamentViewToBracket();
    return;
  }

  const playerCountEl = document.getElementById("playerCount") as HTMLSelectElement | null;
  if (!playerCountEl) return;

  const count = parseInt(playerCountEl.value);
  if (!Number.isFinite(count) || count < 4 || count % 4 !== 0) {
    alert(lang('game.tournamentNeed4'));
    return;
  }

  tournament.players = [];
  for (let i = 1; i <= count; i++) {
    const nameInput = document.getElementById(`p${i}`) as HTMLInputElement | null;
    const typeInput = document.getElementById(`pType${i}`) as HTMLSelectElement | null;
    const name = nameInput?.value || `Player ${i}`;
    const type = (typeInput?.value as "human" | "ai") || "human";
    tournament.players.push({ name, type });
  }

  resetCustomizeToDefaults();

  const bracketSize = nextPow2(count);
  const seeded: Array<Player | null> = [...tournament.players];
  while (seeded.length < bracketSize) seeded.push(null);

  const rounds: Match[][] = [];

  const firstRound: Match[] = [];
  for (let i = 0; i < bracketSize; i += 2) {
    firstRound.push({
      player1: seeded[i],
      player2: seeded[i + 1],
      score1: 0,
      score2: 0,
      winner: null,
      completed: false,
    });
  }
  rounds.push(firstRound);

  let roundSize = bracketSize / 2;
  while (roundSize > 1) {
    const matches: Match[] = [];
    for (let i = 0; i < roundSize / 2; i++) {
      matches.push({
        player1: null,
        player2: null,
        score1: 0,
        score2: 0,
        winner: null,
        completed: false,
      });
    }
    rounds.push(matches);
    roundSize /= 2;
  }

  tournament.rounds = rounds;
  tournament.matches = flattenRounds(rounds);
  tournament.currentMatchIndex = 0;
  tournamentMode = true;
  matchInProgress = false;
  tournamentFinished = false;

  propagateWalkovers();
  tournament.currentMatchIndex = findNextPlayableMatchIndex(0);

  const customizeBtn = document.getElementById("customizeBtn") as HTMLButtonElement | null;
  const startBtn = document.getElementById("startBtn") as HTMLButtonElement | null;
  const resetBtn = document.getElementById("resetBtn") as HTMLButtonElement | null;

  if (customizeBtn) customizeBtn.disabled = true;
  if (startBtn) startBtn.disabled = true;
  if (resetBtn) resetBtn.disabled = true;

  lockTournamentViewToBracket();
  renderBracket();

  if (tournament.currentMatchIndex >= tournament.matches.length) showChampion();
}

export function renderBracket(): void {
  const bracket = document.getElementById("bracket");
  if (!bracket) return;
  bracket.innerHTML = "";

  const roundNames = [lang('game.roundFirst'), lang('game.roundQuarter'), lang('game.roundSemi'), lang('game.roundFinal')];
  for (let r = 0; r < tournament.rounds.length; r++) {
    const roundDiv = document.createElement("div");
    roundDiv.className = "round";
    const roundName =
      roundNames[Math.max(0, roundNames.length - tournament.rounds.length + r)];
    const title = document.createElement("h4");
    title.textContent = roundName;
    roundDiv.appendChild(title);

    for (let m = 0; m < tournament.rounds[r].length; m++) {
      const match = tournament.rounds[r][m];
      const globalIndex = tournament.matches.indexOf(match);
      roundDiv.appendChild(createMatchElement(match, globalIndex));
    }

    bracket.appendChild(roundDiv);
  }
}

function createMatchElement(match: Match, globalIndex: number): HTMLElement {
  const matchDiv = document.createElement("div");
  matchDiv.className = "match";

  if (globalIndex === tournament.currentMatchIndex) matchDiv.classList.add("active");
  if (match.completed) matchDiv.classList.add("completed");

  const player1Name = match.player1 ? match.player1.name : "TBD";
  const player2Name = match.player2 ? match.player2.name : "TBD";

  const player1 = document.createElement("div");
  player1.className = `player-slot ${match.winner === match.player1 ? "winner" : ""}`;
  const player1NameEl = document.createElement("span");
  player1NameEl.textContent = player1Name;
  const player1ScoreEl = document.createElement("span");
  player1ScoreEl.textContent = String(match.score1);
  player1.appendChild(player1NameEl);
  player1.appendChild(player1ScoreEl);

  const player2 = document.createElement("div");
  player2.className = `player-slot ${match.winner === match.player2 ? "winner" : ""}`;
  const player2NameEl = document.createElement("span");
  player2NameEl.textContent = player2Name;
  const player2ScoreEl = document.createElement("span");
  player2ScoreEl.textContent = String(match.score2);
  player2.appendChild(player2NameEl);
  player2.appendChild(player2ScoreEl);

  matchDiv.appendChild(player1);
  matchDiv.appendChild(player2);
  return matchDiv;
}

export function getCurrentTournamentMatch(): {
  index: number;
  player1: Player;
  player2: Player;
} | null {
  if (!tournamentMode) return null;
  const match = tournament.matches[tournament.currentMatchIndex];
  if (!match || !match.player1 || !match.player2) return null;
  return {
    index: tournament.currentMatchIndex,
    player1: match.player1,
    player2: match.player2,
  };
}

export function playCurrentMatch(): void {
  if (!tournamentMode || tournamentFinished) return;
  if (matchInProgress) return;

  const match = tournament.matches[tournament.currentMatchIndex];
  if (!match) {
    alert(lang('game.matchNotFound'));
    return;
  }
  if (!match.player1 || !match.player2) {
    alert(lang('game.playersNotYetDetermined'));
    return;
  }
  if (match.completed) {
    alert(lang('game.matchAlreadyCompleted'));
    return;
  }

  const currentSettings = getSettings();
  currentSettings.win = 5;

  const tournamentMap = document.getElementById("tournamentMap") as HTMLSelectElement | null;
  const tournamentPowerups = document.getElementById(
    "tournamentPowerups",
  ) as HTMLSelectElement | null;
  const tournamentAI = document.getElementById("tournamentAI") as HTMLSelectElement | null;

  if (tournamentMap) currentSettings.map = tournamentMap.value as typeof currentSettings.map;
  if (tournamentPowerups) currentSettings.powerups = tournamentPowerups.value === "on";
  currentSettings.bg = "#000";
  currentSettings.ball = "#fff";
  currentSettings.paddle = "#fff";
  if (tournamentAI) setAIMode(parseInt(tournamentAI.value));

  const p1Type = match.player1.type;
  const p2Type = match.player2.type;

  if (p1Type === "ai" && p2Type === "ai") {
    currentSettings.mode = "AI_AI";
    match.player1OnLeft = true;
  } else if (p1Type === "human" && p2Type === "human") {
    currentSettings.mode = "2P";
    match.player1OnLeft = true;
  } else {
    currentSettings.mode = "AI";
    match.player1OnLeft = p1Type === "human";
  }

  resetGameEngine();

  lockTournamentViewToBracket();

  matchInProgress = true;
  setTournamentButtonState();

  serveBall(Math.random() > 0.5 ? "left" : "right");
  startGameEngine();
}

export function handleTournamentMatchEnd(): void {
  if (!tournamentMode) return;

  matchInProgress = false;
  setTournamentButtonState();

  const match = tournament.matches[tournament.currentMatchIndex];
  if (!match || match.completed) return;

  const state = getState();

  const winScore = Math.max(1, Number(getSettings().win) || 5);
  const clampScore = (n: number) => {
    if (!Number.isFinite(n)) return 0;
    const x = Math.trunc(n);
    return Math.max(0, Math.min(winScore, x));
  };

  const scoreL = clampScore(state.scoreL);
  const scoreR = clampScore(state.scoreR);

  const player1OnLeft = match.player1OnLeft !== false;
  const p1Score = player1OnLeft ? scoreL : scoreR;
  const p2Score = player1OnLeft ? scoreR : scoreL;

  match.score1 = p1Score;
  match.score2 = p2Score;

  if (p1Score === p2Score) {
    match.winner = null;
    match.completed = false;
    alert(lang('game.matchDrawRetry'));
    return;
  }

  match.winner = p1Score > p2Score ? match.player1 : match.player2;
  match.completed = true;

  const roundIndex = tournament.rounds.findIndex((round) => round.includes(match));
  if (roundIndex >= 0) {
    const matchIndexInRound = tournament.rounds[roundIndex].indexOf(match);
    if (matchIndexInRound >= 0 && match.winner) {
      assignWinnerToNext(roundIndex, matchIndexInRound, match.winner);
    }
  }
  tournament.currentMatchIndex = findNextPlayableMatchIndex(tournament.currentMatchIndex + 1);

  propagateWalkovers();
  tournament.currentMatchIndex = findNextPlayableMatchIndex(0);

  setTimeout(() => {
    if (tournament.currentMatchIndex >= tournament.matches.length) {
      showChampion();
    } else {
      const tournamentPanel = document.getElementById("tournamentPanel");
      const bracketView = document.getElementById("bracketView");
      const championView = document.getElementById("championView");

      if (tournamentPanel) tournamentPanel.style.display = "block";
      if (bracketView) bracketView.style.display = "block";
      if (championView) championView.style.display = "none";

      renderBracket();
      setTournamentButtonState();
    }
  }, 2000);
}

function showChampion(): void {
  tournamentFinished = true;
  matchInProgress = false;
  setTournamentButtonState();

  const finalRound = tournament.rounds[tournament.rounds.length - 1];
  const finalMatch = finalRound && finalRound[0];
  const champion = finalMatch ? finalMatch.winner : null;

  const championName = document.getElementById("championName");
  if (championName && champion) championName.textContent = champion.name;

  const tournamentPanel = document.getElementById("tournamentPanel");
  const bracketView = document.getElementById("bracketView");
  const championView = document.getElementById("championView");

  if (tournamentPanel) tournamentPanel.style.display = "block";
  if (bracketView) bracketView.style.display = "none";
  if (championView) championView.style.display = "block";
}
