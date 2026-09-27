import { FC, useState } from "react";
import { PanelSectionRow, ButtonItem, TextField, Dropdown, DropdownOption } from "@decky/ui";
import { useNotesContext } from "../state/notesStore";
import { backend } from "../api/backend";
import { Note, NoteType } from "../types";

const TYPE_OPTIONS: DropdownOption[] = [
  { label: "Quick Note", data: "quick" },
  { label: "Checklist", data: "checklist" },
  { label: "Death", data: "death" },
  { label: "Milestone", data: "milestone" },
  { label: "Hint", data: "hint" },
];

export const NoteEditor: FC<{ note: Note | null; onClose: () => void }> = ({ note, onClose }) => {
  const { appId, activeRunProfile, refreshNotes } = useNotesContext();
  const [body, setBody] = useState(note?.body ?? "");
  const [type, setType] = useState<NoteType>(note?.type ?? "quick");
  const [tags, setTags] = useState(note?.tags.join(", ") ?? "");

  const save = async () => {
    if (!appId || !activeRunProfile) return;
    const payload: Note = {
      id: note?.id ?? crypto.randomUUID(),
      runProfileId: activeRunProfile.id,
      type,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      body,
      pinned: note?.pinned ?? false,
      archived: false,
      timestamp: note?.timestamp ?? Date.now(),
    };
    await backend.saveNote(appId, activeRunProfile.id, payload);
    await refreshNotes();
    onClose();
  };

  return (
    <>
      <PanelSectionRow>
        <Dropdown
          rgOptions={TYPE_OPTIONS}
          selectedOption={type}
          onChange={(o) => setType(o.data as NoteType)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <TextField label="Note" value={body} onChange={(e) => setBody(e.target.value)} />
      </PanelSectionRow>
      <PanelSectionRow>
        <TextField label="Tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} />
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={save}>
          Save
        </ButtonItem>
        <ButtonItem layout="below" onClick={onClose}>
          Cancel
        </ButtonItem>
      </PanelSectionRow>
    </>
  );
};
