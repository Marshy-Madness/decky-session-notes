import { FC, useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { CATEGORIES, TomeCategory } from "./registry";
import { setTomeOn, useArrangement } from "./layout";
import { jumpToTome } from "./wheel";
import * as s from "../components/styles";

/** Add or remove Tomes: category tabs, then a grid of tiles (A puts one on the Desk or takes it off). */
export const TomePickerModal: FC<{ appId: string | null; gameName?: string; closeModal?: () => void }> = ({ appId, gameName, closeModal }) => {
  const { items, perGame } = useArrangement(appId);
  const [cat, setCat] = useState<TomeCategory>("desk");
  const shown = items.filter((x) => x.def.category === cat);

  return (
    <ModalRoot onCancel={closeModal} closeModal={closeModal}>
      <h2 style={{ margin: "0 0 4px" }}>Tomes</h2>
      <div style={{ fontSize: "13px", opacity: 0.7, marginBottom: "10px" }}>
        {appId && perGame && gameName ? `Changes apply to ${gameName}'s Desk.` : "Changes apply to every game's Desk."}
      </div>
      <Focusable flow-children="row" style={{ ...s.toolbar, flexWrap: "nowrap" }}>
        {CATEGORIES.map((c) => (
          <DialogButton
            key={c.id}
            style={{ ...s.smallButton, flex: "1 1 0", justifyContent: "center", background: cat === c.id ? "#1a9fff" : undefined, color: cat === c.id ? "white" : undefined }}
            onClick={() => setCat(c.id)}
            onGamepadFocus={() => setCat(c.id)}
          >
            {c.icon} {c.label}
          </DialogButton>
        ))}
      </Focusable>
      <Focusable style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "8px", marginTop: "6px" }}>
        {shown.map(({ def, on }) => (
          <Focusable
            key={def.id}
            onActivate={() => setTomeOn(appId, def.id, !on)}
            onClick={() => setTomeOn(appId, def.id, !on)}
            onSecondaryButton={() => {
              if (!on) setTomeOn(appId, def.id, true);
              closeModal?.();
              jumpToTome(def.id);
            }}
            onOKActionDescription={on ? "Take off the Desk" : "Add to the Desk"}
            onSecondaryActionDescription="Go to it"
            style={{
              padding: "10px",
              borderRadius: "8px",
              minHeight: "86px",
              background: on ? "rgba(26,159,255,0.18)" : "rgba(255,255,255,0.05)",
              border: on ? "1px solid rgba(26,159,255,0.6)" : "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "22px" }}>{def.icon}</span>
              <span style={{ fontWeight: "bold", fontSize: "14px", flex: 1 }}>{def.name}</span>
              <span style={{ fontSize: "12px", opacity: on ? 1 : 0.5 }}>{on ? "✓ On" : "Off"}</span>
            </div>
            <div style={{ fontSize: "12px", opacity: 0.75, marginTop: "6px" }}>{def.description}</div>
            {def.scroll && <div style={{ fontSize: "12px", opacity: 0.6, marginTop: "4px" }}>📜 From {def.scroll}</div>}
          </Focusable>
        ))}
      </Focusable>
      <Focusable style={{ ...s.toolbar, marginTop: "12px" }}>
        <DialogButton style={s.primaryButton} onClick={() => closeModal?.()}>
          Done
        </DialogButton>
        <span style={{ fontSize: "12px", opacity: 0.6 }}>A: add / remove · X: go to it</span>
      </Focusable>
    </ModalRoot>
  );
};
