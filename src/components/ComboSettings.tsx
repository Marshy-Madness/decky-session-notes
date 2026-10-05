import { FC, useEffect, useRef } from "react";
import { DialogButton, Field, Focusable, ModalRoot, showModal } from "@decky/ui";
import { toaster } from "@decky/api";
import {
  Button,
  cancelRecordingCombo,
  comboLabel,
  DEFAULT_COMBOS,
  getCombo,
  MAX_COMBO,
  startRecordingCombo,
  useComboRecording,
} from "../combos";
import { getSettings, updateSettings, useSettings } from "../state/notesStore";
import { ComboAction } from "../types";
import { COMMANDS } from "../voice";
import * as s from "./styles";

const ACTION_NAMES: Record<ComboAction, string> = {
  open: "Open notes",
  dictate: "Speech to text",
  voice: "Voice command",
  tomes: "Tome wheel",
};

const IDLE_CANCEL_MS = 10_000;
const swallow = () => {}; // a handler that doesn't return false keeps the button from reaching Steam's menus

/** Hold the new combo, let go, done. Buttons don't do anything else while this is open. */
const RecordComboModal: FC<{ action: ComboAction; closeModal?: () => void }> = ({ action, closeModal }) => {
  const { preview } = useComboRecording();
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    startRecordingCombo(action, (combo) => {
      const clash = (Object.keys(ACTION_NAMES) as ComboAction[]).find(
        (other) => other !== action && comboLabel(getCombo(other)) === comboLabel(combo)
      );
      if (clash) {
        toaster.toast({ title: "Combo already used", body: `${comboLabel(combo)} is the ${ACTION_NAMES[clash]} combo.` });
      } else {
        save(action, combo);
        toaster.toast({ title: `${ACTION_NAMES[action]} combo`, body: comboLabel(combo), duration: 3000 });
      }
      closeModal?.();
    });
    return () => {
      clearTimeout(idle.current);
      cancelRecordingCombo();
    };
  }, []);

  // Nothing pressed for a while: give up, keeping the old combo.
  useEffect(() => {
    clearTimeout(idle.current);
    idle.current = setTimeout(() => closeModal?.(), IDLE_CANCEL_MS);
  }, [preview]);

  return (
    <ModalRoot onCancel={swallow} bAllowFullSize={false}>
      <Focusable
        noFocusRing
        onOKButton={swallow}
        onCancelButton={swallow}
        onSecondaryButton={swallow}
        onOptionsButton={swallow}
        onMenuButton={swallow}
        onGamepadDirection={swallow}
        style={{ textAlign: "center", padding: "8px 0" }}
      >
        <h2 style={{ margin: "0 0 8px" }}>New {ACTION_NAMES[action].toLowerCase()} combo</h2>
        <div style={{ fontSize: "14px", opacity: 0.8 }}>
          Hold up to {MAX_COMBO} buttons together, then let go.
        </div>
        <div style={{ fontSize: "22px", fontWeight: "bold", margin: "18px 0", minHeight: "30px" }}>
          {preview.length ? comboLabel(preview) : "Waiting for buttons…"}
        </div>
        <div style={{ fontSize: "12px", opacity: 0.65 }}>
          STEAM and ··· still open Steam's menus if pressed first, so hold another button before them. Nothing pressed for
          10 seconds cancels.
        </div>
      </Focusable>
      <DialogButton style={{ ...s.smallButton, marginTop: "12px" }} onClick={() => closeModal?.()}>
        Cancel
      </DialogButton>
    </ModalRoot>
  );
};

function save(action: ComboAction, combo: Button[]) {
  return updateSettings({ combos: { ...getSettings().combos, [action]: combo } });
}

/** One combo: what it is now, and buttons to change it, put it back, or turn it off. */
export const ComboRow: FC<{ action: ComboAction; label: string; description: string; canTurnOff?: boolean; disabled?: boolean }> = ({
  action,
  label,
  description,
  canTurnOff,
  disabled,
}) => {
  useSettings(); // re-render when the combo changes
  const combo = getCombo(action);
  const isDefault = comboLabel(combo) === comboLabel(DEFAULT_COMBOS[action]);
  return (
    <Field label={label} description={description} childrenLayout="below" disabled={disabled}>
      <Focusable style={s.toolbar} flow-children="row">
        <div style={{ fontWeight: "bold", fontSize: "15px", marginRight: "6px" }}>{comboLabel(combo)}</div>
        <DialogButton style={s.smallButton} disabled={disabled} onClick={() => showModal(<RecordComboModal action={action} />)}>
          Change
        </DialogButton>
        {!isDefault && (
          <DialogButton style={s.smallButton} disabled={disabled} onClick={() => save(action, DEFAULT_COMBOS[action])}>
            Default
          </DialogButton>
        )}
        {canTurnOff && combo && (
          <DialogButton style={s.smallButton} disabled={disabled} onClick={() => save(action, [])}>
            Turn off
          </DialogButton>
        )}
      </Focusable>
    </Field>
  );
};

/** Every voice command, for the Settings page. */
export const VoiceCommandList: FC = () => (
  <Focusable style={{ fontSize: "13px", padding: "4px 0" }}>
    {COMMANDS.map((c) => (
      <Focusable key={c.usage} onActivate={() => {}} style={{ padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontWeight: "bold" }}>“{c.usage}”</div>
        <div style={{ opacity: 0.75 }}>{c.does}</div>
        {c.say.length > 1 && (
          <div style={{ opacity: 0.55, fontSize: "12px" }}>
            Also: {c.say.filter((w) => w !== c.usage.split(" <")[0]).slice(0, 5).join(", ")}
          </div>
        )}
      </Focusable>
    ))}
  </Focusable>
);
