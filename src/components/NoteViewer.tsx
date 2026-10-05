import { FC, Fragment, useEffect, useState } from "react";
import { ModalRoot, DialogButton, Focusable, showModal } from "@decky/ui";
import { toaster } from "@decky/api";
import { backend } from "../api/backend";
import { FaThumbtack as FaPinScreen, FaCheckSquare, FaHistory, FaEdit, FaEye, FaRegSquare, FaThumbtack, FaTrash } from "react-icons/fa";
import { Note } from "../types";
import { formatDateTime } from "../utils/format";
import { MediaImage } from "./MediaImage";
import { kindInfo } from "../utils/kinds";
import { AudioButton } from "./AudioButton";
import { Transcripts } from "./Transcripts";
import * as s from "./styles";
import { openOverlayModal } from "./OverlayModal";

const ImageModal: FC<{ appId: string; file: string; closeModal?: () => void }> = ({ appId, file, closeModal }) => (
  <ModalRoot onCancel={closeModal} bAllowFullSize>
    <MediaImage appId={appId} file={file} style={{ width: "100%", maxHeight: "75vh", objectFit: "contain" }} />
  </ModalRoot>
);

export const openImage = (appId: string, file: string) => showModal(<ImageModal appId={appId} file={file} />);

export const NoteViewer: FC<{
  appId: string;
  note: Note;
  folderLabel?: string;
  onEdit: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  onHistory: () => void;
  /** Save a change made in the viewer itself (checking off checklist items). */
  onUpdate: (note: Note) => void;
  closeModal?: () => void;
}> = ({ appId, note: initial, folderLabel, onEdit, onTogglePin, onDelete, onHistory, onUpdate, closeModal }) => {
  const [note, setNote] = useState(initial);
  const [revealed, setRevealed] = useState(!initial.spoiler);
  const [onScreen, setOnScreen] = useState(false);

  useEffect(() => {
    backend.overlayStatus().then((st) => setOnScreen(st.pin?.noteId === initial.id));
  }, [initial.id]);

  const toggleScreenPin = async () => {
    if (onScreen) {
      await backend.unpinOverlay();
      setOnScreen(false);
      return;
    }
    const st = await backend.pinOverlay(appId, note.id);
    setOnScreen(true);
    toaster.toast({
      title: "Pinned to screen",
      body: st.overlayRunning
        ? "Shows in the performance overlay. Ticking items off updates it. Use Move… to place it and change its look."
        : "Turn on the Performance Overlay (Quick Access → ⚡ → Level 1 or higher) to see it.",
    });
  };

  const toggleItem = (id: string) => {
    const next = { ...note, checklist: note.checklist?.map((i) => (i.id === id ? { ...i, done: !i.done } : i)) };
    setNote(next);
    onUpdate(next);
  };

  const parts = note.body.split(/(\[img:\d+\])/);
  const inlined = new Set<number>();
  parts.forEach((p) => {
    const m = p.match(/^\[img:(\d+)\]$/);
    if (m) inlined.add(Number(m[1]) - 1);
  });
  const gallery = note.screenshots.filter((_, i) => !inlined.has(i));

  const act = (fn: () => void) => () => {
    closeModal?.();
    fn();
  };

  return (
    <ModalRoot onCancel={closeModal} bAllowFullSize>
      <h2 style={{ marginTop: 0, marginBottom: "4px" }}>
        {note.pinned && <FaThumbtack size={14} style={{ marginRight: "8px" }} />}
        {note.title}
      </h2>
      <div style={s.chipRow}>
        {note.kind && note.kind !== "note" && (
          <span style={s.chip}>
            {kindInfo(note.kind).icon} {kindInfo(note.kind).label}
          </span>
        )}
        {note.source && <span style={s.chip}>{note.source.type === "bookstore" ? "📚" : "👥"} from {note.source.author}</span>}
        <span style={s.chip}>Created {formatDateTime(note.createdAt)}</span>
        <span style={s.chip}>Edited {formatDateTime(note.updatedAt)}</span>
        {note.launchNumber != null && <span style={s.chip}>Launch #{note.launchNumber}</span>}
        {folderLabel && <span style={s.chip}>📁 {folderLabel}</span>}
        {note.tags.map((t) => (
          <span key={t} style={s.chip}>
            #{t}
          </span>
        ))}
      </div>

      {!revealed && (
        <Focusable style={{ margin: "24px 0", textAlign: "center" }}>
          <div style={{ opacity: 0.75, marginBottom: "10px" }}>This note is marked as a spoiler.</div>
          <DialogButton style={{ ...s.smallButton, margin: "0 auto" }} onClick={() => setRevealed(true)}>
            <FaEye /> Reveal
          </DialogButton>
        </Focusable>
      )}

      {revealed && (
      <>
      <Focusable style={{ maxHeight: "50vh", overflowY: "auto", margin: "12px 0" }}>
        {parts.map((part, i) => {
          const m = part.match(/^\[img:(\d+)\]$/);
          const shot = m ? note.screenshots[Number(m[1]) - 1] : undefined;
          if (m) {
            return shot ? (
              <Focusable key={i} onActivate={() => openImage(appId, shot.file)} style={{ margin: "8px 0" }}>
                <MediaImage appId={appId} file={shot.file} style={{ maxWidth: "100%", maxHeight: "40vh" }} />
              </Focusable>
            ) : (
              <Fragment key={i} />
            );
          }
          return part.trim() ? (
            <div key={i} style={{ whiteSpace: "pre-wrap", fontSize: "14px", lineHeight: 1.4 }}>
              {part.replace(/^\n+|\n+$/g, "")}
            </div>
          ) : (
            <Fragment key={i} />
          );
        })}
        {!note.body.trim() && !note.checklist?.length && <div style={{ opacity: 0.6 }}>No information yet.</div>}
      </Focusable>

      {note.checklist && note.checklist.length > 0 && (
        <Focusable style={{ marginBottom: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <div style={{ fontSize: "13px", opacity: 0.8, flex: 1 }}>
              Checklist · {note.checklist.filter((i) => i.done).length}/{note.checklist.length}
            </div>
            <DialogButton style={{ ...s.smallButton, padding: "2px 10px", fontSize: "12px" }} onClick={toggleScreenPin}>
              <FaPinScreen size={10} /> {onScreen ? "Unpin from screen" : "Pin to screen"}
            </DialogButton>
            {onScreen && (
              <DialogButton
                style={{ ...s.smallButton, padding: "2px 10px", fontSize: "12px" }}
                onClick={openOverlayModal}
              >
                Move…
              </DialogButton>
            )}
          </div>
          {note.checklist.map((item) => (
            <Focusable
              key={item.id}
              style={{ ...s.row, padding: "6px 10px", marginBottom: "4px" }}
              onActivate={() => toggleItem(item.id)}
              onClick={() => toggleItem(item.id)}
            >
              {item.done ? <FaCheckSquare /> : <FaRegSquare />}
              <span style={{ textDecoration: item.done ? "line-through" : "none", opacity: item.done ? 0.6 : 1 }}>{item.text}</span>
            </Focusable>
          ))}
        </Focusable>
      )}

      {note.recordings.length > 0 && (
        <Focusable style={{ ...s.toolbar, flexWrap: "wrap" }}>
          {note.recordings.map((rec, i) => (
            <AudioButton key={rec.id} appId={appId} recording={rec} label={`Voice ${i + 1}`} />
          ))}
        </Focusable>
      )}
      <Transcripts recordings={note.recordings} />

      {gallery.length > 0 && (
        <Focusable flow-children="row" style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "4px" }}>
          {gallery.map((shot) => (
            <Focusable key={shot.id} onActivate={() => openImage(appId, shot.file)} onClick={() => openImage(appId, shot.file)}>
              <MediaImage appId={appId} file={shot.thumb ?? shot.file} style={{ width: "200px", height: "112px" }} />
            </Focusable>
          ))}
        </Focusable>
      )}
      </>
      )}

      <Focusable style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "16px" }}>
        <DialogButton onClick={act(onEdit)}>
          <FaEdit /> Edit
        </DialogButton>
        <DialogButton onClick={act(onTogglePin)}>
          <FaThumbtack /> {note.pinned ? "Unpin" : "Pin"}
        </DialogButton>
        <DialogButton onClick={act(onHistory)}>
          <FaHistory /> History
        </DialogButton>
        <DialogButton onClick={act(onDelete)}>
          <FaTrash /> Delete
        </DialogButton>
        <DialogButton onClick={closeModal}>Close</DialogButton>
      </Focusable>
    </ModalRoot>
  );
};
