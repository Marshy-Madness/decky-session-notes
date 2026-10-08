import { FC, useEffect, useState } from "react";
import { NotesBrowser } from "./QuickAccessPanel";
import { setNotesPageMounted } from "../opening";
import { notesPageShowing, takePlaceFromAddress } from "../state/place";
import { seedFromPlace } from "../state/resume";
import { currentPath, useChromeHeights } from "../steamWindow";
import { useTrackpadMouse } from "../trackpads";
import { ensureTheme } from "../theme";

/** Full-screen Desk of Madness, opened from the main menu, the button combo or the Quick Access panel. */
export const NotesPage: FC = () => {
  // A place in the address (/desk-of-madness/all/123/note/abc) is taken on before the tabs first draw.
  useState(() => {
    const place = takePlaceFromAddress(currentPath());
    if (place) seedFromPlace(place);
  });
  useEffect(() => {
    ensureTheme();
    setNotesPageMounted(true);
    notesPageShowing(true);
    return () => {
      notesPageShowing(false);
      setNotesPageMounted(false);
    };
  }, []);
  useTrackpadMouse();
  // Steam's top bar (and its button-hint bar at the bottom) sit over the page; make room for whatever
  // height they have right now instead of assuming one.
  const { header, footer } = useChromeHeights();

  return (
    <div className="dom-root" style={{ marginTop: `${header}px`, height: `calc(100% - ${header}px)`, overflowY: "scroll", boxSizing: "border-box" }}>
      <div style={{ maxWidth: "1180px", margin: "0 auto", padding: `10px 24px ${footer + 40}px` }}>
        <div style={{ fontSize: "18px", fontWeight: "bold", marginBottom: "8px", opacity: 0.85 }}>Desk of Madness</div>
        <NotesBrowser fullScreen />
      </div>
    </div>
  );
};
