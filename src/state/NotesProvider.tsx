import { FC, ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { backend } from "../api/backend";
import { Game } from "../types";
import { useDataVersion } from "./notesStore";
import { errorText } from "../components/Loading";

interface GameContextValue {
  appId: string;
  game: Game | null;
  /** Why the last load failed, if it did. */
  error: string | null;
  refresh: () => Promise<void>;
}

const GameContext = createContext<GameContextValue | null>(null);

/** Loads one game's notes/folders/sessions and refetches whenever data changes. */
export const NotesProvider: FC<{ appId: string; children: ReactNode }> = ({ appId, children }) => {
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = useDataVersion();

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setGame(await backend.getGame(appId));
    } catch (e) {
      console.error("Desk of Madness: get_game failed", appId, e);
      setError(errorText(e));
    }
  }, [appId]);

  useEffect(() => {
    refresh();
  }, [refresh, version]);

  return <GameContext.Provider value={{ appId, game, error, refresh }}>{children}</GameContext.Provider>;
};

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within NotesProvider");
  return ctx;
}
