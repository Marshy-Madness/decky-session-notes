import { FC, useState } from "react";
import { ModalRoot, DialogButton, TextField } from "@decky/ui";
import { backend } from "../api/backend";
import { Session } from "../types";

export const SessionSummaryModal: FC<{
  appId: string;
  runProfileId: string;
  start: number;
  closeModal?: () => void;
}> = ({ appId, runProfileId, start, closeModal }) => {
  const [summary, setSummary] = useState("");
  const [mood, setMood] = useState(3);

  const save = async () => {
    const session: Session = {
      id: crypto.randomUUID(),
      runProfileId,
      start,
      end: Date.now(),
      moodRating: mood,
      summary,
    };
    await backend.saveSession(appId, runProfileId, session);
    closeModal?.();
  };

  return (
    <ModalRoot onCancel={closeModal}>
      <h3>Session Summary</h3>
      <TextField label="How'd it go?" value={summary} onChange={(e) => setSummary(e.target.value)} />
      <div>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} onClick={() => setMood(n)} style={{ cursor: "pointer" }}>
            {n <= mood ? "⭐" : "☆"}
          </span>
        ))}
      </div>
      <DialogButton onClick={save}>Save</DialogButton>
      <DialogButton onClick={closeModal}>Skip</DialogButton>
    </ModalRoot>
  );
};
