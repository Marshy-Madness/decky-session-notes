import { FC, useEffect, useState } from "react";
import { DialogButton, Focusable, ModalRoot, Spinner, ToggleField } from "@decky/ui";
import { backend } from "../api/backend";
import { Note, ServerUser, Share } from "../types";
import * as s from "./styles";
import { errText } from "../utils/errors";

/** Share a note (read-only) with other people on your sync server. */
export const ShareModal: FC<{ appId: string; note: Note; closeModal?: () => void }> = ({ appId, note, closeModal }) => {
  const [users, setUsers] = useState<ServerUser[] | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const [u, sh] = await Promise.all([backend.serverUsers(), backend.noteShares(appId, note.id)]);
      setUsers(u);
      setShares(sh);
    } catch (e) {
      setError(errText(e));
    }
  };
  useEffect(() => {
    load();
  }, []);

  const toggle = async (user: ServerUser, on: boolean) => {
    setBusy(user.id);
    try {
      if (on) await backend.shareNote(appId, note.id, user.id);
      else {
        const share = shares.find((x) => x.to === user.id);
        if (share) await backend.unshareNote(share.id);
      }
      await load();
    } catch (e) {
      setError(errText(e));
    }
    setBusy(null);
  };

  return (
    <ModalRoot className="dom-modal" onCancel={closeModal}>
      <h2 style={{ marginTop: 0 }}>Share "{note.title}"</h2>
      <div style={{ fontSize: "13px", opacity: 0.75, marginBottom: "8px" }}>
        People you share with see this note (read-only) in their <b>Shared Notes</b> folder and can copy it.
      </div>
      {error && <div style={{ color: "#ff6b6b", marginBottom: "8px" }}>⚠️ {error}</div>}
      {!users && !error && <Spinner style={{ width: "28px" }} />}
      {users?.length === 0 && <div style={{ opacity: 0.7 }}>No one else is on your server yet. Invite people from the website.</div>}
      <Focusable style={{ maxHeight: "50vh", overflowY: "auto" }}>
        {users?.map((u) => (
          <div key={u.id} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {u.avatar ? (
              <img src={u.avatar} style={{ width: "32px", height: "32px", borderRadius: "4px" }} />
            ) : (
              <div style={{ width: "32px", height: "32px", borderRadius: "4px", background: "rgba(255,255,255,0.1)" }} />
            )}
            <div style={{ flex: 1 }}>
              <ToggleField
                label={u.name}
                description={u.steamId ?? undefined}
                checked={shares.some((x) => x.to === u.id)}
                disabled={busy === u.id}
                onChange={(v) => toggle(u, v)}
              />
            </div>
          </div>
        ))}
      </Focusable>
      <DialogButton style={{ ...s.smallButton, marginTop: "12px" }} onClick={closeModal}>
        Done
      </DialogButton>
    </ModalRoot>
  );
};
