import { FC, ReactNode } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import { FaArrowDown, FaArrowUp, FaChevronDown, FaChevronRight, FaEyeSlash } from "react-icons/fa";
import { registerTomeElement } from "./wheel";
import * as s from "../components/styles";

const frame = {
  background: "rgba(255,255,255,0.035)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: "8px",
  padding: "8px 10px",
  marginBottom: "10px",
  breakInside: "avoid" as const,
};

const editButton = { ...s.iconButton, width: "36px", minWidth: "36px", height: "32px", fontSize: "13px" };

/** A Tome's box: a title bar (A folds it), and in edit mode buttons to move or hide it. */
export const TomeFrame: FC<{
  id: string;
  icon: string;
  name: string;
  collapsed: boolean;
  editing: boolean;
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onMove: (by: -1 | 1) => void;
  onHide: () => void;
  /** Shown on the right of the title bar (counts, badges). */
  extra?: ReactNode;
  children: ReactNode;
}> = ({ id, icon, name, collapsed, editing, isFirst, isLast, onToggle, onMove, onHide, extra, children }) => (
  <div ref={(el) => registerTomeElement(id, el)} style={frame}>
    <Focusable flow-children="row" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <Focusable
        data-tome-head
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "8px", padding: "4px 2px" }}
        onActivate={onToggle}
        onClick={onToggle}
        onOKActionDescription={collapsed ? "Unfold" : "Fold"}
      >
        <span style={{ fontSize: "16px" }}>{icon}</span>
        <span style={{ ...s.title, fontSize: "13px", letterSpacing: "0.05em", textTransform: "uppercase", opacity: 0.85 }}>{name}</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", opacity: 0.75 }}>
          {extra}
          {collapsed ? <FaChevronRight size={11} /> : <FaChevronDown size={11} />}
        </span>
      </Focusable>
      {editing && (
        <>
          <DialogButton style={editButton} disabled={isFirst} onClick={() => onMove(-1)} {...({ "aria-label": "Move up" } as any)}>
            <FaArrowUp />
          </DialogButton>
          <DialogButton style={editButton} disabled={isLast} onClick={() => onMove(1)} {...({ "aria-label": "Move down" } as any)}>
            <FaArrowDown />
          </DialogButton>
          <DialogButton style={editButton} onClick={onHide} {...({ "aria-label": "Take off the Desk" } as any)}>
            <FaEyeSlash />
          </DialogButton>
        </>
      )}
    </Focusable>
    {!collapsed && <div style={{ marginTop: "6px" }}>{children}</div>}
  </div>
);
