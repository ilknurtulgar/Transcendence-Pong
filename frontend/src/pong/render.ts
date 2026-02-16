import { lang } from "../i18n/lang";
import {
  getState,
  getSettings,
  getGameState,
  W,
  H,
  getCurrentObstacles,
  PADDLE_W,
} from "./game";
import { GameStateEnum } from "./types";

const BALL_R = 6;
const PADDLE_H = 80;

let ctx: CanvasRenderingContext2D;

export function initRenderer(): void {
  const canvas = document.getElementById("c") as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error("Canvas #c not found");
  }

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not get canvas context");
  }
  ctx = context;
}

export function draw(): void {
  const settings = getSettings();
  const state = getState();
  const gameState = getGameState();

  ctx.fillStyle = settings.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#666";
  const dashHeight = 15;
  const dashGap = 10;
  for (let y = 0; y < H; y += dashHeight + dashGap) {
    ctx.fillRect(W / 2 - 2, y, 4, dashHeight);
  }

  if (settings.map !== "classic") {
    ctx.fillStyle = "#444";
    if (settings.map === "star") {
      drawStarDecoration();
    } else {
      const obstacles = getCurrentObstacles();
      for (const o of obstacles) {
        ctx.fillRect(o.x, o.y, o.w, o.h);
      }
    }
  }

  ctx.fillStyle = settings.paddle;
  ctx.fillRect(10, state.left, PADDLE_W, PADDLE_H);
  ctx.fillRect(W - 20, state.right, PADDLE_W, PADDLE_H);

  ctx.fillStyle = settings.ball;
  ctx.fillRect(
    state.ball.x - BALL_R,
    state.ball.y - BALL_R,
    BALL_R * 2,
    BALL_R * 2
  );

  ctx.fillStyle = settings.ball;
  for (const fb of state.fakeBalls) {
    ctx.fillRect(fb.x - BALL_R, fb.y - BALL_R, BALL_R * 2, BALL_R * 2);
  }

  if (state.powerBall.active) {
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(
      state.powerBall.x - BALL_R,
      state.powerBall.y - BALL_R,
      BALL_R * 2,
      BALL_R * 2
    );
  }

  ctx.fillStyle = "#fff";
  ctx.font = "40px monospace";
  ctx.textAlign = "center";
  ctx.fillText(`${state.scoreL}`, W / 4, 50);
  ctx.fillText(`${state.scoreR}`, (W * 3) / 4, 50);
  ctx.font = "10px monospace";

  if (gameState === GameStateEnum.IDLE) {
    ctx.fillText(lang('game.start'), 400, 150);
  }
}

function drawStarDecoration(): void {
  const cx = W / 2;
  const cy = 80;
  const outerR = 40;
  const innerR = 20;

  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}
