export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface PowerBall extends Ball {
  active: boolean;
  spawnTime: number;
}

export interface FakeBall extends Ball {
  spawnTime: number;
}

export interface GameState {
  ball: Ball;
  ghost: Ball;
  left: number;
  right: number;
  scoreL: number;
  scoreR: number;
  aiTargetRightY: number | null;
  aiTargetLeftY: number | null;
  powerBall: PowerBall;
  fakeBalls: FakeBall[];
}

export interface Settings {
  bg: string;
  ball: string;
  paddle: string;
  win: number;
  mode: "AI" | "2P" | "AI_AI";
  map: "classic" | "mid_wall" | "gates" | "map_42" | "star";
  powerups: boolean;
}

export interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AIKeys {
  up: boolean;
  down: boolean;
}

export interface TournamentPlayer {
  name: string;
  type: "human" | "ai";
}

export interface TournamentMatch {
  player1: TournamentPlayer | null;
  player2: TournamentPlayer | null;
  score1: number;
  score2: number;
  winner: TournamentPlayer | null;
  completed: boolean;
}

export interface Tournament {
  players: TournamentPlayer[];
  matches: TournamentMatch[];
  rounds: TournamentMatch[][];
  currentMatchIndex: number;
}

export const GameStateEnum = {
  IDLE: 0,
  PLAYING: 1,
} as const;

export type GameStateEnum = (typeof GameStateEnum)[keyof typeof GameStateEnum];
