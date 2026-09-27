import { FC, useState } from "react";
import { PanelSectionRow, ButtonItem } from "@decky/ui";
import { FaPlus } from "react-icons/fa";
import { useNotesContext } from "../state/notesStore";
import { NoteItem } from "./NoteItem";
import { NoteEditor } from "./NoteEditor";
import { TagFilterBar } from "./TagFilterBar";
import { Note } from "../types";

export const NoteList: FC = () => {
  const { notes, activeRunProfile } = useNotesContext();
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [editing, setEditing] = useState<Note | null>(null);
  const [creating, setCreating] = useState(false);

  if (!activeRunProfile) {
    return <PanelSectionRow>Launch a game to start taking notes.</PanelSectionRow>;
  }

  const visible = notes
    .filter((n) => !n.archived)
    .filter((n) => activeTags.length === 0 || activeTags.every((t) => n.tags.includes(t)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.timestamp - a.timestamp);

  const allTags = Array.from(new Set(notes.flatMap((n) => n.tags)));

  return (
    <>
      <TagFilterBar allTags={allTags} activeTags={activeTags} onChange={setActiveTags} />

      {visible.length === 0 && <PanelSectionRow>No notes yet.</PanelSectionRow>}
      {visible.map((note) => (
        <NoteItem key={note.id} note={note} onEdit={() => setEditing(note)} />
      ))}

      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => setCreating(true)}>
          <FaPlus /> New Note
        </ButtonItem>
      </PanelSectionRow>

      {(creating || editing) && (
        <NoteEditor
          note={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
};
