import { FC } from "react";
import { DialogButton, Focusable, showModal } from "@decky/ui";
import { FaMapMarkerAlt, FaPen } from "react-icons/fa";
import { backend } from "../api/backend";
import { emitDataChanged } from "../state/notesStore";
import { Game } from "../types";
import { formatDateTime } from "../utils/format";
import { NameModal } from "./NameModal";
import * as s from "./styles";

export function editLeftOff(appId: string, current: string) {
  showModal(
    <NameModal
      heading="Where did you leave off?"
      label="Shown at the top every time you launch this game"
      initial={current}
      allowEmpty
      onSubmit={async (text) => {
        await backend.setLeftOff(appId, text);
        emitDataChanged();
      }}
    />
  );
}

/** The "where I left off" pin that sits at the top of a game's notes; a single slim line until you fill it in. */
export const LeftOffCard: FC<{ game: Game }> = ({ game }) => {
  const leftOff = game.leftOff?.text ? game.leftOff : null;
  const edit = () => editLeftOff(game.appId, leftOff?.text ?? "");

  if (!leftOff)
    return (
      <Focusable
        style={{ ...s.row, background: "rgba(26,159,255,0.12)", padding: "6px 12px", gap: "10px" }}
        onActivate={edit}
        onClick={edit}
        onOKActionDescription="Add"
      >
        <FaMapMarkerAlt size={15} style={{ color: "#1a9fff", flex: "0 0 auto" }} />
        <div style={{ ...s.subline, flex: 1, marginTop: 0, opacity: 1 }}>
          <b>Where I left off</b>
          <span style={{ opacity: 0.7 }}> · add a reminder for next time</span>
        </div>
        <FaPen size={12} style={{ opacity: 0.6, flex: "0 0 auto" }} />
      </Focusable>
    );

  return (
    <Focusable
      style={{ ...s.row, background: "rgba(26,159,255,0.15)", alignItems: "flex-start", padding: "8px 12px" }}
      onActivate={edit}
      onClick={edit}
      onOKActionDescription="Edit"
    >
      <FaMapMarkerAlt size={16} style={{ marginTop: "2px", color: "#1a9fff", flex: "0 0 auto" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: "bold", opacity: 0.8 }}>
          Where I left off
          <span style={{ fontWeight: "normal", opacity: 0.8 }}>
            {" · "}
            {formatDateTime(leftOff.updatedAt)}
            {leftOff.launchNumber != null && ` · Launch #${leftOff.launchNumber}`}
          </span>
        </div>
        <div style={{ fontSize: "15px", whiteSpace: "pre-wrap", marginTop: "2px" }}>{leftOff.text}</div>
      </div>
      <DialogButton
        style={{ ...s.smallButton, padding: "4px 12px", fontSize: "13px" }}
        onClick={async (e: any) => {
          e?.stopPropagation?.();
          await backend.setLeftOff(game.appId, "");
          emitDataChanged();
        }}
      >
        Clear
      </DialogButton>
    </Focusable>
  );
};
