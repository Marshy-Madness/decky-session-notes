import { FC, useEffect, useState } from "react";
import { Dropdown, Focusable, TextField } from "@decky/ui";
import { backend } from "../api/backend";
import { updateSettings, useDataVersion, useSettings } from "../state/notesStore";
import { GameSummary, SortMode } from "../types";
import { SORT_LABELS, formatDate, formatDuration, sortGames } from "../utils/format";
import { Loading, errorText } from "./Loading";
import * as s from "./styles";

const SORT_OPTIONS = (Object.keys(SORT_LABELS) as SortMode[]).map((k) => ({ label: SORT_LABELS[k], data: k }));

export function gameArt(appId: string): string | undefined {
  try {
    const store = (window as any).appStore;
    const overview = store?.GetAppOverviewByAppID?.(Number(appId));
    return overview ? store.GetCachedLandscapeImageURLForApp?.(overview) : undefined;
  } catch {
    return undefined;
  }
}

/** The "All" tab: every game that has notes or has been launched, sortable. */
export const Library: FC<{ onOpen: (appId: string) => void; runningAppId?: string }> = ({ onOpen, runningAppId }) => {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const version = useDataVersion();
  const sort = useSettings().sort ?? "edited";

  const load = () => {
    setError(null);
    backend.listGames().then(setGames, (e) => setError(errorText(e)));
  };
  useEffect(load, [version]);

  if (!games) return <Loading error={error} onRetry={load} what="your games" />;

  const q = search.trim().toLowerCase();
  const visible = sortGames(
    games.filter((g) => g.noteCount > 0 || g.launchCount > 0 || (g.sharedCount ?? 0) > 0).filter((g) => !q || g.name.toLowerCase().includes(q)),
    sort
  );

  return (
    <div>
      <Focusable style={s.toolbar}>
        <div style={{ flex: 1 }}>
          <TextField value={search} onChange={(e) => setSearch(e.target.value)} bShowClearAction label="Search games" />
        </div>
        <div style={{ minWidth: "170px" }}>
          <Dropdown
            rgOptions={SORT_OPTIONS}
            selectedOption={sort}
            onChange={(o) => updateSettings({ sort: o.data })}
            menuLabel="Sort by"
            renderButtonValue={(el) => <span>Sort: {el}</span>}
          />
        </div>
      </Focusable>

      {visible.length === 0 && (
        <div style={{ opacity: 0.7, padding: "12px 0" }}>
          {q ? "No games match." : "No games yet. Launch a game and it will show up here."}
        </div>
      )}

      {visible.map((g) => {
        const art = gameArt(g.appId);
        return (
          <Focusable key={g.appId} style={s.row} onActivate={() => onOpen(g.appId)} onClick={() => onOpen(g.appId)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={s.title}>
                {g.name}
                {g.appId === runningAppId && <span style={{ ...s.chip, background: "#2d7d2d", marginLeft: "8px" }}>● Playing</span>}
              </div>
              <div style={s.subline}>
                {g.noteCount} notes{g.folderCount > 0 && ` · ${g.folderCount} folders`}
                {(g.sharedCount ?? 0) > 0 && ` · ${g.sharedCount} shared with you`}
              </div>
              <div style={s.chipRow}>
                <span style={s.chip}>Launched {g.launchCount}×</span>
                <span style={s.chip}>Played {formatDuration(g.playtimeSeconds)}</span>
                <span style={s.chip}>Last played {formatDate(g.lastLaunched)}</span>
                {g.lastEdited && <span style={s.chip}>Edited {formatDate(g.lastEdited)}</span>}
              </div>
            </div>
            {art && <img src={art} style={{ width: "128px", height: "60px", objectFit: "cover", borderRadius: "4px", flex: "0 0 auto" }} />}
          </Focusable>
        );
      })}
    </div>
  );
};
