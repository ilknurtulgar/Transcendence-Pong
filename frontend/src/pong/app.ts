import { registerKeyHandlers, update, setSettings, setAIMode, resetGameEngine } from "./game";
import { initUI, getSettings, getAIMode } from "./ui";
import {
  initTournament,
  handleTournamentMatchEnd,
  isTournamentMode,
  isTournamentFinished,
} from "./tournament";
import { initRenderer, draw } from "./render";

type PongAppOptions = {
  onMatchEnd?: (info: { tournament: boolean; tournamentFinished: boolean }) => void;
};

export function startPongApp(options?: PongAppOptions): () => void {
  const unregisterKeys = registerKeyHandlers();

  initRenderer();
  initUI();
  initTournament();

  resetGameEngine();

  let rafId: number | null = null;
  let stopped = false;

  const loop = (t: number) => {
    if (stopped) return;

    const uiSettings = getSettings();
    const uiAIMode = getAIMode();
    setSettings(uiSettings);
    setAIMode(uiAIMode);

    const matchEndHandler = () => {
      const tournament = isTournamentMode();
      if (tournament) {
        handleTournamentMatchEnd();
      }
      options?.onMatchEnd?.({ tournament, tournamentFinished: isTournamentFinished() });
    };

    update(t, matchEndHandler);

    draw();

    rafId = requestAnimationFrame(loop);
  };

  rafId = requestAnimationFrame(loop);

  return () => {
    stopped = true;
    if (rafId !== null) cancelAnimationFrame(rafId);

    unregisterKeys();
  };
}
