import { CSSProperties } from "react";

export const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "10px 12px",
  borderRadius: "6px",
  background: "rgba(255,255,255,0.04)",
  marginBottom: "6px",
};

export const title: CSSProperties = {
  fontWeight: "bold",
  fontSize: "15px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

export const subline: CSSProperties = {
  fontSize: "13px",
  opacity: 0.75,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  marginTop: "2px",
};

export const chipRow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "4px",
  marginTop: "6px",
};

export const chip: CSSProperties = {
  fontSize: "11px",
  padding: "1px 6px",
  borderRadius: "8px",
  background: "rgba(255,255,255,0.1)",
  opacity: 0.85,
  whiteSpace: "nowrap",
};

export const toolbar: CSSProperties = {
  display: "flex",
  flexWrap: "wrap", // the Quick Access menu is narrow; buttons go onto a second line instead of off screen
  gap: "6px",
  alignItems: "center",
  marginBottom: "8px",
};

export const smallButton: CSSProperties = {
  minWidth: 0,
  width: "auto",
  padding: "6px 12px",
  flex: "0 0 auto",
};
