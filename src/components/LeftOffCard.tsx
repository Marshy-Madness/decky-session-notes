import { FC } from "react";
import { DialogButton, Focusable, showModal } from "@decky/ui";
import { FaMapMarkerAlt } from "react-icons/fa";
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

/** The "where I left off" pin that sits at the top of a game's notes. */
export const LeftOffCard: FC<{ game: Game }> = ({ game }) => {
  const leftOff = game.leftOff?.text ? game.leftOff : null;

  return (
    <Focusable
      style={{ ...s.row, background: "rgba(26,159,255,0.15)", alignItems: "flex-start" }}
      onActivate={() => editLeftOff(game.appId, leftOff?.text ?? "")}
      onClick={() => editLeftOff(game.appId, leftOff?.text ?? "")}
      onOKActionDescription="Edit"
    >
      <FaMapMarkerAlt style={{ marginTop: "3px", color: "#1a9fff" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "12px", opacity: 0.75 }}>Where I left off</div>
        {leftOff ? (
          <>
            <div style={{ fontSize: "14px", whiteSpace: "pre-wrap" }}>{leftOff.text}</div>
            <div style={{ fontSize: "11px", opacity: 0.6, marginTop: "2px" }}>
              {formatDateTime(leftOff.updatedAt)}
              {leftOff.launchNumber != null && ` · Launch #${leftOff.launchNumber}`}
            </div>
          </>
        ) : (
          <div style={{ fontSize: "14px", opacity: 0.6 }}>Nothing pinned yet. Select to add.</div>
        )}
      </div>
      {leftOff && (
        <DialogButton
          style={{ ...s.smallButton, padding: "2px 10px", fontSize: "12px" }}
          onClick={async (e: any) => {
            e?.stopPropagation?.();
            await backend.setLeftOff(game.appId, "");
            emitDataChanged();
          }}
        >
          Clear
        </DialogButton>
      )}
    </Focusable>
  );
};
