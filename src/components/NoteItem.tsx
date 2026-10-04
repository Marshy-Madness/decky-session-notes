import { FC } from "react";
import { Focusable } from "@decky/ui";
import { FaThumbtack, FaMicrophone, FaCamera, FaCheckSquare, FaEyeSlash } from "react-icons/fa";
import { Note } from "../types";
import { firstLine, formatDate, formatDateTime } from "../utils/format";
import { MediaImage } from "./MediaImage";
import * as s from "./styles";

export const NoteItem: FC<{
  appId: string;
  note: Note;
  onOpen: () => void;
  onOptions: () => void;
}> = ({ appId, note, onOpen, onOptions }) => {
  const shot = note.screenshots[0];
  const hidden = note.spoiler ? { filter: "blur(6px)" } : {};
  const done = note.checklist?.filter((i) => i.done).length ?? 0;

  return (
    <Focusable
      style={s.row}
      onActivate={onOpen}
      onClick={onOpen}
      onOptionsButton={onOptions}
      onOptionsActionDescription="Note options"
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={s.title}>
          {note.pinned && <FaThumbtack size={11} style={{ marginRight: "6px" }} />}
          {note.spoiler && <FaEyeSlash size={11} style={{ marginRight: "6px" }} />}
          {note.title || "Untitled"}
        </div>
        <div style={s.subline}>{note.spoiler ? "Spoiler · open to reveal" : firstLine(note.body) || "\u00a0"}</div>
        <div style={s.chipRow}>
          <span style={s.chip}>Created {formatDate(note.createdAt)}</span>
          <span style={s.chip}>Edited {formatDateTime(note.updatedAt)}</span>
          {note.launchNumber != null && <span style={s.chip}>Launch #{note.launchNumber}</span>}
          {note.checklist && note.checklist.length > 0 && (
            <span style={s.chip}>
              <FaCheckSquare size={9} /> {done}/{note.checklist.length}
            </span>
          )}
          {note.recordings.length > 0 && (
            <span style={s.chip}>
              <FaMicrophone size={9} /> {note.recordings.length}
            </span>
          )}
          {note.screenshots.length > 1 && (
            <span style={s.chip}>
              <FaCamera size={9} /> {note.screenshots.length}
            </span>
          )}
          {note.tags.map((t) => (
            <span key={t} style={s.chip}>
              #{t}
            </span>
          ))}
        </div>
      </div>
      {shot && <MediaImage appId={appId} file={shot.thumb ?? shot.file} style={{ width: "128px", height: "72px", flex: "0 0 auto", ...hidden }} />}
    </Focusable>
  );
};
