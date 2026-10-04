import { FC, Fragment, ReactNode, useState } from "react";
import { DialogButton, Focusable, ModalRoot, showModal } from "@decky/ui";
import { FaEye } from "react-icons/fa";
import { Note } from "../types";
import { formatDateTime } from "../utils/format";
import { kindInfo } from "../utils/kinds";
import { AudioButton } from "./AudioButton";
import { MediaImage, MediaLoader } from "./MediaImage";
import * as s from "./styles";

const ImageModal: FC<{ appId: string; file: string; loader?: MediaLoader; closeModal?: () => void }> = ({
  appId,
  file,
  loader,
  closeModal,
}) => (
  <ModalRoot onCancel={closeModal} bAllowFullSize>
    <MediaImage appId={appId} file={file} loader={loader} style={{ width: "100%", maxHeight: "75vh", objectFit: "contain" }} />
  </ModalRoot>
);

/**
 * Renders a note you can read but not edit (shared notes, Bookstore entries): spoiler gate,
 * information with inline screenshots, checklist, voice notes and a gallery.
 */
export const ReadOnlyNote: FC<{
  appId: string;
  note: Note;
  loader?: MediaLoader;
  chips?: ReactNode;
  /** Spoiler label shown on the gate, e.g. "Beat the first boss". */
  spoilerLabel?: string;
}> = ({ appId, note, loader, chips, spoilerLabel }) => {
  const [revealed, setRevealed] = useState(!note.spoiler);
  const open = (file: string) => showModal(<ImageModal appId={appId} file={file} loader={loader} />);
  const parts = note.body.split(/(\[img:\d+\])/);
  const inlined = new Set<number>();
  parts.forEach((p) => {
    const m = p.match(/^\[img:(\d+)\]$/);
    if (m) inlined.add(Number(m[1]) - 1);
  });
  const gallery = note.screenshots.filter((_, i) => !inlined.has(i));
  const kind = kindInfo(note.kind);

  return (
    <>
      <h2 style={{ marginTop: 0, marginBottom: "4px" }}>{note.title}</h2>
      <div style={s.chipRow}>
        {note.kind && note.kind !== "note" && (
          <span style={s.chip}>
            {kind.icon} {kind.label}
          </span>
        )}
        {chips}
        <span style={s.chip}>Edited {formatDateTime(note.updatedAt)}</span>
        {note.tags.map((t) => (
          <span key={t} style={s.chip}>
            #{t}
          </span>
        ))}
      </div>

      {!revealed ? (
        <Focusable style={{ margin: "24px 0", textAlign: "center" }}>
          <div style={{ opacity: 0.8, marginBottom: "10px" }}>
            {spoilerLabel ? (
              <>
                Spoiler: <b>{spoilerLabel}</b>
              </>
            ) : (
              "This note is marked as a spoiler."
            )}
          </div>
          <DialogButton style={{ ...s.smallButton, margin: "0 auto" }} onClick={() => setRevealed(true)}>
            <FaEye /> Reveal
          </DialogButton>
        </Focusable>
      ) : (
        <>
          <Focusable style={{ maxHeight: "45vh", overflowY: "auto", margin: "12px 0" }}>
            {parts.map((part, i) => {
              const m = part.match(/^\[img:(\d+)\]$/);
              if (m) {
                const shot = note.screenshots[Number(m[1]) - 1];
                return shot ? (
                  <Focusable key={i} onActivate={() => open(shot.file)} style={{ margin: "8px 0" }}>
                    <MediaImage appId={appId} file={shot.file} loader={loader} style={{ maxWidth: "100%", maxHeight: "40vh" }} />
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
            {note.checklist && note.checklist.length > 0 && (
              <div style={{ marginTop: "10px", fontSize: "14px" }}>
                {note.checklist.map((c) => (
                  <div key={c.id} style={{ opacity: c.done ? 0.6 : 1 }}>
                    {c.done ? "☑" : "☐"} {c.text}
                  </div>
                ))}
              </div>
            )}
          </Focusable>
          {note.recordings.length > 0 && (
            <Focusable style={{ ...s.toolbar, flexWrap: "wrap" }}>
              {note.recordings.map((rec, i) => (
                <AudioButton key={rec.id} appId={appId} recording={rec} loader={loader} label={`Voice ${i + 1}`} />
              ))}
            </Focusable>
          )}
          {gallery.length > 0 && (
            <Focusable flow-children="row" style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "4px" }}>
              {gallery.map((shot) => (
                <Focusable key={shot.id} onActivate={() => open(shot.file)} onClick={() => open(shot.file)}>
                  <MediaImage appId={appId} file={shot.thumb ?? shot.file} loader={loader} style={{ width: "200px", height: "112px" }} />
                </Focusable>
              ))}
            </Focusable>
          )}
        </>
      )}
    </>
  );
};
