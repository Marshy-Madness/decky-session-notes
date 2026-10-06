import { FC, useState } from "react";
import { ModalRoot, DialogButton, Focusable, TextField } from "@decky/ui";
import { backend } from "../api/backend";
import { emitDataChanged } from "../state/notesStore";
import { formatDate, newId } from "../utils/format";

/** Optional end-of-session prompt; saves the answer as a regular note tagged #recap. */
export const SessionSummaryModal: FC<{ appId: string; gameName: string; closeModal?: () => void }> = ({
  appId,
  gameName,
  closeModal,
}) => {
  const [body, setBody] = useState("");

  const save = async () => {
    if (body.trim()) {
      await backend.setLeftOff(appId, body.trim());
      await backend.saveNote(appId, {
        id: newId(),
        folderId: null,
        title: `Session recap — ${formatDate(Date.now())}`,
        body,
        tags: ["recap"],
        screenshots: [],
        recordings: [],
        pinned: false,
        createdAt: 0,
        updatedAt: 0,
        launchNumber: null,
      });
      emitDataChanged();
    }
    closeModal?.();
  };

  return (
    <ModalRoot className="dom-modal" onCancel={closeModal}>
      <h3 style={{ marginTop: 0 }}>Done with {gameName}?</h3>
      <TextField
        label="Where did you leave off / what's next? (pinned for next time)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        focusOnMount
      />
      <Focusable style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        <DialogButton onClick={save}>Save</DialogButton>
        <DialogButton onClick={closeModal}>Skip</DialogButton>
      </Focusable>
    </ModalRoot>
  );
};
