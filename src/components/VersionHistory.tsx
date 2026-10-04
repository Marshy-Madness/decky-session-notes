import { FC, useEffect, useState } from "react";
import { ConfirmModal, DialogButton, Focusable, ModalRoot, Spinner, showModal } from "@decky/ui";
import { FaArrowLeft, FaHistory, FaUndo } from "react-icons/fa";
import { backend } from "../api/backend";
import { emitDataChanged } from "../state/notesStore";
import { DeletedNote, Note, NoteVersion } from "../types";
import { firstLine, formatDateTime } from "../utils/format";
import * as s from "./styles";

const Preview: FC<{ note: Note }> = ({ note }) => (
  <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: "6px", padding: "10px 12px", margin: "10px 0" }}>
    <div style={{ ...s.title, fontSize: "16px" }}>{note.title}</div>
    <div style={s.chipRow}>
      <span style={s.chip}>Edited {formatDateTime(note.updatedAt)}</span>
      {note.tags.map((t) => (
        <span key={t} style={s.chip}>
          #{t}
        </span>
      ))}
      {note.screenshots.length > 0 && <span style={s.chip}>📷 {note.screenshots.length}</span>}
      {note.recordings.length > 0 && <span style={s.chip}>🎙 {note.recordings.length}</span>}
    </div>
    <div style={{ whiteSpace: "pre-wrap", fontSize: "13px", marginTop: "8px", maxHeight: "30vh", overflowY: "auto" }}>
      {note.body || <span style={{ opacity: 0.6 }}>(no information)</span>}
    </div>
    {note.checklist && note.checklist.length > 0 && (
      <div style={{ fontSize: "13px", marginTop: "6px" }}>
        {note.checklist.map((c) => (
          <div key={c.id}>
            {c.done ? "☑" : "☐"} {c.text}
          </div>
        ))}
      </div>
    )}
  </div>
);

const restore = (appId: string, note: Note, closeModal?: () => void) =>
  showModal(
    <ConfirmModal
      strTitle="Restore this version?"
      strDescription="The note goes back to this version. What it says now is kept in its history, so you can undo this."
      strOKButtonText="Restore"
      onOK={async () => {
        await backend.restoreNote(appId, note);
        emitDataChanged();
        closeModal?.();
      }}
    />
  );

/** Every earlier version of one note, newest first, with a preview and restore. */
export const VersionHistoryModal: FC<{ appId: string; note: Note; closeModal?: () => void }> = ({ appId, note, closeModal }) => {
  const [versions, setVersions] = useState<NoteVersion[] | null>(null);
  const [selected, setSelected] = useState<NoteVersion | null>(null);

  useEffect(() => {
    backend.getNoteHistory(appId, note.id).then(setVersions);
  }, [appId, note.id]);

  return (
    <ModalRoot onCancel={closeModal} bAllowFullSize>
      <h2 style={{ marginTop: 0 }}>
        <FaHistory size={16} /> Version history · {note.title}
      </h2>
      {selected ? (
        <>
          <div style={{ opacity: 0.75, fontSize: "13px" }}>Saved {formatDateTime(selected.savedAt)}</div>
          <Preview note={selected.note} />
          <Focusable style={{ display: "flex", gap: "8px" }}>
            <DialogButton onClick={() => restore(appId, selected.note, closeModal)}>
              <FaUndo /> Restore this version
            </DialogButton>
            <DialogButton onClick={() => setSelected(null)}>
              <FaArrowLeft /> Back to list
            </DialogButton>
          </Focusable>
        </>
      ) : (
        <>
          {versions === null && <Spinner style={{ width: "28px" }} />}
          {versions?.length === 0 && <div style={{ opacity: 0.7 }}>No earlier versions yet. They appear after you edit this note.</div>}
          <Focusable style={{ maxHeight: "55vh", overflowY: "auto" }}>
            {versions?.map((v, i) => (
              <Focusable key={i} style={s.row} onActivate={() => setSelected(v)} onClick={() => setSelected(v)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={s.title}>{v.note.title}</div>
                  <div style={s.subline}>{firstLine(v.note.body) || " "}</div>
                </div>
                <span style={s.chip}>{formatDateTime(v.savedAt)}</span>
              </Focusable>
            ))}
          </Focusable>
          <DialogButton style={{ marginTop: "12px" }} onClick={closeModal}>
            Close
          </DialogButton>
        </>
      )}
    </ModalRoot>
  );
};

/** Notes deleted from this game, with restore. */
export const DeletedNotesModal: FC<{ appId: string; closeModal?: () => void }> = ({ appId, closeModal }) => {
  const [items, setItems] = useState<DeletedNote[] | null>(null);
  const [selected, setSelected] = useState<DeletedNote | null>(null);

  useEffect(() => {
    backend.listDeletedNotes(appId).then(setItems);
  }, [appId]);

  return (
    <ModalRoot onCancel={closeModal} bAllowFullSize>
      <h2 style={{ marginTop: 0 }}>Recently deleted</h2>
      {selected ? (
        <>
          <div style={{ opacity: 0.75, fontSize: "13px" }}>Deleted {formatDateTime(selected.deletedAt)}</div>
          <Preview note={selected.note} />
          <Focusable style={{ display: "flex", gap: "8px" }}>
            <DialogButton onClick={() => restore(appId, selected.note, closeModal)}>
              <FaUndo /> Restore note
            </DialogButton>
            <DialogButton onClick={() => setSelected(null)}>
              <FaArrowLeft /> Back to list
            </DialogButton>
          </Focusable>
        </>
      ) : (
        <>
          {items === null && <Spinner style={{ width: "28px" }} />}
          {items?.length === 0 && <div style={{ opacity: 0.7 }}>Nothing deleted.</div>}
          <Focusable style={{ maxHeight: "55vh", overflowY: "auto" }}>
            {items?.map((d) => (
              <Focusable key={d.note.id} style={s.row} onActivate={() => setSelected(d)} onClick={() => setSelected(d)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={s.title}>{d.note.title}</div>
                  <div style={s.subline}>{firstLine(d.note.body) || " "}</div>
                </div>
                <span style={s.chip}>Deleted {formatDateTime(d.deletedAt)}</span>
              </Focusable>
            ))}
          </Focusable>
          <DialogButton style={{ marginTop: "12px" }} onClick={closeModal}>
            Close
          </DialogButton>
        </>
      )}
    </ModalRoot>
  );
};
