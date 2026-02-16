import type { Settings } from "./types";
import { startGameEngine, resetGameEngine, getState } from "./game";

const VERSION = "v1.2";

export let settings: Settings = {
  bg: "#000",
  ball: "#fff",
  paddle: "#fff",
  win: 5,
  mode: "AI",
  map: "classic",
  powerups: false,
};

export let aiMode = 1000;

export function initUI(): void {
  const versionLabel = document.getElementById("versionLabel");
  if (versionLabel) {
    versionLabel.textContent = "Version " + VERSION;
  }

  const startBtn = document.getElementById("startBtn");
  if (startBtn) {
    startBtn.addEventListener("click", startGame);
  }

  const resetBtn = document.getElementById("resetBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", resetGame);
  }

  const customizeBtn = document.getElementById("customizeBtn");
  if (customizeBtn) {
    customizeBtn.addEventListener("click", toggleCustomize);
  }

  const exitCustomizeBtn = document.getElementById("exitCustomizeBtn");
  if (exitCustomizeBtn) {
    exitCustomizeBtn.addEventListener("click", exitCustomize);
  }

  const bgColor = document.getElementById("bgColor") as HTMLInputElement;
  const ballColor = document.getElementById("ballColor") as HTMLInputElement;
  const paddleColor = document.getElementById("paddleColor") as HTMLInputElement;
  const winScore = document.getElementById("winScore") as HTMLSelectElement;
  const gameMode = document.getElementById("gameMode") as HTMLSelectElement;
  const mapSelect = document.getElementById("mapSelect") as HTMLSelectElement;
  const aiModeSelect = document.getElementById("aiMode") as HTMLSelectElement;
  const powerups = document.getElementById("powerups") as HTMLSelectElement;

  if (bgColor) bgColor.addEventListener("input", applySettings);
  if (ballColor) ballColor.addEventListener("input", applySettings);
  if (paddleColor) paddleColor.addEventListener("input", applySettings);
  if (winScore) winScore.addEventListener("change", applySettings);
  if (gameMode) gameMode.addEventListener("change", applySettings);
  if (mapSelect) mapSelect.addEventListener("change", applySettings);
  if (aiModeSelect) aiModeSelect.addEventListener("change", applySettings);
  if (powerups) powerups.addEventListener("change", applySettings);
}

export function applySettings(): void {
  const bgColor = document.getElementById("bgColor") as HTMLInputElement;
  const ballColor = document.getElementById("ballColor") as HTMLInputElement;
  const paddleColor = document.getElementById("paddleColor") as HTMLInputElement;
  const winScore = document.getElementById("winScore") as HTMLSelectElement;
  const gameMode = document.getElementById("gameMode") as HTMLSelectElement;
  const mapSelect = document.getElementById("mapSelect") as HTMLSelectElement;
  const aiModeSelect = document.getElementById("aiMode") as HTMLSelectElement;
  const powerupsSelect = document.getElementById("powerups") as HTMLSelectElement;

  if (bgColor) settings.bg = bgColor.value;
  if (ballColor) settings.ball = ballColor.value;
  if (paddleColor) settings.paddle = paddleColor.value;
  if (winScore) settings.win = +winScore.value;
  if (gameMode) settings.mode = gameMode.value as "AI" | "2P" | "AI_AI";
  if (mapSelect) settings.map = mapSelect.value as typeof settings.map;
  if (powerupsSelect) settings.powerups = powerupsSelect.value === "on";
  if (aiModeSelect) aiMode = +aiModeSelect.value;
}

export function toggleCustomize(): void {
  const customPanel = document.getElementById("customPanel");
  if (!customPanel) return;

  customPanel.style.display =
    customPanel.style.display === "none" ? "block" : "none";
}

export function exitCustomize(): void {
  applySettings();
  toggleCustomize();
}

export function startGame(): void {
  const state = getState();
  if (settings.win > 0 && (state.scoreL >= settings.win || state.scoreR >= settings.win)) {
    resetGame();
  }

  applySettings();
  startGameEngine();
}

export function resetGame(): void {
  applySettings();
  resetGameEngine();
}

export function resetCustomizeToDefaults(): void {
  const gameMode = document.getElementById("gameMode") as HTMLSelectElement;
  const bgColor = document.getElementById("bgColor") as HTMLInputElement;
  const ballColor = document.getElementById("ballColor") as HTMLInputElement;
  const paddleColor = document.getElementById("paddleColor") as HTMLInputElement;
  const mapSelect = document.getElementById("mapSelect") as HTMLSelectElement;
  const winScore = document.getElementById("winScore") as HTMLSelectElement;
  const aiModeSelect = document.getElementById("aiMode") as HTMLSelectElement;
  const powerupsSelect = document.getElementById("powerups") as HTMLSelectElement;

  if (gameMode) gameMode.value = "AI";
  if (bgColor) bgColor.value = "#000000";
  if (ballColor) ballColor.value = "#ffffff";
  if (paddleColor) paddleColor.value = "#ffffff";
  if (mapSelect) mapSelect.value = "classic";
  if (winScore) winScore.value = "5";
  if (aiModeSelect) aiModeSelect.value = "1000";
  if (powerupsSelect) powerupsSelect.value = "off";

  settings.bg = "#000";
  settings.ball = "#fff";
  settings.paddle = "#fff";
  settings.win = 5;
  settings.mode = "AI";
  settings.map = "classic";
  settings.powerups = false;
  aiMode = 1000;
}

export function getSettings(): Settings {
  return settings;
}

export function getAIMode(): number {
  return aiMode;
}

export function setAIMode(mode: number): void {
  aiMode = mode;
}
