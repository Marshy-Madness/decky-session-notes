import { FC } from "react";
import { DialogButton, Field, Focusable } from "@decky/ui";
import { FaArrowDown, FaArrowUp, FaBookOpen, FaGamepad, FaGlobe, FaStickyNote, FaThumbtack, FaTimes } from "react-icons/fa";
import { useSettings } from "../state/notesStore";
import { RadialItem } from "../types";
import { addItem, BUILT_IN, itemDescription, itemLabel, MAX_ITEMS, moveItem, radialItems, removeItem, resetItems, sameItem } from "./items";
import * as s from "../components/styles";

export const itemIcon = (item: RadialItem) =>
  ({ game: <FaGamepad />, notes: <FaStickyNote />, desk: <FaBookOpen />, web: <FaGlobe />, note: <FaThumbtack /> })[item.type];

const small = { ...s.iconButton, width: "36px", minWidth: "36px", height: "34px", fontSize: "14px" };

/** The radial menu's slots, clockwise from the top: reorder, remove, add the built-in ones back. */
export const RadialItemsEditor: FC = () => {
  const settings = useSettings();
  const items = radialItems(settings);
  const missing = BUILT_IN.filter((b) => !items.some((x) => sameItem(x, b)));
  return (
    <Field
      label="On the wheel"
      description={`Clockwise from the top. Up to ${MAX_ITEMS}. To pin a note, open it and press Add to radial.`}
      childrenLayout="below"
    >
      <div style={{ width: "100%" }}>
        {items.map((item, i) => (
          <Focusable
            key={item.type === "note" ? item.noteId : item.type}
            flow-children="row"
            style={{ ...s.row, padding: "6px 8px", gap: "6px" }}
          >
            <span style={{ display: "inline-flex", fontSize: "16px" }}>{itemIcon(item)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={s.title}>{itemLabel(item)}</div>
              <div style={{ ...s.subline, fontSize: "12px" }}>{itemDescription(item)}</div>
            </div>
            <DialogButton style={small} disabled={i === 0} onClick={() => moveItem(i, -1)} {...({ "aria-label": "Move up" } as any)}>
              <FaArrowUp />
            </DialogButton>
            <DialogButton
              style={small}
              disabled={i === items.length - 1}
              onClick={() => moveItem(i, 1)}
              {...({ "aria-label": "Move down" } as any)}
            >
              <FaArrowDown />
            </DialogButton>
            <DialogButton style={small} onClick={() => removeItem(i)} {...({ "aria-label": "Remove" } as any)}>
              <FaTimes />
            </DialogButton>
          </Focusable>
        ))}
        {items.length === 0 && <div style={{ fontSize: "13px", opacity: 0.8, padding: "4px 0" }}>The wheel is empty.</div>}
        <Focusable style={{ ...s.toolbar, marginTop: "6px" }}>
          {missing.map((b) => (
            <DialogButton key={b.type} style={s.smallButton} onClick={() => addItem(b)}>
              {itemIcon(b)} Add {itemLabel(b)}
            </DialogButton>
          ))}
          {settings.radial?.items && (
            <DialogButton style={s.smallButton} onClick={resetItems}>
              Reset wheel
            </DialogButton>
          )}
        </Focusable>
      </div>
    </Field>
  );
};
