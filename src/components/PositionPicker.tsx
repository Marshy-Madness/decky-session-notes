import { FC, useEffect, useState } from "react";
import { Focusable } from "@decky/ui";
import { backend } from "../api/backend";
import { useRunningGame } from "../hooks/useAppLifetime";
import { OverlayPosition } from "../types";
import { gameArt } from "./Library";

// The 3 x 3 grid of spots; the middle has no Steam position, so it stays empty.
const GRID: (OverlayPosition | null)[][] = [
  ["top-left", "top-center", "top-right"],
  ["middle-left", null, "middle-right"],
  ["bottom-left", "bottom-center", "bottom-right"],
];

const LABELS: Record<OverlayPosition, string> = {
  "top-left": "Top left (Steam default)",
  "top-center": "Top center",
  "top-right": "Top right",
  "middle-left": "Middle left",
  "middle-right": "Middle right",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom center",
  "bottom-right": "Bottom right",
};

/** Where the running game's picture comes from: its latest screenshot if there is one, else its artwork. */
function useGamePicture(appId: string | undefined): string | undefined {
  const [shot, setShot] = useState<string | undefined>();
  useEffect(() => {
    setShot(undefined);
    if (!appId) return;
    let live = true;
    backend
      .listSteamScreenshots(appId, 1)
      .then((list) => live && setShot(list[0]?.preview))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [appId]);
  return shot ?? (appId ? gameArt(appId) : undefined);
}

/** A little copy of the pinned to-do list, drawn where it will sit on screen. */
const PinMock: FC<{ position: OverlayPosition }> = ({ position }) => {
  const [row, col] = position.split("-") as [string, string];
  return (
    <div
      style={{
        position: "absolute",
        ...(row === "top" ? { top: "4%" } : row === "bottom" ? { bottom: "4%" } : { top: "50%", transform: "translateY(-50%)" }),
        ...(col === "left" ? { left: "3%" } : col === "right" ? { right: "3%" } : { left: "50%", transform: "translateX(-50%)" }),
        background: "rgba(0, 0, 0, 0.7)",
        color: "#fff",
        fontFamily: "monospace",
        fontSize: "7px",
        lineHeight: 1.3,
        padding: "3px 5px",
        borderRadius: "2px",
        whiteSpace: "nowrap",
        pointerEvents: "none",
      }}
    >
      <div>[ To do ] 1/3 done</div>
      <div>&nbsp;&nbsp;- Find the key</div>
      <div>&nbsp;&nbsp;- Beat the boss</div>
    </div>
  );
};

/**
 * Picks where the pinned to-do list sits, on top of a picture of the running game so you can see what it
 * would cover. Each spot on the grid is a button; moving over one previews it, pressing it saves it.
 */
export const PositionPicker: FC<{ value: OverlayPosition; onChange: (p: OverlayPosition) => void }> = ({ value, onChange }) => {
  const game = useRunningGame();
  const picture = useGamePicture(game?.appId);
  const [focused, setFocused] = useState<OverlayPosition | null>(null);
  const shown = focused ?? value;

  return (
    <div style={{ padding: "6px 0" }}>
      <div style={{ marginBottom: "4px" }}>Position</div>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16 / 10",
          borderRadius: "4px",
          overflow: "hidden",
          background: picture ? `center / cover no-repeat url("${picture}")` : "linear-gradient(135deg, #2a3a4f, #10161f)",
        }}
      >
        {!picture && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", opacity: 0.6 }}>
            Start a game to see it here
          </div>
        )}
        <PinMock position={shown} />
        <Focusable
          flow-children="column"
          style={{ position: "absolute", inset: 0, display: "grid", gridTemplateRows: "repeat(3, 1fr)" }}
        >
          {GRID.map((row, r) => (
            <Focusable key={r} flow-children="row" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
              {row.map((spot, c) =>
                spot ? (
                  <Focusable
                    key={spot}
                    onActivate={() => onChange(spot)}
                    onClick={() => onChange(spot)}
                    onGamepadFocus={() => setFocused(spot)}
                    onGamepadBlur={() => setFocused((f) => (f === spot ? null : f))}
                    style={{
                      margin: "2px",
                      borderRadius: "3px",
                      border: focused === spot ? "2px solid #1a9fff" : spot === value ? "2px dashed rgba(255,255,255,0.6)" : "2px solid transparent",
                    }}
                  >
                    <span style={{ display: "none" }}>{LABELS[spot]}</span>
                  </Focusable>
                ) : (
                  <div key={`empty-${c}`} />
                )
              )}
            </Focusable>
          ))}
        </Focusable>
      </div>
      <div style={{ fontSize: "12px", opacity: 0.8, marginTop: "4px" }}>
        {focused && focused !== value ? `${LABELS[focused]}: press A to put it here` : `${LABELS[value]}. Steam's stats move with it if they're showing.`}
      </div>
    </div>
  );
};
