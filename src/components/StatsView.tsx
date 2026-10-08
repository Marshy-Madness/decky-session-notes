import { FC, useState } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { FaArrowLeft, FaChevronDown, FaChevronUp } from "react-icons/fa";
import { Game } from "../types";
import { formatDuration, formatWhen, plural } from "../utils/format";
import { SessionList } from "./SessionList";
import * as s from "./styles";

/**
 * Game header: back button and name on one line, then launch/playtime/note stats with an expandable
 * session history. Kept to two short lines so the notes below get the room.
 */
export const StatsView: FC<{ game: Game; live?: boolean; onBack?: () => void; backLabel?: string; fullScreen?: boolean }> = ({
  game,
  live,
  onBack,
  backLabel = "Back",
  fullScreen,
}) => {
  const [showSessions, setShowSessions] = useState(false);
  const sum = game.summary;

  const stats = [
    `${formatDuration(sum.playtimeSeconds)} played`,
    `${sum.launchCount} ${sum.launchCount === 1 ? "launch" : "launches"}`,
    `last ${formatWhen(sum.lastLaunched)}`,
    plural(sum.noteCount, "note"),
  ];

  return (
    <div style={{ marginBottom: "8px" }}>
      <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {onBack && (
          <DialogButton
            style={fullScreen ? { ...s.smallButton, height: "36px" } : { ...s.iconButton, width: "40px", minWidth: "40px", height: "36px", fontSize: "15px" }}
            onClick={onBack}
            {...({ title: backLabel, "aria-label": backLabel } as any)}
          >
            <FaArrowLeft /> {fullScreen && backLabel}
          </DialogButton>
        )}
        <div style={{ ...s.title, fontSize: "20px", flex: 1 }}>{game.name}</div>
        {live && <span style={{ ...s.chip, background: "#2d7d2d", opacity: 1 }}>● Playing</span>}
      </Focusable>
      <Focusable style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", marginTop: "4px" }}>
        <div style={{ fontSize: "13px", opacity: 0.75 }}>{stats.join(" · ")}</div>
        <DialogButton
          style={{ ...s.smallButton, padding: "2px 10px", fontSize: "13px", minHeight: 0 }}
          onClick={() => setShowSessions((v) => !v)}
        >
          {showSessions ? "Hide sessions" : "Sessions"} {showSessions ? <FaChevronUp size={10} /> : <FaChevronDown size={10} />}
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
