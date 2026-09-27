import { FC } from "react";
import { PanelSectionRow } from "@decky/ui";
import { useNotesContext } from "../state/notesStore";

export const StatsView: FC = () => {
  const { notes, sessions } = useNotesContext();

  const deathCount = notes.filter((n) => n.type === "death").length;
  const totalMinutes = sessions.reduce((sum, s) => sum + ((s.end ?? Date.now()) - s.start) / 60000, 0);
  const ratedSessions = sessions.filter((s) => s.moodRating);
  const avgMood = ratedSessions.length
    ? ratedSessions.reduce((sum, s) => sum + (s.moodRating ?? 0), 0) / ratedSessions.length
    : null;

  return (
    <>
      <PanelSectionRow>Deaths: {deathCount}</PanelSectionRow>
      <PanelSectionRow>Total playtime logged: {totalMinutes.toFixed(0)}m</PanelSectionRow>
      <PanelSectionRow>Average mood: {avgMood ? `${avgMood.toFixed(1)} / 5` : "—"}</PanelSectionRow>
    </>
  );
};
