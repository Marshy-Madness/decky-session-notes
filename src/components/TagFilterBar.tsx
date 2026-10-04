import { FC } from "react";
import { DialogButton, Focusable } from "@decky/ui";
import * as s from "./styles";

export const TagFilterBar: FC<{
  allTags: string[];
  activeTags: string[];
  onChange: (tags: string[]) => void;
}> = ({ allTags, activeTags, onChange }) => {
  if (allTags.length === 0) return null;

  const toggle = (tag: string) => {
    onChange(activeTags.includes(tag) ? activeTags.filter((t) => t !== tag) : [...activeTags, tag]);
  };

  return (
    <Focusable flow-children="row" style={{ ...s.toolbar, flexWrap: "wrap" }}>
      {allTags.map((tag) => (
        <DialogButton
          key={tag}
          style={{ ...s.smallButton, padding: "2px 10px", fontSize: "12px", opacity: activeTags.includes(tag) ? 1 : 0.7 }}
          onClick={() => toggle(tag)}
        >
          {activeTags.includes(tag) ? `✓ #${tag}` : `#${tag}`}
        </DialogButton>
      ))}
    </Focusable>
  );
};
