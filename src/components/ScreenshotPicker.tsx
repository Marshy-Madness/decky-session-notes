import { FC, useEffect, useState } from "react";
import { ModalRoot, DialogButton, Focusable, Spinner } from "@decky/ui";
import { FaCheckCircle } from "react-icons/fa";
import { backend } from "../api/backend";
import { Screenshot, SteamScreenshot } from "../types";
import { formatDateTime } from "../utils/format";
import { removeFromSteam } from "../utils/steamScreenshots";
import { getSettings } from "../state/notesStore";

export const ScreenshotPicker: FC<{
  appId: string;
  onAttach: (shots: Screenshot[]) => void;
  closeModal?: () => void;
}> = ({ appId, onAttach, closeModal }) => {
  const [shots, setShots] = useState<SteamScreenshot[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    backend.listSteamScreenshots(appId, 40).then(setShots);
  }, [appId]);

  const toggle = (path: string) =>
    setSelected((cur) => (cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path]));

  const attach = async () => {
    setBusy(true);
    const attached: Screenshot[] = [];
    for (const path of selected) attached.push(await backend.attachScreenshot(appId, path));
    if (getSettings().removeFromSteam) await removeFromSteam(appId, selected).catch(() => 0);
    onAttach(attached);
    closeModal?.();
  };

  return (
    <ModalRoot className="dom-modal" onCancel={closeModal} bAllowFullSize>
      <h2 style={{ marginTop: 0 }}>Attach screenshots</h2>
      {shots === null && <Spinner style={{ width: "32px" }} />}
      {shots?.length === 0 && (
        <div style={{ opacity: 0.8 }}>
          No screenshots for this game yet. Press <b>STEAM + R1</b> in-game to take one.
        </div>
      )}
      <Focusable
        flow-children="grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "8px",
          maxHeight: "55vh",
          overflowY: "auto",
          padding: "4px",
        }}
      >
        {shots?.map((shot) => {
          const isSelected = selected.includes(shot.path);
          return (
            <Focusable
              key={shot.path}
              onActivate={() => toggle(shot.path)}
              onClick={() => toggle(shot.path)}
              style={{
                position: "relative",
                borderRadius: "4px",
                outline: isSelected ? "3px solid #1a9fff" : "none",
              }}
            >
              <img src={shot.preview} style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block", borderRadius: "4px" }} />
              {isSelected && (
                <FaCheckCircle style={{ position: "absolute", top: "6px", right: "6px", color: "#1a9fff" }} size={20} />
              )}
              <div style={{ fontSize: "10px", opacity: 0.7, marginTop: "2px" }}>{formatDateTime(shot.takenAt)}</div>
            </Focusable>
          );
        })}
      </Focusable>
      <Focusable style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        <DialogButton disabled={selected.length === 0 || busy} onClick={attach}>
          {busy ? "Attaching…" : `Attach ${selected.length || ""}`}
        </DialogButton>
        <DialogButton onClick={closeModal}>Cancel</DialogButton>
      </Focusable>
    </ModalRoot>
  );
};
