import { FC, useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { FaCopy } from "react-icons/fa";
import { toaster } from "@decky/api";
import { backend } from "../api/backend";
import { emitDataChanged } from "../state/notesStore";
import { SharedNote } from "../types";
import { ReadOnlyNote } from "./ReadOnlyNote";
import * as s from "./styles";
import { errText } from "../utils/errors";

/** A note someone shared with you: read it, or copy it into your own notes to edit. */
export const SharedNoteViewer: FC<{ appId: string; shared: SharedNote; closeModal?: () => void }> = ({
  appId,
  shared,
  closeModal,
}) => {
  const [busy, setBusy] = useState(false);

  const copy = async () => {
    setBusy(true);
    try {
      await backend.copySharedNote(appId, shared.shareId);
      emitDataChanged();
      toaster.toast({ title: "Desk of Madness", body: `Copied "${shared.note.title}" to your notes.` });
      closeModal?.();
    } catch (e) {
      toaster.toast({ title: "Couldn't copy", body: errText(e) });
      setBusy(false);
    }
  };

  return (
    <ModalRoot className="dom-modal" onCancel={closeModal} bAllowFullSize>
      <ReadOnlyNote
        closeModal={closeModal}
        appId={appId}
        note={shared.note}
        chips={<span style={{ ...s.chip, background: "#1f5c45" }}>👥 Shared by {shared.fromName}</span>}
      />
      <Focusable style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
        <DialogButton onClick={copy} disabled={busy}>
          <FaCopy /> Copy to my notes
        </DialogButton>
        <DialogButton onClick={closeModal}>Close</DialogButton>
      </Focusable>
    </ModalRoot>
  );
};
