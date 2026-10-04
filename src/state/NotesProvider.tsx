import { FC, ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { backend } from "../api/backend";
import { Game } from "../types";
import { useDataVersion } from "./notesStore";

interface GameContextValue {
  appId: string;
  game: Game | null;
  refresh: () => Promise<void>;
}

const GameContext = createContext<GameContextValue | null>(null);

/** Loads one game's notes/folders/sessions and refetches whenever data changes. */
export const NotesProvider: FC<{ appId: string; children: ReactNode }> = ({ appId, children }) => {
  const [game, setGame] = useState<Game | null>(null);
  const version = useDataVersion();

  const refresh = useCallback(async () => {
    setGame(await backend.getGame(appId));
  }, [appId]);

  useEffect(() => {
    refresh();
  }, [refresh, version]);

  return <GameContext.Provider value={{ appId, game, refresh }}>{children}</GameContext.Provider>;
};

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within NotesProvider");
  return ctx;
}
