import { FC, useEffect, useState } from "react";
import { PanelSectionRow, TextField } from "@decky/ui";
import { backend } from "../api/backend";

interface LibraryEntry {
  appId: string;
  name: string;
  noteCount: number;
}

export const Library: FC = () => {
  const [search, setSearch] = useState("");
  const [entries, setEntries] = useState<LibraryEntry[]>([]);

  useEffect(() => {
    (async () => {
      const games = await backend.listGamesWithNotes();
      setEntries(
        games.map((g) => ({
          ...g,
          name:
            (window as any).appStore?.GetAppOverviewByAppID?.(Number(g.appId))?.display_name ?? g.appId,
        }))
      );
    })();
  }, []);

  const filtered = entries.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PanelSectionRow>
        <TextField label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </PanelSectionRow>
      {filtered.length === 0 && <PanelSectionRow>No games with notes yet.</PanelSectionRow>}
      {filtered.map((entry) => (
        <PanelSectionRow key={entry.appId}>
          {entry.name} — {entry.noteCount} notes
        </PanelSectionRow>
      ))}
    </>
  );
};
