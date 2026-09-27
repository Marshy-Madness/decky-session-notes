import { FC, useState } from "react";
import { PanelSectionRow } from "@decky/ui";
import { Note } from "../types";

const ICONS: Record<Note["type"], string> = {
  quick: "📝",
  checklist: "☑",
  death: "💀",
  milestone: "🏆",
  hint: "🔒",
};

export const NoteItem: FC<{ note: Note; onEdit: () => void }> = ({ note, onEdit }) => {
  const [revealed, setRevealed] = useState(note.type !== "hint");

  return (
    <PanelSectionRow>
      <div onClick={() => (note.type === "hint" && !revealed ? setRevealed(true) : onEdit())}>
        <span>{ICONS[note.type]} </span>
        <span style={{ filter: revealed ? "none" : "blur(4px)" }}>{note.body}</span>
        {note.tags.length > 0 && (
          <div style={{ opacity: 0.6, fontSize: "0.8em" }}>{note.tags.map((t) => `#${t}`).join(" ")}</div>
        )}
      </div>
    </PanelSectionRow>
  );
};
