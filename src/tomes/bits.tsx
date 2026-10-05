import { CSSProperties, FC, ReactNode } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { Game, Note } from "../types";
import * as s from "../components/styles";

// Small building blocks the Tomes share.

export const tomeRow: CSSProperties = { ...s.row, padding: "7px 10px", marginBottom: "4px", gap: "10px" };

/** A focusable line: A runs `onOpen`; Options runs `onOptions`. */
export const Line: FC<{
  icon?: ReactNode;
  label?: string;
  children: ReactNode;
  onOpen?: () => void;
  onOptions?: () => void;
  okLabel?: string;
  optionsLabel?: string;
  style?: CSSProperties;
}> = ({ icon, label, children, onOpen, onOptions, okLabel, optionsLabel, style }) => (
  <Focusable
    style={{ ...tomeRow, alignItems: "flex-start", ...style }}
    onActivate={onOpen ?? (() => {})}
    onClick={onOpen}
    onOptionsButton={onOptions}
    onOKActionDescription={okLabel}
    onOptionsActionDescription={optionsLabel}
  >
    {icon != null && <span style={{ flex: "0 0 auto", width: "20px", textAlign: "center", marginTop: "1px" }}>{icon}</span>}
    <div style={{ flex: 1, minWidth: 0 }}>
      {label && <div style={{ fontSize: "11px", fontWeight: "bold", letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.6 }}>{label}</div>}
      <div style={{ fontSize: "14px" }}>{children}</div>
    </div>
  </Focusable>
);

export const Buttons: FC<{ children: ReactNode; style?: CSSProperties }> = ({ children, style }) => (
  <Focusable flow-children="row" style={{ ...s.toolbar, marginBottom: 0, marginTop: "6px", ...style }}>
    {children}
  </Focusable>
);

export const Btn: FC<{ onClick: () => void; children: ReactNode; primary?: boolean; disabled?: boolean }> = ({ onClick, children, primary, disabled }) => (
  <DialogButton style={{ ...(primary ? s.primaryButton : s.smallButton), fontSize: "13px", padding: "5px 12px" }} onClick={onClick} disabled={disabled}>
    {children}
  </DialogButton>
);

export const Hint: FC<{ children: ReactNode }> = ({ children }) => (
  <div style={{ fontSize: "13px", opacity: 0.7, padding: "2px 0" }}>{children}</div>
);

export const ellipsis: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

export const byUpdated = (a: Note, b: Note) => b.updatedAt - a.updatedAt;

/** Unfinished checklist items across the game's notes: pinned notes first, then the most recently edited. */
export function openItems(game: Game) {
  return [...game.notes]
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || byUpdated(a, b))
    .flatMap((note) => (note.checklist ?? []).filter((i) => !i.done).map((item) => ({ note, item })));
}

export const allItems = (game: Game) => game.notes.flatMap((n) => n.checklist ?? []);
