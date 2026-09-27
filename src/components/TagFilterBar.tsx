import { FC } from "react";
import { PanelSectionRow, ButtonItem, Focusable } from "@decky/ui";

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
    <PanelSectionRow>
      <Focusable style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
        {allTags.map((tag) => (
          <ButtonItem key={tag} layout="below" onClick={() => toggle(tag)}>
            {activeTags.includes(tag) ? `✓ #${tag}` : `#${tag}`}
          </ButtonItem>
        ))}
      </Focusable>
    </PanelSectionRow>
  );
};
