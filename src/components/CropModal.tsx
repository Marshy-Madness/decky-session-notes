import { FC, useEffect, useState } from "react";
import { DialogButton, Focusable, ModalRoot, SliderField, Spinner } from "@decky/ui";
import { FaCrop } from "react-icons/fa";
import { backend } from "../api/backend";
import { Screenshot } from "../types";
import { newId } from "../utils/format";
import { loadMedia } from "./MediaImage";

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

/** Crop a screenshot with four sliders (gamepad friendly). Saves a new image; the original is kept. */
export const CropModal: FC<{
  appId: string;
  shot: Screenshot;
  onCropped: (shot: Screenshot) => void;
  closeModal?: () => void;
}> = ({ appId, shot, onCropped, closeModal }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ left: 0, right: 0, top: 0, bottom: 0 });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadMedia(appId, shot.file).then(setSrc);
  }, [appId, shot.file]);

  const set = (key: keyof typeof crop) => (v: number) => setCrop((c) => ({ ...c, [key]: v }));

  const save = async () => {
    if (!src) return;
    setSaving(true);
    const img = await loadImage(src);
    const sx = (img.width * crop.left) / 100;
    const sy = (img.height * crop.top) / 100;
    const sw = img.width * (1 - (crop.left + crop.right) / 100);
    const sh = img.height * (1 - (crop.top + crop.bottom) / 100);
    const file = await backend.saveMediaData(appId, toJpeg(img, sx, sy, sw, sh), "jpg");
    const thumb = await backend.saveMediaData(appId, toJpeg(img, sx, sy, sw, sh, 320), "jpg");
    onCropped({ id: newId(), file, thumb, takenAt: shot.takenAt });
    closeModal?.();
  };

  const mask = "rgba(0,0,0,0.6)";
  return (
    <ModalRoot onCancel={closeModal} bAllowFullSize>
      <h2 style={{ marginTop: 0 }}>
        <FaCrop size={16} /> Crop screenshot
      </h2>
      {!src ? (
        <Spinner style={{ width: "32px" }} />
      ) : (
        <div style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
          <img src={src} style={{ display: "block", maxWidth: "100%", maxHeight: "38vh" }} />
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${crop.left}%`, background: mask }} />
          <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${crop.right}%`, background: mask }} />
          <div
            style={{
              position: "absolute",
              left: `${crop.left}%`,
              right: `${crop.right}%`,
              top: 0,
              height: `${crop.top}%`,
              background: mask,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `${crop.left}%`,
              right: `${crop.right}%`,
              bottom: 0,
              height: `${crop.bottom}%`,
              background: mask,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `${crop.left}%`,
              right: `${crop.right}%`,
              top: `${crop.top}%`,
              bottom: `${crop.bottom}%`,
              outline: "2px solid #1a9fff",
            }}
          />
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: "16px" }}>
        <SliderField label="Left" value={crop.left} min={0} max={45} step={1} onChange={set("left")} />
        <SliderField label="Right" value={crop.right} min={0} max={45} step={1} onChange={set("right")} />
        <SliderField label="Top" value={crop.top} min={0} max={45} step={1} onChange={set("top")} />
        <SliderField label="Bottom" value={crop.bottom} min={0} max={45} step={1} onChange={set("bottom")} />
      </div>
      <Focusable style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        <DialogButton onClick={save} disabled={!src || saving}>
          {saving ? "Saving…" : "Save crop"}
        </DialogButton>
        <DialogButton onClick={() => setCrop({ left: 0, right: 0, top: 0, bottom: 0 })}>Reset</DialogButton>
        <DialogButton onClick={closeModal}>Cancel</DialogButton>
      </Focusable>
    </ModalRoot>
  );
};
