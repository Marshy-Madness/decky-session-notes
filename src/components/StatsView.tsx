import { FC, useState } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { FaChevronDown, FaChevronUp } from "react-icons/fa";
import { Game } from "../types";
import { formatDate, formatDuration } from "../utils/format";
import { SessionList } from "./SessionList";
import * as s from "./styles";

/** Game header: name plus launch/playtime/note stats, with an expandable session history. */
export const StatsView: FC<{ game: Game; live?: boolean }> = ({ game, live }) => {
  const [showSessions, setShowSessions] = useState(false);
  const sum = game.summary;

  return (
    <div style={{ marginBottom: "10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{ ...s.title, fontSize: "18px", flex: 1 }}>{game.name}</div>
        {live && <span style={{ ...s.chip, background: "#2d7d2d" }}>● Playing</span>}
      </div>
      <Focusable style={{ ...s.chipRow, alignItems: "center" }}>
        <span style={s.chip}>Launched {sum.launchCount}×</span>
        <span style={s.chip}>Played {formatDuration(sum.playtimeSeconds)}</span>
        <span style={s.chip}>Last played {formatDate(sum.lastLaunched)}</span>
        <span style={s.chip}>{sum.noteCount} notes</span>
        <DialogButton
          style={{ ...s.smallButton, padding: "0 8px", fontSize: "11px", minHeight: 0, height: "20px", lineHeight: "20px" }}
          onClick={() => setShowSessions((v) => !v)}
        >
          Sessions {showSessions ? <FaChevronUp size={9} /> : <FaChevronDown size={9} />}
        </DialogButton>
      </Focusable>
      {showSessions && (
        <div style={{ marginTop: "8px" }}>
          <SessionList sessions={game.sessions} />
        </div>
      )}
    </div>
  );
};
