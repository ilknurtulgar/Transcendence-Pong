import type { GameState, Settings, FakeBall, Obstacle, AIKeys } from "./types";
import { GameStateEnum } from "./types";

const PLAYER_SPEED = 3.5;
const TARGET_FPS = 60;
const FRAME_TIME = 1000 / TARGET_FPS;
export const W = 800;
export const H = 400;
const PADDLE_H = 80;
export const PADDLE_H_EXPORT = PADDLE_H;
export const PADDLE_W = 10;
const BALL_R = 6;
const BALL_SPEED = 2;
const BALL_MAX_SPEED = 7;
const BALL_ACCEL = 1.08;
const BALL_NUDGE_ANGLE = 0.1;

const AI_TICK = 1000;

let gameState: GameStateEnum = GameStateEnum.IDLE;
let aiMode = 1000;
let lastAIDecisionRight = 0;
let lastAIDecisionLeft = 0;
let nextPowerTime: number | null = null;
let lastFrameTime = 0;

let state: GameState = {
  ball: { x: 400, y: 200, vx: 0, vy: 0 },
  ghost: { x: 0, y: 0, vx: 0, vy: 0 },
  left: (H - PADDLE_H) / 2,
  right: (H - PADDLE_H) / 2,
  scoreL: 0,
  scoreR: 0,
  aiTargetRightY: null,
  aiTargetLeftY: null,
  powerBall: { x: 0, y: 0, vx: 0, vy: 0, active: false, spawnTime: 0 },
  fakeBalls: [],
};

let settings: Settings = {
  bg: "#000",
  ball: "#fff",
  paddle: "#fff",
  win: 5,
  mode: "AI",
  map: "classic",
  powerups: false,
};

const aiKeysRight: AIKeys = { up: false, down: false };
const aiKeysLeft: AIKeys = { up: false, down: false };

const keys: { [key: string]: boolean } = {};

let keyHandlersRegistered = false;
const onKeyDown = (e: KeyboardEvent) => {
  keys[e.key] = true;
};
const onKeyUp = (e: KeyboardEvent) => {
  keys[e.key] = false;
};

export function getGameState(): GameStateEnum {
  return gameState;
}

export function setGameState(newState: GameStateEnum) {
  gameState = newState;
}

export function getState() {
  return state;
}

export function getSettings() {
  return settings;
}

export function setSettings(newSettings: Partial<Settings>) {
  settings = { ...settings, ...newSettings };
}

export function getAIMode() {
  return aiMode;
}

export function setAIMode(mode: number) {
  aiMode = mode;
}

export function getKeys() {
  return keys;
}

export function getAIKeysRight() {
  return aiKeysRight;
}

export function getAIKeysLeft() {
  return aiKeysLeft;
}

export function registerKeyHandlers(): () => void {
  if (keyHandlersRegistered) {
    return () => { };
  }
  keyHandlersRegistered = true;

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  return () => {
    if (!keyHandlersRegistered) return;
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    keyHandlersRegistered = false;

    for (const k of Object.keys(keys)) delete keys[k];
  };
}

export function updatePlayerPaddles(deltaMultiplier: number = 1) {
  const speed = PLAYER_SPEED * deltaMultiplier;
  
  if (settings.mode === "AI_AI") {
    if (aiKeysLeft.up) state.left -= speed;
    if (aiKeysLeft.down) state.left += speed;
    if (aiKeysRight.up) state.right -= speed;
    if (aiKeysRight.down) state.right += speed;
  } else {
    if (keys["w"]) state.left -= speed;
    if (keys["s"]) state.left += speed;

    if (settings.mode === "2P") {
      if (keys["ArrowUp"]) state.right -= speed;
      if (keys["ArrowDown"]) state.right += speed;
    } else if (settings.mode === "AI") {
      if (aiKeysRight.up) state.right -= speed;
      if (aiKeysRight.down) state.right += speed;
    }
  }

  state.left = Math.max(0, Math.min(H - PADDLE_H, state.left));
  state.right = Math.max(0, Math.min(H - PADDLE_H, state.right));
}

export function serveBall(loser: "left" | "right") {
  state.ball.x = W / 2;
  state.ball.y = H / 2;
  state.ball.vx = loser === "left" ? BALL_SPEED : -BALL_SPEED;

  const minVy = BALL_SPEED * 0.3;
  state.ball.vy = (Math.random() * 2 - 1) * BALL_SPEED * 0.6;

  if (Math.abs(state.ball.vy) < minVy) {
    state.ball.vy = Math.random() > 0.5 ? minVy : -minVy;
  }

  resetGhost();
}

export function resetGhost() {
  Object.assign(state.ghost, state.ball);
}

export function predictImpactY(side: "left" | "right"): number {
  const b = state.ball;
  if (!b.vx && !b.vy) return b.y;

  let x = b.x;
  let y = b.y;
  let vx = b.vx;
  let vy = b.vy;
  const targetX = side === "left" ? 20 : W - 20;

  for (let i = 0; i < 2000; i++) {
    x += vx;
    y += vy;

    if (y <= BALL_R || y >= H - BALL_R) vy *= -1;

    if (
      (side === "right" && vx > 0 && x >= targetX) ||
      (side === "left" && vx < 0 && x <= targetX)
    ) {
      if (side === "right") {
        state.ghost.x = x;
        state.ghost.y = y;
        state.ghost.vx = vx;
        state.ghost.vy = vy;
      }
      return y;
    }
  }

  return b.y;
}

export function paddleCollision() {
  const b = state.ball;

  if (
    b.vx < 0 &&
    b.x - BALL_R <= 20 &&
    b.y >= state.left &&
    b.y <= state.left + PADDLE_H
  ) {
    b.x = 20 + BALL_R;
    b.vx *= -1;
    speedUpBall();
    nudgeBall();
    resetGhost();
  }

  if (
    b.vx > 0 &&
    b.x + BALL_R >= W - 20 &&
    b.y >= state.right &&
    b.y <= state.right + PADDLE_H
  ) {
    b.x = W - 20 - BALL_R;
    b.vx *= -1;
    speedUpBall();
    nudgeBall();
    resetGhost();
  }

  if (settings.map !== "classic") {
    handleMapObstacles();
  }
}

export function speedUpBall() {
  const b = state.ball;
  const speed = Math.hypot(b.vx, b.vy) * BALL_ACCEL;
  const capped = Math.min(speed, BALL_MAX_SPEED);
  const angle = Math.atan2(b.vy, b.vx);
  b.vx = Math.cos(angle) * capped;
  b.vy = Math.sin(angle) * capped;
}

export function nudgeBall() {
  const b = state.ball;
  const speed = Math.hypot(b.vx, b.vy);
  if (!speed) return;
  const delta = (Math.random() * 2 - 1) * BALL_NUDGE_ANGLE;
  let angle = Math.atan2(b.vy, b.vx) + delta;

  const absAngle = Math.abs(angle % Math.PI);
  const minAngle = 0.15;
  if (absAngle < minAngle) {
    angle = Math.random() > 0.5 ? minAngle : -minAngle;
  } else if (absAngle > Math.PI - minAngle) {
    angle =
      Math.random() > 0.5
        ? Math.PI - minAngle
        : -(Math.PI - minAngle);
  }

  b.vx = Math.cos(angle) * speed;
  b.vy = Math.sin(angle) * speed;
}

export function getCurrentObstacles(): Obstacle[] {
  const list: Obstacle[] = [];

  if (settings.map === "mid_wall") {
    const gap = 120;
    const wallW = 12;
    const gapY1 = (H - gap) / 2;
    const gapY2 = gapY1 + gap;
    list.push({ x: W / 2 - wallW / 2, y: 0, w: wallW, h: gapY1 });
    list.push({ x: W / 2 - wallW / 2, y: gapY2, w: wallW, h: H - gapY2 });
  } else if (settings.map === "gates") {
    const gateW = 10;
    const gateH = 80;
    list.push({ x: 80, y: (H - gateH) / 2, w: gateW, h: gateH });
    list.push({
      x: W - 80 - gateW,
      y: (H - gateH) / 2,
      w: gateW,
      h: gateH,
    });
  } else if (settings.map === "map_42") {
    const thickness = 8;
    const height = PADDLE_H;
    const digitWidth = 40;
    const spacing = 25;
    const baseY = H - height - 10;
    const startX = W / 2 - digitWidth - spacing / 2;

    list.push({ x: startX, y: baseY, w: thickness, h: height });
    list.push({
      x: startX + digitWidth / 2,
      y: baseY,
      w: thickness,
      h: height,
    });
    list.push({
      x: startX,
      y: baseY + height / 2 - thickness / 2,
      w: digitWidth / 2,
      h: thickness,
    });

    const x2 = startX + digitWidth + spacing;
    list.push({ x: x2, y: baseY, w: digitWidth, h: thickness });
    list.push({
      x: x2 + digitWidth - thickness,
      y: baseY,
      w: thickness,
      h: height / 2,
    });
    list.push({
      x: x2,
      y: baseY + height / 2 - thickness / 2,
      w: digitWidth,
      h: thickness,
    });
    list.push({
      x: x2,
      y: baseY + height / 2,
      w: thickness,
      h: height / 2,
    });
    list.push({
      x: x2,
      y: baseY + height - thickness,
      w: digitWidth,
      h: thickness,
    });
  } else if (settings.map === "star") {
    const cx = W / 2;
    const cy = 80;
    const armW = 12;
    const armL = 60;
    list.push({ x: cx - armW / 2, y: cy - armL / 2, w: armW, h: armL });
    list.push({ x: cx - armL / 2, y: cy - armW / 2, w: armL, h: armW });
  }

  return list;
}

export function handleMapObstacles() {
  const b = state.ball;
  const obstacles = getCurrentObstacles();

  for (const o of obstacles) {
    const nearestX = Math.max(o.x, Math.min(b.x, o.x + o.w));
    const nearestY = Math.max(o.y, Math.min(b.y, o.y + o.h));
    const dx = b.x - nearestX;
    const dy = b.y - nearestY;

    if (dx * dx + dy * dy <= BALL_R * BALL_R) {
      const overlapX = Math.min(
        Math.abs(b.x - o.x),
        Math.abs(b.x - (o.x + o.w))
      );
      const overlapY = Math.min(
        Math.abs(b.y - o.y),
        Math.abs(b.y - (o.y + o.h))
      );

      if (overlapX < overlapY) {
        b.vx *= -1;
      } else {
        b.vy *= -1;
      }

      speedUpBall();
      nudgeBall();
      resetGhost();
      break;
    }
  }
}

export function runAISide(side: "left" | "right", now: number) {
  const isRight = side === "right";
  const tick = AI_TICK;

  const paddleY = isRight ? state.right : state.left;
  const center = paddleY + PADDLE_H / 2;
  const aiKeys = isRight ? aiKeysRight : aiKeysLeft;

  const shouldUpdateTarget = isRight
    ? now - lastAIDecisionRight >= tick
    : now - lastAIDecisionLeft >= tick;

  if (shouldUpdateTarget) {
    if (isRight) lastAIDecisionRight = now;
    else lastAIDecisionLeft = now;

    const rawImpactY = predictImpactY(side);

    let errorRange: number;

    if (aiMode === 500) {
      errorRange = 12;
    } else if (aiMode === 1000) {
      errorRange = 30;
    } else {
      errorRange = 50;
    }

    const noise = (Math.random() * 2 - 1) * errorRange;
    const targetY = rawImpactY + noise;

    if (isRight) {
      state.aiTargetRightY = targetY;
    } else {
      state.aiTargetLeftY = targetY;
    }
  }

  const targetY = isRight ? state.aiTargetRightY : state.aiTargetLeftY;
  if (targetY === null) {
    aiKeys.up = aiKeys.down = false;
    return;
  }

  const deadZone = aiMode === 500 ? 5 : aiMode === 1000 ? 10 : 15;
  const delta = targetY - center;

  aiKeys.up = aiKeys.down = false;

  if (delta < -deadZone) {
    aiKeys.up = true;
  } else if (delta > deadZone) {
    aiKeys.down = true;
  }
}

export function update(now: number, handleTournamentMatchEnd?: () => void) {
  if (gameState !== GameStateEnum.PLAYING) return;

  if (!lastFrameTime) lastFrameTime = now;
  const deltaTime = now - lastFrameTime;
  lastFrameTime = now;
  const deltaMultiplier = deltaTime / FRAME_TIME;

  updatePlayerPaddles(deltaMultiplier);

  const b = state.ball;
  b.x += b.vx * deltaMultiplier;
  b.y += b.vy * deltaMultiplier;

  if (b.y <= BALL_R || b.y >= H - BALL_R) {
    b.vy *= -1;
    speedUpBall();

    const minVy = BALL_SPEED * 0.25;
    if (Math.abs(b.vy) < minVy) {
      b.vy = b.vy > 0 ? minVy : -minVy;
    }
  }

  paddleCollision();

  if (settings.mode === "AI") {
    runAISide("right", now);
  } else if (settings.mode === "AI_AI") {
    runAISide("left", now);
    runAISide("right", now);
  }

  if (b.x < 0) {
    state.scoreR++;
    serveBall("left");
  }
  if (b.x > W) {
    state.scoreL++;
    serveBall("right");
  }

  if (settings.win > 0 && (state.scoreL >= settings.win || state.scoreR >= settings.win)) {
    gameState = GameStateEnum.IDLE;
    state.ball.vx = 0;
    state.ball.vy = 0;

    if (handleTournamentMatchEnd) {
      handleTournamentMatchEnd();
    }
  }

  state.left = Math.max(0, Math.min(H - PADDLE_H, state.left));
  updatePowerups(now, deltaMultiplier);
}

export function updatePowerups(now: number, deltaMultiplier: number = 1) {
  if (!settings.powerups) {
    state.powerBall.active = false;
    state.fakeBalls = [];
    nextPowerTime = null;
    return;
  }

  if (nextPowerTime === null && !state.powerBall.active) {
    nextPowerTime = now + 5000 + Math.random() * 5000;
  }

  const pb = state.powerBall;

  if (!pb.active && nextPowerTime !== null && now >= nextPowerTime) {
    spawnPowerBall(now);
  }

  if (pb.active) {
    pb.x += pb.vx * deltaMultiplier;
    pb.y += pb.vy * deltaMultiplier;

    if (pb.y <= BALL_R || pb.y >= H - BALL_R) pb.vy *= -1;
    if (pb.x <= BALL_R || pb.x >= W - BALL_R) pb.vx *= -1;

    if (now - pb.spawnTime > 8000) {
      pb.active = false;
      nextPowerTime = now + 7000 + Math.random() * 5000;
    }

    const hitsLeft =
      pb.x - BALL_R <= 20 &&
      pb.y >= state.left &&
      pb.y <= state.left + PADDLE_H;

    const hitsRight =
      pb.x + BALL_R >= W - 20 &&
      pb.y >= state.right &&
      pb.y <= state.right + PADDLE_H;

    if (hitsLeft || hitsRight) {
      const collector = hitsLeft ? "left" : "right";
      applyPowerupEffect(now, collector);
      pb.active = false;
      nextPowerTime = now + 8000 + Math.random() * 5000;
    }
  }

  const alive: FakeBall[] = [];
  for (const fb of state.fakeBalls) {
    if (now - fb.spawnTime > 5000) continue;
    fb.x += fb.vx * deltaMultiplier;
    fb.y += fb.vy * deltaMultiplier;
    if (fb.y <= BALL_R || fb.y >= H - BALL_R) fb.vy *= -1;
    if (fb.x <= BALL_R || fb.x >= W - BALL_R) fb.vx *= -1;
    alive.push(fb);
  }
  state.fakeBalls = alive;
}

export function spawnPowerBall(now: number) {
  const angle = Math.random() * Math.PI * 2;
  const speed = BALL_SPEED * 1.4;
  const x = W * 0.25 + Math.random() * (W * 0.5);
  const y = H * 0.25 + Math.random() * (H * 0.5);

  state.powerBall.active = true;
  state.powerBall.x = x;
  state.powerBall.y = y;
  state.powerBall.vx = Math.cos(angle) * speed;
  state.powerBall.vy = Math.sin(angle) * speed;
  state.powerBall.spawnTime = now;
}

export function applyPowerupEffect(now: number, collector: "left" | "right") {
  pushBallAwayFrom(collector);
  if (Math.random() < 0.5) {
    boostMainBall(collector);
  } else {
    createFakeBalls(now, collector);
  }
}

export function boostMainBall(collector: "left" | "right") {
  const b = state.ball;
  const dir = collector === "left" ? 1 : -1;
  let angle = Math.atan2(b.vy, b.vx);

  if (!b.vx && !b.vy) {
    angle = (dir === 1 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.3;
  }

  const boosted = BALL_MAX_SPEED;
  b.vx = Math.cos(angle) * boosted;
  b.vy = Math.sin(angle) * boosted;

  if (b.vx * dir < 0) {
    b.vx = -b.vx;
  }

  resetGhost();
}

export function createFakeBalls(now: number, collector: "left" | "right") {
  const b = state.ball;
  const dir = collector === "left" ? 1 : -1;
  const baseSpeed = Math.hypot(b.vx, b.vy) || BALL_SPEED * 1.3;
  const baseAngle = dir === 1 ? 0 : Math.PI;
  const spread = 0.35;

  state.fakeBalls = [];
  for (const off of [-spread, spread]) {
    const a = baseAngle + off;
    state.fakeBalls.push({
      x: b.x,
      y: b.y,
      vx: Math.cos(a) * baseSpeed,
      vy: Math.sin(a) * baseSpeed,
      spawnTime: now,
    });
  }
}

export function pushBallAwayFrom(side: "left" | "right") {
  const b = state.ball;
  const dir = side === "left" ? 1 : -1;
  const speed = Math.max(Math.hypot(b.vx, b.vy), BALL_SPEED * 1.1);
  const baseAngle = dir === 1 ? 0 : Math.PI;
  const jitter = (Math.random() - 0.5) * 0.6;
  const angle = baseAngle + jitter;

  b.vx = Math.cos(angle) * speed;
  b.vy = Math.sin(angle) * speed;

  resetGhost();
}

export function resetGame() {
  gameState = GameStateEnum.IDLE;
  state.scoreL = state.scoreR = 0;
  state.ball.x = W / 2;
  state.ball.y = H / 2;
  state.ball.vx = state.ball.vy = 0;
  state.left = state.right = (H - PADDLE_H) / 2;
  lastAIDecisionRight = 0;
  lastAIDecisionLeft = 0;
  lastFrameTime = 0;
  aiKeysRight.up = aiKeysRight.down = false;
  aiKeysLeft.up = aiKeysLeft.down = false;
  state.aiTargetRightY = null;
  state.aiTargetLeftY = null;
  state.powerBall.active = false;
  state.fakeBalls = [];
  nextPowerTime = null;
}

export function startGameEngine() {
  if (gameState === GameStateEnum.PLAYING) return;
  serveBall(Math.random() > 0.5 ? "left" : "right");
  gameState = GameStateEnum.PLAYING;
}

export function resetGameEngine() {
  resetGame();
}