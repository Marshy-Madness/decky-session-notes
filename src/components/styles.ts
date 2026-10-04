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
  fontSize: "14px",
  opacity: 0.8,
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
  fontSize: "12px",
  padding: "2px 8px",
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

// Explicit margin/alignment: Steam's and themes' DialogButton rules otherwise stagger buttons in a row.
export const smallButton: CSSProperties = {
  minWidth: 0,
  width: "auto",
  margin: 0,
  alignSelf: "center",
  padding: "6px 12px",
  flex: "0 0 auto",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  whiteSpace: "nowrap",
};

export const primaryButton: CSSProperties = {
  ...smallButton,
  background: "#1a9fff",
  color: "white",
  fontWeight: "bold",
};

export const sectionLabel: CSSProperties = {
  fontSize: "12px",
  fontWeight: "bold",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  opacity: 0.6,
  margin: "14px 0 6px",
};
