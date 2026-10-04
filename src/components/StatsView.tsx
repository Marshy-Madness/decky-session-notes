import { FC, useState } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { FaChevronDown, FaChevronUp } from "react-icons/fa";
import { Game } from "../types";
import { formatDuration, formatWhen, plural } from "../utils/format";
import { SessionList } from "./SessionList";
import * as s from "./styles";

/** Game header: name plus launch/playtime/note stats, with an expandable session history. */
export const StatsView: FC<{ game: Game; live?: boolean }> = ({ game, live }) => {
  const [showSessions, setShowSessions] = useState(false);
  const sum = game.summary;

  const stats = [
    `Played ${formatDuration(sum.playtimeSeconds)}`,
    `${sum.launchCount}× launched`,
    `Last played ${formatWhen(sum.lastLaunched)}`,
    plural(sum.noteCount, "note"),
  ];

  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{ ...s.title, fontSize: "20px", flex: 1 }}>{game.name}</div>
        {live && <span style={{ ...s.chip, background: "#2d7d2d", opacity: 1 }}>● Playing now</span>}
      </div>
      <Focusable style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 12px", marginTop: "4px" }}>
        <div style={{ fontSize: "14px", opacity: 0.8 }}>{stats.join("  ·  ")}</div>
        <DialogButton
          style={{ ...s.smallButton, padding: "2px 10px", fontSize: "13px", minHeight: 0 }}
          onClick={() => setShowSessions((v) => !v)}
        >
          {showSessions ? "Hide sessions" : "Session history"} {showSessions ? <FaChevronUp size={10} /> : <FaChevronDown size={10} />}
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
