import { FC, useEffect, useState } from "react";
import { showModal } from "@decky/ui";
import { backend } from "../../api/backend";
import { getSettings, updateSettings } from "../../state/notesStore";
import { EntryModal, showWorkshopFor } from "../../components/Workshop";
import { SharedNoteViewer } from "../../components/SharedNotes";
import { openNote } from "../../noteActions";
import { WorkshopSummary } from "../../types";
import { errText } from "../../utils/errors";
import { kindInfo } from "../../utils/kinds";
import { registerTome, TomeProps } from "../registry";
import { Btn, Buttons, Hint, Line, byUpdated, ellipsis } from "../bits";

// ---------- 🏭 Madness Workshop ----------

const WorkshopTome: FC<TomeProps> = ({ game, goTab }) => {
  const [top, setTop] = useState<WorkshopSummary[] | null>(null);
  const [fresh, setFresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!game) return;
    setTop(null);
    setError(null);
    const seen = getSettings().desk?.workshopSeen?.[game.appId] ?? 0;
    backend
      .bsEntries({ appId: game.appId, sort: "top" })
      .then((list) => setTop(list.slice(0, 3)))
      .catch((e) => setError(errText(e)));
    backend
      .bsEntries({ appId: game.appId, sort: "new" })
      .then((list) => setFresh(seen ? list.filter((e) => e.createdAt > seen).length : 0))
      .catch(() => setFresh(0));
  }, [game?.appId]);
  if (!game) return null;

  const browse = () => {
    const desk = getSettings().desk ?? {};
    updateSettings({ desk: { ...desk, workshopSeen: { ...desk.workshopSeen, [game.appId]: Date.now() } } });
    showWorkshopFor({ appId: game.appId, name: game.name });
    goTab("workshop");
  };

  return (
    <>
      {fresh > 0 && (
        <div style={{ fontSize: "13px", color: "#ffc82c", marginBottom: "4px" }}>
          ✨ {fresh} new {fresh === 1 ? "book" : "books"} for {game.name} since you last looked
        </div>
      )}
      {error && <Hint>⚠️ {error}</Hint>}
      {!error && !top && <Hint>Loading…</Hint>}
      {top?.length === 0 && <Hint>No community books for {game.name} yet. Publish one of your notes to start it off.</Hint>}
      {top && top.length > 0 && (
        <div style={{ fontSize: "11px", fontWeight: "bold", letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.6, margin: "2px 0 4px" }}>
          🔥 Popular
        </div>
      )}
      {top?.map((e) => (
        <Line key={e.id} icon={kindInfo(e.kind).icon} onOpen={() => showModal(<EntryModal id={e.id} appId={game.appId} />)} okLabel="Read">
          <div style={ellipsis}>{e.title}</div>
          <div style={{ fontSize: "12px", opacity: 0.6 }}>
            ❤️ {e.likes} · by {e.author.name}
          </div>
        </Line>
      ))}
      <Buttons>
        <Btn primary onClick={browse}>
          Browse the Workshop
        </Btn>
      </Buttons>
    </>
  );
};

// ---------- 👥 Shared Notes ----------

const SharedNotesTome: FC<TomeProps> = ({ game }) => {
  if (!game) return null;
  const shared = game.shared ?? [];
  return (
    <>
      {shared.slice(0, 5).map((sh) => (
        <Line key={sh.shareId} icon="👥" onOpen={() => showModal(<SharedNoteViewer appId={game.appId} shared={sh} />)} okLabel="Read">
          <div style={ellipsis}>{sh.note.title}</div>
          <div style={{ fontSize: "12px", opacity: 0.6 }}>from {sh.fromName}</div>
        </Line>
      ))}
      {shared.length === 0 && <Hint>Nobody has shared notes for this game with you.</Hint>}
    </>
  );
};

// ---------- 📌 Pinned Notes ----------

const PinnedNotes: FC<TomeProps> = ({ game }) => {
  if (!game) return null;
  const pinned = game.notes.filter((n) => n.pinned).sort(byUpdated);
  return (
    <>
      {pinned.map((n) => (
        <Line key={n.id} icon={kindInfo(n.kind).icon} onOpen={() => openNote(game, n)} okLabel="Open">
          <div style={ellipsis}>{n.title}</div>
        </Line>
      ))}
      {pinned.length === 0 && <Hint>No pinned notes. Pin one from its options to keep it here.</Hint>}
    </>
  );
};

registerTome({
  id: "workshop",
  name: "Madness Workshop",
  icon: "🏭",
  category: "workshop",
  description: "Popular community books for this game, and a badge when new ones arrive.",
  defaultOn: true,
  needsGame: true,
  component: WorkshopTome,
});
registerTome({
  id: "shared-notes",
  name: "Shared Notes",
  icon: "👥",
  category: "workshop",
  description: "Notes friends on your server shared with you for this game.",
  defaultOn: true,
  needsGame: true,
  isEmpty: (g) => !g?.shared?.length,
  component: SharedNotesTome,
});
registerTome({
  id: "pinned-notes",
  name: "Pinned Notes",
  icon: "📌",
  category: "workshop",
  description: "The notes you pinned for this game.",
  defaultOn: true,
  needsGame: true,
  isEmpty: (g) => !g?.notes.some((n) => n.pinned),
  component: PinnedNotes,
});
