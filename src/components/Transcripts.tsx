import { FC } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { FaParagraph } from "react-icons/fa";
import { Recording } from "../types";
import * as s from "./styles";

/** What was said in each voice note, under the play buttons. onUse adds a button that copies it into the note. */
export const Transcripts: FC<{ recordings: Recording[]; onUse?: (text: string) => void }> = ({ recordings, onUse }) => {
  const said = recordings.map((rec, i) => ({ rec, i })).filter(({ rec }) => rec.transcript);
  if (!said.length) return null;
  return (
    <Focusable style={{ display: "flex", flexDirection: "column", gap: "4px", margin: "4px 0 8px" }}>
      {said.map(({ rec, i }) => (
        <div
          key={rec.id}
          style={{ display: "flex", gap: "8px", alignItems: "center", background: "rgba(0,0,0,0.25)", borderRadius: "4px", padding: "6px 10px", fontSize: "13px" }}
        >
          <div style={{ flex: 1, whiteSpace: "pre-wrap" }}>
            <span style={{ opacity: 0.6 }}>🎙 Voice {i + 1}: </span>
            {rec.transcript}
          </div>
          {onUse && (
            <DialogButton style={s.smallButton} onClick={() => onUse(rec.transcript!)}>
              <FaParagraph size={10} /> Add to text
            </DialogButton>
          )}
        </div>
      ))}
    </Focusable>
  );
};
