import { FC } from "react";
import { Session } from "../types";
import { formatDateTime, formatDuration } from "../utils/format";
import * as s from "./styles";

export const SessionList: FC<{ sessions: Session[]; limit?: number }> = ({ sessions, limit = 10 }) => {
  const recent = [...sessions].sort((a, b) => b.start - a.start).slice(0, limit);
  if (recent.length === 0) return <div style={{ opacity: 0.7 }}>No play sessions logged yet.</div>;

  return (
    <div style={{ fontSize: "13px" }}>
      {recent.map((session, i) => (
        <div key={session.id} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", opacity: 0.85 }}>
          <span>
            #{sessions.length - i} · {formatDateTime(session.start)}
          </span>
          <span style={s.chip}>
            {session.end ? formatDuration((session.end - session.start) / 1000) : "playing now"}
          </span>
        </div>
      ))}
    </div>
  );
};
