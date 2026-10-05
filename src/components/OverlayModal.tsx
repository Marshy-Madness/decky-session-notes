import { CSSProperties, FC, PointerEvent as ReactPointerEvent, ReactNode, useEffect, useRef, useState } from "react";
import { DialogButton, Focusable, GamepadEvent, ModalRoot, Navigation, QuickAccessTab, showModal, ToggleField } from "@decky/ui";
import { FaArrowUp, FaDotCircle, FaThumbtack } from "react-icons/fa";
import { backend } from "../api/backend";
import { getRunningGame, useRunningGame } from "../hooks/useAppLifetime";
import { closeNotesPage, isNotesPageShowing, openNotesPage } from "../opening";
import { getSettings, updateSettings } from "../state/notesStore";
import { OverlayPosition, Settings } from "../types";
import { gameArt } from "./Library";
import * as s from "./styles";

// Everything is laid out in the Deck's real screen pixels, then the stage scales it down, so what you see is
// where (and how big) MangoHud draws it. Keep boxSize in step with box_size in py_modules/overlay.py.
const SCREEN_W = 1280;
const SCREEN_H = 800;
const MARGIN = 10; // MangoHud's gap from the edge for its own spots
const STAGE_W = 528;
const STAGE_H = (STAGE_W * SCREEN_H) / SCREEN_W;
const DEFAULT_TEXT = 13;
const DEFAULT_OPACITY = 50;
// EGamepadButton direction codes → (dx, dy)
const DIRS: Record<number, [number, number]> = { 9: [0, -1], 10: [0, 1], 11: [-1, 0], 12: [1, 0] };

type Spot = { row: "top" | "middle" | "bottom"; col: "left" | "center" | "right"; label: string; turn: number | null };
const SPOTS: Spot[] = [
  { row: "top", col: "left", label: "Top left", turn: -45 },
  { row: "top", col: "center", label: "Top", turn: 0 },
  { row: "top", col: "right", label: "Top right", turn: 45 },
  { row: "middle", col: "left", label: "Left", turn: -90 },
  { row: "middle", col: "center", label: "Centre", turn: null },
  { row: "middle", col: "right", label: "Right", turn: 90 },
  { row: "bottom", col: "left", label: "Bottom left", turn: -135 },
  { row: "bottom", col: "center", label: "Bottom", turn: 180 },
  { row: "bottom", col: "right", label: "Bottom right", turn: 135 },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** MangoHud's window for just these lines: Unispace is monospaced, 5 px padding above and 11 below. */
function boxSize(lines: string[], text: number) {
  const longest = Math.max(10, ...lines.map((l) => l.length));
  return { w: Math.round(longest * text * 0.62) + 10, h: Math.round(5 + lines.length * (text - 2) + 11) };
}

function spotXY(spot: Pick<Spot, "row" | "col">, w: number, h: number) {
  const x = spot.col === "left" ? MARGIN : spot.col === "right" ? SCREEN_W - w - MARGIN : (SCREEN_W - w) / 2;
  const y = spot.row === "top" ? MARGIN : spot.row === "bottom" ? SCREEN_H - h - MARGIN : (SCREEN_H - h) / 2;
  return { x: Math.round(x), y: Math.round(y) };
}

function fromLegacy(position: OverlayPosition | undefined, w: number, h: number) {
  const [row, col] = (position ?? "top-left").split("-") as [Spot["row"], Spot["col"]];
  return spotXY({ row, col }, w, h);
}

/** The running game's latest screenshot if there is one, else its artwork. */
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

const Stepper: FC<{ label: string; value: string; onDown: () => void; onUp: () => void }> = ({ label, value, onDown, onUp }) => {
  const btn: CSSProperties = { ...s.smallButton, height: "32px", width: "36px", justifyContent: "center", padding: 0 };
  return (
    <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <div style={{ flex: 1, fontSize: "13px" }}>{label}</div>
      <DialogButton style={btn} onClick={onDown}>
        −
      </DialogButton>
      <div style={{ width: "44px", textAlign: "center", fontSize: "13px" }}>{value}</div>
      <DialogButton style={btn} onClick={onUp}>
        +
      </DialogButton>
    </Focusable>
  );
};

const Caption: FC<{ children: ReactNode }> = ({ children }) => (
  <div style={{ fontSize: "12px", opacity: 0.65, textTransform: "uppercase", marginTop: "4px" }}>{children}</div>
);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Opens the modal over a fresh picture of the game: in a game, Steam's menu is put away so the game is on
 * screen, gamescope takes a screenshot, and then the menu (the notes page or the side panel, whichever you
 * were in) comes back with the modal on top. The screenshot is deleted when the modal closes.
 */
export async function openOverlayModal() {
  let backdrop: string | null = null;
  if (getRunningGame()) {
    const onPage = isNotesPageShowing();
    if (onPage) closeNotesPage(); // keeps the open note, which comes back with the page
    else Navigation.CloseSideMenus();
    await wait(700); // Steam's menu fades out
    backdrop = await backend.captureBackdrop().catch(() => null);
    if (onPage) openNotesPage();
    else Navigation.OpenQuickAccessMenu(QuickAccessTab.Decky);
    await wait(400); // let the page (and its note window) open first, so the modal ends up on top
  }
  showModal(<OverlayModal settings={getSettings()} backdrop={backdrop ?? undefined} />);
}

/**
 * Where the pinned list sits on screen, and how it looks. Shows the real list (the pinned note, else this
 * game's latest checklist) at its real size over a picture of the game. Gamepad: snap it to a spot, or select
 * the picture, press A and move it with the D-pad. Touch: drag it. Nothing changes until you press Save.
 */
export const OverlayModal: FC<{ settings: Settings; backdrop?: string; closeModal?: () => void }> = ({
  settings,
  backdrop,
  closeModal,
}) => {
  const game = useRunningGame();
  const fallback = useGamePicture(backdrop ? undefined : game?.appId);
  const picture = backdrop ?? fallback;
  useEffect(
    () => () => {
      if (backdrop) backend.discardBackdrop().catch(() => {});
    },
    []
  );
  const [lines, setLines] = useState<string[] | null>(null);
  const [source, setSource] = useState<"pinned" | "note" | "sample">("sample");
  const [text, setText] = useState(settings.overlayTextSize ?? DEFAULT_TEXT);
  const [opacity, setOpacity] = useState(settings.overlayOpacity ?? DEFAULT_OPACITY);
  const [rounded, setRounded] = useState(settings.overlayRounded ?? false);
  const [hideStats, setHideStats] = useState(settings.overlayHideStats ?? false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(
    settings.overlayX != null && settings.overlayY != null ? { x: settings.overlayX, y: settings.overlayY } : null
  );
  const [moving, setMoving] = useState(false);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    backend
      .overlayPreview(game?.appId ?? "")
      .then((p) => {
        setLines(p.lines);
        setSource(p.source);
      })
      .catch(() => setLines(["[ To do ]  0/2 done", "  - Find the key", "  - Beat the boss"]));
  }, [game?.appId]);

  const shown = lines ?? [];
  const { w, h } = boxSize(shown.length ? shown : ["[ To do ]"], text);
  const place = (p: { x: number; y: number }) => ({ x: clamp(p.x, 0, SCREEN_W - w), y: clamp(p.y, 0, SCREEN_H - h) });
  // Before anything's been moved, start from the older 8-spot setting.
  const at = place(pos ?? fromLegacy(settings.overlayPosition, w, h));
  const scale = STAGE_W / SCREEN_W;

  const onDirection = (evt: GamepadEvent) => {
    const dir = DIRS[evt.detail.button];
    if (!moving || !dir) return false; // false = not handled, so the D-pad still moves focus
    const step = evt.detail.is_repeat ? 10 : 2;
    setPos(place({ x: at.x + dir[0] * step, y: at.y + dir[1] * step }));
    return true;
  };
  const onCancel = () => {
    if (!moving) return false;
    setMoving(false);
    return true;
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: at.x, y: at.y };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (d) setPos(place({ x: Math.round(d.x + (e.clientX - d.px) / scale), y: Math.round(d.y + (e.clientY - d.py) / scale) }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const save = () => {
    updateSettings({
      overlayX: at.x,
      overlayY: at.y,
      overlayTextSize: text,
      overlayOpacity: opacity,
      overlayRounded: rounded,
      overlayHideStats: hideStats,
    });
    closeModal?.();
  };
  const reset = () => {
    setPos(spotXY({ row: "top", col: "left" }, w, h));
    setText(DEFAULT_TEXT);
    setOpacity(DEFAULT_OPACITY);
    setRounded(false);
  };

  const spotButton: CSSProperties = { ...s.smallButton, height: "32px", flex: 1, justifyContent: "center", padding: 0 };
  const isAt = (spot: Spot) => {
    const p = spotXY(spot, w, h);
    return Math.abs(p.x - at.x) <= 1 && Math.abs(p.y - at.y) <= 1;
  };

  return (
    <ModalRoot onCancel={closeModal} bAllowFullSize>
      <h2 style={{ margin: "0 0 8px", display: "flex", alignItems: "center", gap: "8px" }}>
        <FaThumbtack size={16} /> Pinned list on screen
      </h2>
      <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
        <div style={{ flex: "0 0 auto", width: `${STAGE_W}px` }}>
          <Focusable
            onOKButton={() => setMoving((m) => !m)}
            onGamepadDirection={onDirection as any}
            onCancelButton={onCancel as any}
            onGamepadBlur={() => setMoving(false)}
            onOKActionDescription={moving ? "Done" : "Move it"}
            onCancelActionDescription={moving ? "Done" : undefined}
            style={{
              position: "relative",
              width: `${STAGE_W}px`,
              height: `${STAGE_H}px`,
              overflow: "hidden",
              borderRadius: "4px",
              outline: moving ? "2px solid #1a9fff" : undefined,
              background: picture ? `center / cover no-repeat url("${picture}")` : "linear-gradient(135deg, #2a3a4f, #10161f)",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: `${SCREEN_W}px`,
                height: `${SCREEN_H}px`,
                transform: `scale(${scale})`,
                transformOrigin: "0 0",
              }}
            >
              <div
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                style={{
                  position: "absolute",
                  left: `${at.x}px`,
                  top: `${at.y}px`,
                  width: `${w}px`,
                  height: `${h}px`,
                  boxSizing: "border-box",
                  padding: "5px",
                  background: `rgba(2, 2, 2, ${opacity / 100})`,
                  borderRadius: rounded ? "8px" : 0,
                  outline: moving ? "4px dashed #1a9fff" : undefined,
                  color: "#fff",
                  fontFamily: "monospace",
                  fontSize: `${text}px`,
                  lineHeight: `${text - 2}px`,
                  whiteSpace: "pre",
                  cursor: "move",
                  touchAction: "none",
                }}
              >
                {shown.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            </div>
          </Focusable>
          <div style={{ fontSize: "12px", opacity: 0.75, marginTop: "6px", lineHeight: 1.4 }}>
            {moving
              ? "D-pad moves it (hold for bigger steps). A or B when done."
              : "Select the picture and press A to move it, or drag it with your finger."}
            {!picture && " Start a game to see it over the game."}
            {source === "sample" && " Showing an example; pin a checklist to see your own."}
            {source === "note" && " Showing this game's latest checklist."}
            {!hideStats && " Steam's stats show above the list and push it down; hide them for exact placement."}
          </div>
          <ToggleField
            label="Hide Steam's performance stats"
            description="Only your list shows, not FPS and battery. The Performance Overlay still has to be on."
            checked={hideStats}
            onChange={setHideStats}
          />
          <ToggleField label="Rounded corners" checked={rounded} onChange={setRounded} />
        </div>

        <Focusable flow-children="column" style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
          <Caption>Snap to</Caption>
          <Focusable flow-children="column" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {[0, 3, 6].map((start) => (
              <Focusable key={start} flow-children="row" style={{ display: "flex", gap: "4px" }}>
                {SPOTS.slice(start, start + 3).map((spot) => (
                  <DialogButton
                    key={spot.label}
                    aria-label={spot.label}
                    style={{ ...spotButton, ...(isAt(spot) ? { background: "#1a9fff", color: "#fff" } : {}) }}
                    onClick={() => setPos(spotXY(spot, w, h))}
                  >
                    {spot.turn === null ? (
                      <FaDotCircle size={12} />
                    ) : (
                      <FaArrowUp size={12} style={{ transform: `rotate(${spot.turn}deg)` }} />
                    )}
                  </DialogButton>
                ))}
              </Focusable>
            ))}
          </Focusable>
          <div style={{ fontSize: "12px", opacity: 0.75 }}>
            {at.x}, {at.y} px · {w} × {h}
          </div>
          <Caption>Look</Caption>
          <Stepper label="Text size" value={`${text}px`} onDown={() => setText((t) => Math.max(10, t - 1))} onUp={() => setText((t) => Math.min(32, t + 1))} />
          <Stepper
            label="Background"
            value={`${opacity}%`}
            onDown={() => setOpacity((o) => Math.max(0, o - 10))}
            onUp={() => setOpacity((o) => Math.min(100, o + 10))}
          />
          <DialogButton style={{ ...s.primaryButton, height: "36px", justifyContent: "center", marginTop: "8px" }} onClick={save}>
            Save
          </DialogButton>
          <Focusable flow-children="row" style={{ display: "flex", gap: "6px" }}>
            <DialogButton style={{ ...s.smallButton, height: "32px", flex: 1, justifyContent: "center" }} onClick={reset}>
              Reset
            </DialogButton>
            <DialogButton style={{ ...s.smallButton, height: "32px", flex: 1, justifyContent: "center" }} onClick={closeModal}>
              Cancel
            </DialogButton>
          </Focusable>
        </Focusable>
      </div>
    </ModalRoot>
  );
};
