import { FC, ReactNode, useEffect, useRef, useState } from "react";
import { Focusable, GamepadButton, GamepadEvent } from "@decky/ui";
import { addEventListener, removeEventListener } from "@decky/api";
import { FaArrowLeft, FaBookOpen, FaGamepad, FaGlobe, FaListUl, FaStickyNote, FaThumbtack } from "react-icons/fa";
import { backend } from "../api/backend";
import { closeNotesPage, setNotesPageMounted } from "../opening";
import { useRunningGame } from "../hooks/useAppLifetime";
import { useSettings } from "../state/notesStore";
import { deskGame } from "../state/deskGame";
import { recentlyOpened } from "../noteActions";
import { kindInfo } from "../utils/kinds";
import { ensureTheme } from "../theme";
import { useChromeHeights } from "../steamWindow";
import { Game, GameSummary, RadialItem } from "../types";
import { itemLabel, radialItems } from "./items";
import { goDesk, goNote, goNotes, goWeb, takeRadialCombo } from "./go";

// The radial menu: its own page, opened by the radial combo. Aim with the right stick (read from the
// controller by the backend) or the D-pad, then A (or let go of the combo). The current game's slot opens a
// second wheel of that game's notes. Which slots there are is set in Settings → Controls.

const SIZE = 460;
const RADIUS = 172;
const SLOT = 96;
const DEADZONE = 0.45;
const MAX_NOTES = 11; // plus "All notes"

interface Slot {
  key: string;
  icon: ReactNode;
  label: string;
  sub?: string;
  run: () => void;
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** A game's notes for its wheel: pinned first, then the ones opened lately, then the latest edited. */
function noteOrder(game: Game) {
  const recent = recentlyOpened(game.appId);
  const rank = (id: string) => {
    const i = recent.indexOf(id);
    return i < 0 ? recent.length : i;
  };
  return [...game.notes].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || rank(a.id) - rank(b.id) || b.updatedAt - a.updatedAt
  );
}

export const RadialPage: FC = () => {
  const settings = useSettings();
  const running = useRunningGame();
  const { header, footer } = useChromeHeights();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [ring, setRing] = useState<"main" | "game">("main");
  const [game, setGame] = useState<Game | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const aimed = useRef(false);

  useEffect(() => {
    ensureTheme();
    setNotesPageMounted(true);
    backend.listGames().then(setGames, () => setGames([]));
    return () => setNotesPageMounted(false);
  }, []);

  const lastPlayed = games && [...games].sort((a, b) => (b.lastLaunched ?? 0) - (a.lastLaunched ?? 0))[0];
  const gameId = running?.appId ?? deskGame.last ?? lastPlayed?.appId ?? null;
  const gameName = (id: string) => (id === running?.appId ? running.name : games?.find((g) => g.appId === id)?.name);

  const openGameRing = () => {
    if (!gameId) return;
    setRing("game");
    setSel(null);
    aimed.current = false;
    setGame(null);
    backend.getGame(gameId).then(setGame, () => setGame(null));
  };

  const mainSlot = (item: RadialItem, i: number): Slot | null => {
    const key = `${item.type}-${i}`;
    switch (item.type) {
      case "game":
        if (!gameId) return null;
        return { key, icon: <FaGamepad />, label: gameName(gameId) ?? "This game", sub: "Its notes", run: openGameRing };
      case "notes":
        return { key, icon: <FaStickyNote />, label: "Notes", run: () => goNotes(gameId) };
      case "desk":
        return { key, icon: <FaBookOpen />, label: "Desk", run: () => goDesk(gameId) };
      case "web":
        return { key, icon: <FaGlobe />, label: item.url ? host(item.url) : "Web Browser", run: () => goWeb(item.url) };
      case "note":
        return {
          key,
          icon: <FaThumbtack />,
          label: itemLabel(item),
          sub: gameName(item.appId) ?? item.gameName,
          run: () => goNote(item.appId, item.noteId),
        };
    }
  };

  const slots: Slot[] =
    ring === "main"
      ? radialItems(settings).flatMap((it, i) => mainSlot(it, i) ?? [])
      : [
          { key: "all", icon: <FaListUl />, label: "All notes", run: () => goNotes(gameId) },
          ...(game ? noteOrder(game).slice(0, MAX_NOTES) : []).map((n) => ({
            key: n.id,
            icon: n.pinned ? <FaThumbtack /> : <span>{kindInfo(n.kind).icon}</span>,
            label: n.title || "Untitled",
            run: () => goNote(game!.appId, n.id),
          })),
        ];

  const state = useRef({ slots, sel, ring });
  state.current = { slots, sel, ring };

  const pick = (i: number | null) => {
    const slot = i == null ? null : state.current.slots[i];
    slot?.run();
  };

  const back = () => {
    if (state.current.ring === "game") {
      setRing("main");
      setSel(null);
      aimed.current = false;
    } else closeNotesPage();
  };

  // Right stick, straight from the controller while the menu is up; letting go of the combo picks.
  useEffect(() => {
    backend.stickFeed(true).catch(() => {});
    const onStick = (x: number, y: number) => {
      const n = state.current.slots.length;
      const fx = x / 32767;
      const fy = y / 32767;
      if (!n || Math.hypot(fx, fy) < DEADZONE) return;
      let angle = Math.atan2(fx, fy); // 0 = up, clockwise
      if (angle < 0) angle += Math.PI * 2;
      aimed.current = true;
      setSel(Math.round(angle / ((Math.PI * 2) / n)) % n);
    };
    const held = new Set(takeRadialCombo());
    const onButtons = (names: string[]) => {
      if (!held.size || [...held].some((b) => names.includes(b))) return;
      held.clear();
      if (aimed.current && state.current.sel != null) pick(state.current.sel);
    };
    addEventListener("stick", onStick);
    addEventListener("buttons", onButtons);
    return () => {
      removeEventListener("stick", onStick);
      removeEventListener("buttons", onButtons);
      backend.stickFeed(false).catch(() => {});
    };
  }, []);

  // D-pad: the slot nearest that direction. L1/R1: one slot round.
  const nearest = (angle: number) => {
    const n = slots.length;
    if (!n) return null;
    return Math.round(angle / ((Math.PI * 2) / n)) % n;
  };
  const onDirection = (e: GamepadEvent) => {
    const angles: Partial<Record<number, number>> = {
      [GamepadButton.DIR_UP]: 0,
      [GamepadButton.DIR_RIGHT]: Math.PI / 2,
      [GamepadButton.DIR_DOWN]: Math.PI,
      [GamepadButton.DIR_LEFT]: (Math.PI * 3) / 2,
    };
    const a = angles[e.detail.button];
    if (a != null) setSel(nearest(a));
  };
  const step = (by: number) => {
    const n = slots.length;
    if (n) setSel((cur) => (cur == null ? (by > 0 ? 0 : n - 1) : (cur + by + n) % n));
  };
  const onButtonDown = (e: GamepadEvent) => {
    if (e.detail.button === GamepadButton.BUMPER_LEFT) step(-1);
    else if (e.detail.button === GamepadButton.BUMPER_RIGHT) step(1);
  };

  const current = sel != null ? slots[sel] : null;
  const title = ring === "game" ? gameName(gameId ?? "") ?? "This game" : "Desk of Madness";

  return (
    <div
      className="dom-root"
      style={{
        position: "absolute",
        inset: 0,
        paddingTop: `${header}px`,
        paddingBottom: `${footer}px`,
        background: "radial-gradient(circle, rgba(14,20,27,0.88) 0%, rgba(14,20,27,0.96) 70%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        color: "#f2f4f7",
      }}
    >
      <Focusable
        noFocusRing
        focusableIfNoChildren
        {...({ autoFocus: true } as any)}
        onGamepadDirection={onDirection}
        onButtonDown={onButtonDown}
        onOKButton={() => pick(state.current.sel)}
        onOKActionDescription="Open"
        onCancelButton={back}
        onCancelActionDescription={ring === "game" ? "Back" : "Close"}
        actionDescriptionMap={{ [GamepadButton.BUMPER_LEFT]: "Previous", [GamepadButton.BUMPER_RIGHT]: "Next" }}
        style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
      >
        <div style={{ fontSize: "18px", fontWeight: "bold", marginBottom: "4px", display: "flex", alignItems: "center", gap: "10px" }}>
          {ring === "game" && (
            <span onClick={back} style={{ cursor: "pointer", display: "inline-flex" }}>
              <FaArrowLeft />
            </span>
          )}
          {title}
        </div>
        <div style={{ position: "relative", width: `${SIZE}px`, height: `${SIZE}px` }}>
          <div
            style={{
              position: "absolute",
              inset: `${SLOT / 2 - 6}px`,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(26,159,255,0.10) 0%, rgba(255,255,255,0.05) 65%, rgba(255,255,255,0.03) 100%)",
              border: "1px solid rgba(255,255,255,0.14)",
            }}
          />
          {slots.map((slot, i) => {
            const a = (i / slots.length) * Math.PI * 2;
            const x = SIZE / 2 + Math.sin(a) * RADIUS;
            const y = SIZE / 2 - Math.cos(a) * RADIUS;
            const active = i === sel;
            return (
              <div
                key={slot.key}
                onClick={() => pick(i)}
                onMouseEnter={() => setSel(i)}
                style={{
                  position: "absolute",
                  left: `${x - SLOT / 2}px`,
                  top: `${y - SLOT / 2}px`,
                  width: `${SLOT}px`,
                  height: `${SLOT}px`,
                  borderRadius: "50%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  cursor: "pointer",
                  background: active ? "#1a9fff" : "rgba(40,48,60,0.95)",
                  border: active ? "3px solid #fff" : "2px solid rgba(255,255,255,0.25)",
                  transform: active ? "scale(1.12)" : undefined,
                  transition: "transform 80ms, background 80ms",
                  boxSizing: "border-box",
                }}
              >
                <span style={{ fontSize: "24px", lineHeight: 1, display: "inline-flex" }}>{slot.icon}</span>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: "bold",
                    maxWidth: `${SLOT - 10}px`,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {slot.label}
                </span>
              </div>
            );
          })}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: "190px",
              textAlign: "center",
            }}
          >
            {current ? (
              <>
                <div style={{ fontWeight: "bold", fontSize: "17px", overflowWrap: "anywhere" }}>{current.label}</div>
                {current.sub && <div style={{ fontSize: "13px", opacity: 0.8, marginTop: "4px" }}>{current.sub}</div>}
              </>
            ) : (
              <div style={{ fontSize: "14px", opacity: 0.8 }}>
                {ring === "game" && !game
                  ? "Loading notes…"
                  : slots.length
                    ? "Aim with the right stick or D-pad"
                    : "Nothing on the wheel. Add slots in Settings → Controls."}
              </div>
            )}
          </div>
        </div>
        <div style={{ fontSize: "13px", opacity: 0.75, marginTop: "6px" }}>
          Stick or D-pad: aim · L1/R1: next · A: open · B: {ring === "game" ? "back" : "close"}
        </div>
      </Focusable>
    </div>
  );
};
