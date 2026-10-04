import { FC, useEffect } from "react";
import { NotesBrowser } from "./QuickAccessPanel";

// Lets the button combo close the page again instead of opening it twice.
let pageOpen = false;
export const isNotesPageOpen = () => pageOpen;

/** Full-screen Session Notes, opened from the main menu or the button combo. */
export const NotesPage: FC = () => {
  useEffect(() => {
    pageOpen = true;
    return () => {
      pageOpen = false;
    };
  }, []);

  return (
    <div style={{ marginTop: "40px", height: "calc(100% - 40px)", overflowY: "scroll" }}>
      <div style={{ maxWidth: "960px", margin: "0 auto", padding: "16px 24px 80px" }}>
        <div style={{ fontSize: "22px", fontWeight: "bold", marginBottom: "12px" }}>Session Notes</div>
        <NotesBrowser />
      </div>
    </div>
  );
};
