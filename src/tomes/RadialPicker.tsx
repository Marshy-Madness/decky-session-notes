import { FC, useEffect, useRef, useState } from "react";
import { DialogButton, Focusable, GamepadButton, GamepadEvent, ModalRoot } from "@decky/ui";
import { addEventListener, removeEventListener } from "@decky/api";
import { backend } from "../api/backend";
import { CATEGORIES } from "./registry";
import { setCollapsed, setTomeOn, useArrangement } from "./layout";
import { jumpToTome } from "./wheel";
import * as s from "../components/styles";

// The Tome wheel: our own radial menu (plugins can't open Steam Input's). Aim with the right stick (read
// from the controller by the backend) or the D-pad; L1/R1 change the ring (category); A or letting go of
// the wheel's combo picks. Picking a Tome that's off puts it on the Desk.

const SIZE = 340;
const RADIUS = 125;
const DEADZONE = 0.45;

export const TomeWheelModal: FC<{ appId: string | null; combo?: string[]; closeModal?: () => void }> = ({ appId, combo, closeModal }) => {
  const { items } = useArrangement(appId);
  const [ring, setRing] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const aimed = useRef(false);
  const cat = CATEGORIES[ring];
  const tomes = items.filter((x) => x.def.category === cat.id);
  const state = useRef({ tomes, sel });
  state.current = { tomes, sel };

  const pick = (i: number | null) => {
    const item = i == null ? null : state.current.tomes[i];
    if (!item) return;
    if (!item.on) setTomeOn(appId, item.def.id, true);
    else if (item.collapsed) setCollapsed(appId, item.def.id, false);
    closeModal?.();
    jumpToTome(item.def.id);
  };

  const turnRing = (by: number) => {
    setRing((r) => (r + by + CATEGORIES.length) % CATEGORIES.length);
    setSel(null);
  };

  // Right stick, straight from the controller while the wheel is open.
  useEffect(() => {
    backend.stickFeed(true).catch(() => {});
    const onStick = (x: number, y: number) => {
      const n = state.current.tomes.length;
      const fx = x / 32767;
      const fy = y / 32767;
      if (!n || Math.hypot(fx, fy) < DEADZONE) return;
      let angle = Math.atan2(fx, fy); // 0 = up, clockwise
      if (angle < 0) angle += Math.PI * 2;
      aimed.current = true;
      setSel(Math.round(angle / ((Math.PI * 2) / n)) % n);
    };
    // Letting go of the combo that opened the wheel picks what's aimed at (if anything is).
    const held = new Set(combo ?? []);
    const onButtons = (names: string[]) => {
      if (!held.size) return;
      if ([...held].some((b) => names.includes(b))) return;
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

  const step = (by: number) => {
    const n = tomes.length;
    if (!n) return;
    setSel((cur) => (cur == null ? (by > 0 ? 0 : n - 1) : (cur + by + n) % n));
  };

  const onDirection = (e: GamepadEvent) => {
    const b = e.detail.button;
    if (b === GamepadButton.DIR_RIGHT || b === GamepadButton.DIR_DOWN) step(1);
    else if (b === GamepadButton.DIR_LEFT || b === GamepadButton.DIR_UP) step(-1);
  };
  const onButtonDown = (e: GamepadEvent) => {
    if (e.detail.button === GamepadButton.BUMPER_LEFT) turnRing(-1);
    else if (e.detail.button === GamepadButton.BUMPER_RIGHT) turnRing(1);
  };

  const current = sel != null ? tomes[sel] : null;

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal} bAllowFullSize={false}>
      <Focusable
        noFocusRing
        onGamepadDirection={onDirection}
        onButtonDown={onButtonDown}
        onOKButton={() => pick(sel)}
        onOKActionDescription="Go to Tome"
        actionDescriptionMap={{ [GamepadButton.BUMPER_LEFT]: "Previous ring", [GamepadButton.BUMPER_RIGHT]: "Next ring" }}
        style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
      >
        <div style={{ display: "flex", gap: "6px", marginBottom: "8px", fontSize: "13px" }}>
          {CATEGORIES.map((c, i) => (
            <span
              key={c.id}
              style={{ padding: "3px 10px", borderRadius: "10px", background: i === ring ? "#1a9fff" : "rgba(255,255,255,0.08)", opacity: i === ring ? 1 : 0.7 }}
            >
              {c.icon} {c.label}
            </span>
          ))}
        </div>
        <div style={{ position: "relative", width: `${SIZE}px`, height: `${SIZE}px` }}>
          <div
            style={{
              position: "absolute",
              inset: "20px",
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(26,159,255,0.08) 0%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.02) 100%)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          />
          {tomes.map((t, i) => {
            const a = (i / tomes.length) * Math.PI * 2;
            const x = SIZE / 2 + Math.sin(a) * RADIUS;
            const y = SIZE / 2 - Math.cos(a) * RADIUS;
            const active = i === sel;
            return (
              <div
                key={t.def.id}
                onClick={() => pick(i)}
                style={{
                  position: "absolute",
                  left: `${x - 30}px`,
                  top: `${y - 30}px`,
                  width: "60px",
                  height: "60px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: active ? "30px" : "24px",
                  background: active ? "#1a9fff" : t.on ? "rgba(26,159,255,0.25)" : "rgba(255,255,255,0.08)",
                  border: active ? "2px solid white" : "1px solid rgba(255,255,255,0.15)",
                  opacity: t.on || active ? 1 : 0.6,
                  transition: "all 80ms",
                }}
              >
                {t.def.icon}
              </div>
            );
          })}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: "150px",
              textAlign: "center",
            }}
          >
            {current ? (
              <>
                <div style={{ fontWeight: "bold", fontSize: "15px" }}>{current.def.name}</div>
                <div style={{ fontSize: "12px", opacity: 0.75, marginTop: "4px" }}>{current.on ? "On your Desk" : "Adds it to your Desk"}</div>
              </>
            ) : (
              <div style={{ fontSize: "12px", opacity: 0.7 }}>{tomes.length ? "Aim with the right stick or D-pad" : "No Tomes here yet"}</div>
            )}
          </div>
        </div>
        <div style={{ fontSize: "12px", opacity: 0.6, marginTop: "4px" }}>Stick or D-pad: aim · L1/R1: ring · A: go · B: close</div>
      </Focusable>
      <DialogButton style={{ ...s.smallButton, alignSelf: "center", marginTop: "8px" }} onClick={() => closeModal?.()}>
        Close
      </DialogButton>
    </ModalRoot>
  );
};
