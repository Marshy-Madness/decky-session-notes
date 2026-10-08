import { FC, useEffect, useState } from "react";
import { toaster } from "@decky/api";
import { ModalRoot, DialogButton, Focusable, Spinner, showModal } from "@decky/ui";
import { FaPlus } from "react-icons/fa";
import { backend } from "../api/backend";
import { clearPendingScreenshots, PendingShots } from "../state/pendingScreenshots";
import { emitDataChanged } from "../state/notesStore";
import { Game, Screenshot } from "../types";
import { sortNotes } from "../utils/format";
import { NoteEditor } from "./NoteEditor";
import { removeFromSteam } from "../utils/steamScreenshots";
import { getSettings } from "../state/notesStore";
import * as s from "./styles";

/** "You took a screenshot" prompt: put it in a new note or add it to an existing one. */
export const AttachScreenshotsModal: FC<{ pending: PendingShots; closeModal?: () => void }> = ({ pending, closeModal }) => {
  const [game, setGame] = useState<Game | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    backend.getGame(pending.appId).then(setGame);
    backend.listSteamScreenshots(pending.appId, 20).then((shots) =>
      setPreviews(Object.fromEntries(shots.map((sh) => [sh.path, sh.preview])))
    );
  }, [pending.appId]);

  const attachAll = async (): Promise<Screenshot[] | null> => {
    setBusy(true);
    try {
      const out: Screenshot[] = [];
      for (const path of pending.paths) out.push(await backend.attachScreenshot(pending.appId, path));
      if (getSettings().removeFromSteam) await removeFromSteam(pending.appId, pending.paths).catch(() => 0);
      clearPendingScreenshots();
      return out;
    } catch (e) {
      toaster.toast({ title: "Desk of Madness", body: `Couldn't attach the screenshot: ${(e as Error)?.message ?? e}` });
      setBusy(false);
      return null;
    }
  };

  const newNote = async () => {
    const shots = await attachAll();
    if (!shots) return;
    closeModal?.();
    showModal(
      <NoteEditor
        appId={pending.appId}
        note={null}
        folderId={null}
        folders={game?.folders ?? []}
        gameName={game?.name}
        initialScreenshots={shots}
        onSaved={emitDataChanged}
      />
    );
  };

  const addTo = async (noteId: string) => {
    const note = game?.notes.find((n) => n.id === noteId);
    if (!note) return;
    const shots = await attachAll();
    if (!shots) return;
    await backend.saveNote(pending.appId, { ...note, screenshots: [...note.screenshots, ...shots] });
    emitDataChanged();
    closeModal?.();
  };

  const n = pending.paths.length;

  return (
    <ModalRoot className="dom-modal" onCancel={closeModal} bAllowFullSize>
      <h2 style={{ marginTop: 0 }}>
        {n === 1 ? "New screenshot" : `${n} new screenshots`}
        {game && <span style={{ opacity: 0.6, fontSize: "0.7em" }}> · {game.name}</span>}
      </h2>
      <div style={{ display: "flex", gap: "8px", overflowX: "auto", marginBottom: "12px" }}>
        {pending.paths.map((p) =>
          previews[p] ? (
            <img key={p} src={previews[p]} style={{ width: "200px", height: "112px", objectFit: "cover", borderRadius: "4px" }} />
          ) : (
            <div key={p} style={{ width: "200px", height: "112px", background: "rgba(255,255,255,0.08)", borderRadius: "4px" }} />
          )
        )}
      </div>

      <Focusable style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
        <DialogButton onClick={newNote} disabled={busy || !game}>
          <FaPlus /> New note with {n === 1 ? "it" : "them"}
        </DialogButton>
        <DialogButton
          onClick={() => {
            clearPendingScreenshots();
            closeModal?.();
          }}
        >
          Dismiss
        </DialogButton>
      </Focusable>

      {!game && <Spinner style={{ width: "28px" }} />}
      {game && game.notes.length > 0 && (
        <>
          <div style={{ fontSize: "13px", opacity: 0.8, marginBottom: "6px" }}>Or add to an existing note:</div>
          <Focusable style={{ maxHeight: "35vh", overflowY: "auto" }}>
            {sortNotes(game.notes, "edited").map((note) => (
              <Focusable
                key={note.id}
                style={{ ...s.row, padding: "8px 12px" }}
                onActivate={() => !busy && addTo(note.id)}
                onClick={() => !busy && addTo(note.id)}
              >
                <div style={{ ...s.title, flex: 1 }}>{note.title}</div>
                <span style={s.chip}>{note.screenshots.length} 📷</span>
              </Focusable>
            ))}
          </Focusable>
        </>
      )}
    </ModalRoot>
  );
};
