import { FC } from "react";
import { PanelSectionRow } from "@decky/ui";
import { useNotesContext } from "../state/notesStore";

export const SessionList: FC = () => {
  const { sessions, notes } = useNotesContext();

  if (sessions.length === 0) {
    return <PanelSectionRow>No sessions logged yet.</PanelSectionRow>;
  }

  return (
    <>
      {[...sessions]
        .sort((a, b) => b.start - a.start)
        .map((session) => {
          const durationMinutes = ((session.end ?? Date.now()) - session.start) / 60000;
          const sessionNotes = notes.filter((n) => n.sessionId === session.id);
          return (
            <PanelSectionRow key={session.id}>
              <div>
                {new Date(session.start).toLocaleDateString()} — {durationMinutes.toFixed(0)}m
              </div>
              {session.moodRating && <div>{"⭐".repeat(session.moodRating)}</div>}
              {session.summary && <div style={{ opacity: 0.8 }}>{session.summary}</div>}
              <div style={{ fontSize: "0.8em", opacity: 0.6 }}>{sessionNotes.length} notes</div>
            </PanelSectionRow>
          );
        })}
    </>
  );
};
