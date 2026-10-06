import { CSSProperties, FC, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { DialogButton, Focusable, GamepadEvent, ModalRoot, Spinner } from "@decky/ui";
import { FaCrop } from "react-icons/fa";
import { backend } from "../api/backend";
import { Screenshot } from "../types";
import { newId } from "../utils/format";
import { loadMedia } from "./MediaImage";
import { tint } from "./styles";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function toJpeg(img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number, maxWidth?: number): string {
  const scale = maxWidth && sw > maxWidth ? maxWidth / sw : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
}

/** Crop box as fractions (0–1) of the image. */
type Box = { x: number; y: number; w: number; h: number };
type Handle = "tl" | "br" | "move";

const FULL: Box = { x: 0, y: 0, w: 1, h: 1 };
const MIN = 0.05; // smallest crop, as a fraction of each side
const STAGE_W = 480; // the preview is fitted inside this box (px)
const STAGE_H = 290;
const HANDLES: { id: Handle; label: string }[] = [
  { id: "tl", label: "Top-left" },
  { id: "br", label: "Bottom-right" },
  { id: "move", label: "Move" },
];
const ASPECTS: { label: string; ratio: number | null }[] = [
  { label: "Free", ratio: null },
  { label: "16:9", ratio: 16 / 9 },
  { label: "4:3", ratio: 4 / 3 },
  { label: "1:1", ratio: 1 },
];
// EGamepadButton direction codes → (dx, dy)
const DIRS: Record<number, [number, number]> = { 9: [0, -1], 10: [0, 1], 11: [-1, 0], 12: [1, 0] };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Largest box of the given pixel ratio, centred on the current box. */
function fitAspect(box: Box, ratio: number, imgRatio: number): Box {
  const r = ratio / imgRatio; // the ratio in fraction units
  let w = 1;
  let h = w / r;
  if (h > 1) {
    h = 1;
    w = r;
  }
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}

/** Move one handle by (dx, dy) fractions, keeping the box inside the image and at the locked ratio, if any. */
function nudge(box: Box, handle: Handle, dx: number, dy: number, r: number | null): Box {
  if (handle === "move") {
    return { ...box, x: clamp(box.x + dx, 0, 1 - box.w), y: clamp(box.y + dy, 0, 1 - box.h) };
  }
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  if (r) {
    // Locked ratio: any direction grows or shrinks the box around the opposite corner.
    const sign = handle === "br" ? 1 : -1;
    const d = (Math.abs(dx) > Math.abs(dy) ? dx : dy * r) * sign;
    const maxW = handle === "br" ? Math.min(1 - box.x, (1 - box.y) * r) : Math.min(right, bottom * r);
    const w = clamp(box.w + d, Math.max(MIN, MIN * r), maxW);
    const h = w / r;
    return handle === "br" ? { ...box, w, h } : { x: right - w, y: bottom - h, w, h };
  }
  if (handle === "tl") {
    const x = clamp(box.x + dx, 0, right - MIN);
    const y = clamp(box.y + dy, 0, bottom - MIN);
    return { x, y, w: right - x, h: bottom - y };
  }
  return { ...box, w: clamp(box.w + dx, MIN, 1 - box.x), h: clamp(box.h + dy, MIN, 1 - box.y) };
}

/**
 * Crop a screenshot. Gamepad: focus the picture and press A, then the D-pad moves the selected handle,
 * X switches handle and B finishes. Touch: drag a corner or the box. Saves a new image; the original is kept.
 */
export const CropModal: FC<{
  appId: string;
  shot: Screenshot;
  onCropped: (shot: Screenshot) => void;
  closeModal?: () => void;
}> = ({ appId, shot, onCropped, closeModal }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<Box>(FULL);
  const [handle, setHandle] = useState<Handle>("br");
  const [aspect, setAspect] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ handle: Handle; px: number; py: number; start: Box } | null>(null);

  useEffect(() => {
    loadMedia(appId, shot.file).then((s) => {
      setSrc(s);
      if (s) loadImage(s).then((img) => setNatural({ w: img.naturalWidth, h: img.naturalHeight }));
    });
  }, [appId, shot.file]);

  const imgRatio = natural ? natural.w / natural.h : 16 / 9;
  // Size the stage to the picture's exact shape so the crop overlay lines up with the image.
  const scale = natural ? Math.min(STAGE_W / natural.w, STAGE_H / natural.h) : 1;
  const stageW = natural ? Math.round(natural.w * scale) : STAGE_W;
  const stageH = natural ? Math.round(natural.h * scale) : STAGE_H;
  const r = aspect ? aspect / imgRatio : null;

  const chooseAspect = (ratio: number | null) => {
    setAspect(ratio);
    if (ratio) setBox((b) => fitAspect(b, ratio, imgRatio));
  };

  // Steam's nav treats a handler that returns false as "not handled", so the D-pad and B keep working normally.
  const onDirection = (evt: GamepadEvent) => {
    const dir = DIRS[evt.detail.button];
    if (!editing || !dir) return false;
    const step = evt.detail.is_repeat ? 0.02 : 0.01;
    setBox((b) => nudge(b, handle, dir[0] * step, dir[1] * step, r));
    return true;
  };
  const onCancel = () => {
    if (!editing) return false;
    setEditing(false);
    return true;
  };
  const cycleHandle = () => setHandle((h) => HANDLES[(HANDLES.findIndex((x) => x.id === h) + 1) % HANDLES.length].id);

  const onPointerDown = (h: Handle) => (e: ReactPointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle: h, px: e.clientX, py: e.clientY, start: box };
    setHandle(h);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (d) setBox(nudge(d.start, d.handle, (e.clientX - d.px) / stageW, (e.clientY - d.py) / stageH, r));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const save = async () => {
    if (!src) return;
    setSaving(true);
    const img = await loadImage(src);
    const sx = Math.round(img.width * box.x);
    const sy = Math.round(img.height * box.y);
    const sw = Math.round(img.width * box.w);
    const sh = Math.round(img.height * box.h);
    const file = await backend.saveMediaData(appId, toJpeg(img, sx, sy, sw, sh), "jpg");
    const thumb = await backend.saveMediaData(appId, toJpeg(img, sx, sy, sw, sh, 320), "jpg");
    onCropped({ id: newId(), file, thumb, takenAt: shot.takenAt });
    closeModal?.();
  };

  const pct = (v: number) => `${v * 100}%`;
  const knob = (h: Handle, pos: CSSProperties) => (
    <div
      onPointerDown={onPointerDown(h)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: "absolute",
        width: "18px",
        height: "18px",
        margin: "-9px",
        borderRadius: "50%",
        background: handle === h ? "#1a9fff" : "#fff",
        border: "2px solid #0b1520",
        boxShadow: handle === h && editing ? "0 0 0 4px rgba(26,159,255,0.45)" : undefined,
        touchAction: "none",
        ...pos,
      }}
    />
  );
  const third = (style: CSSProperties) => (
    <div style={{ position: "absolute", background: "rgba(255,255,255,0.25)", pointerEvents: "none", ...style }} />
  );
  const small: CSSProperties = { minWidth: 0, padding: "6px 8px", fontSize: "12px" };
  const selected = (on: boolean): CSSProperties => (on ? tint("#1a9fff") : {});
  const caption: CSSProperties = { fontSize: "11px", opacity: 0.6, textTransform: "uppercase" };

  return (
    <ModalRoot className="dom-modal" onCancel={closeModal} bAllowFullSize>
      <h2 style={{ margin: "0 0 8px" }}>
        <FaCrop size={16} /> Crop screenshot
      </h2>
      <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
        <Focusable
          onOKButton={() => setEditing((e) => !e)}
          onGamepadDirection={onDirection as any}
          onSecondaryButton={cycleHandle}
          onCancelButton={onCancel as any}
          onGamepadBlur={() => setEditing(false)}
          onOKActionDescription={editing ? "Done" : "Adjust crop"}
          onSecondaryActionDescription={editing ? "Switch handle" : undefined}
          onCancelActionDescription={editing ? "Done" : undefined}
          style={{
            flex: "0 0 auto",
            width: `${stageW}px`,
            height: `${stageH}px`,
            position: "relative",
            overflow: "hidden",
            borderRadius: "4px",
            background: "#000",
            outline: editing ? "2px solid #1a9fff" : undefined,
          }}
        >
          {!src || !natural ? (
            <Spinner style={{ width: "32px", margin: "auto", position: "absolute", inset: 0 }} />
          ) : (
            <>
              <img src={src} draggable={false} style={{ display: "block", width: "100%", height: "100%" }} />
              <div
                onPointerDown={onPointerDown("move")}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                style={{
                  position: "absolute",
                  left: pct(box.x),
                  top: pct(box.y),
                  width: pct(box.w),
                  height: pct(box.h),
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
                  outline: `2px solid ${handle === "move" && editing ? "#1a9fff" : "#fff"}`,
                  touchAction: "none",
                }}
              >
                {third({ left: "33.3%", top: 0, bottom: 0, width: "1px" })}
                {third({ left: "66.6%", top: 0, bottom: 0, width: "1px" })}
                {third({ top: "33.3%", left: 0, right: 0, height: "1px" })}
                {third({ top: "66.6%", left: 0, right: 0, height: "1px" })}
                {knob("tl", { left: 0, top: 0 })}
                {knob("br", { right: 0, bottom: 0 })}
              </div>
            </>
          )}
        </Focusable>

        <Focusable
          flow-children="column"
          style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}
        >
          <div style={{ fontSize: "12px", opacity: 0.75, lineHeight: 1.4 }}>
            {editing
              ? "D-pad moves the highlighted handle. X switches handle, B when done."
              : "Select the picture and press A to adjust it, or drag it with your finger."}
          </div>
          <div style={caption}>Handle</div>
          <Focusable flow-children="row" style={{ display: "flex", gap: "4px" }}>
            {HANDLES.map((h) => (
              <DialogButton key={h.id} style={{ ...small, ...selected(handle === h.id) }} onClick={() => setHandle(h.id)}>
                {h.label}
              </DialogButton>
            ))}
          </Focusable>
          <div style={caption}>Aspect</div>
          <Focusable flow-children="row" style={{ display: "flex", gap: "4px" }}>
            {ASPECTS.map((a) => (
              <DialogButton
                key={a.label}
                style={{ ...small, ...selected(aspect === a.ratio) }}
                onClick={() => chooseAspect(a.ratio)}
              >
                {a.label}
              </DialogButton>
            ))}
          </Focusable>
          {natural && (
            <div style={{ fontSize: "12px", opacity: 0.75 }}>
              {Math.round(natural.w * box.w)} × {Math.round(natural.h * box.h)} px
            </div>
          )}
          <DialogButton onClick={save} disabled={!natural || saving}>
            {saving ? "Saving…" : "Save crop"}
          </DialogButton>
          <Focusable flow-children="row" style={{ display: "flex", gap: "4px" }}>
            <DialogButton
              style={small}
              onClick={() => {
                setBox(FULL);
                setAspect(null);
              }}
            >
              Reset
            </DialogButton>
            <DialogButton style={small} onClick={closeModal}>
              Cancel
            </DialogButton>
          </Focusable>
        </Focusable>
      </div>
    </ModalRoot>
  );
};
