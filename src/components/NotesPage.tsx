import { FC } from "react";
import { NotesBrowser } from "./QuickAccessPanel";

/** Full-screen Session Notes, opened from the main menu, the button combo or the Quick Access panel. */
export const NotesPage: FC = () => (
  <div style={{ marginTop: "40px", height: "calc(100% - 40px)", overflowY: "scroll" }}>
    <div style={{ maxWidth: "960px", margin: "0 auto", padding: "16px 24px 80px" }}>
      <div style={{ fontSize: "22px", fontWeight: "bold", marginBottom: "12px" }}>Session Notes</div>
      <NotesBrowser fullScreen />
    </div>
  </div>
);
