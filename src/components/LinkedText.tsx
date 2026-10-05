import { CSSProperties, FC } from "react";
import { Focusable } from "@decky/ui";
import { LinkSource, openLink, splitLinks } from "../browser";

/**
 * Note text with its web links as things you can select (A, a tap or the right trackpad), which open them in
 * Desk of Madness' browser. `beforeOpen` closes the window the text is in, when that isn't a tracked note.
 */
export const LinkedText: FC<{ text: string; from?: LinkSource; beforeOpen?: () => void; style?: CSSProperties }> = ({
  text,
  from,
  beforeOpen,
  style,
}) => {
  const parts = splitLinks(text);
  if (!parts.some((p) => p.url)) return <div style={style}>{text}</div>;
  const open = (url: string) => {
    beforeOpen?.();
    openLink(url, from);
  };
  return (
    <div style={style}>
      {parts.map((p, i) =>
        p.url ? (
          <Focusable
            key={i}
            onActivate={() => open(p.url!)}
            onClick={() => open(p.url!)}
            onOKActionDescription="Open link"
            style={{ display: "inline", color: "#59bfff", textDecoration: "underline", cursor: "pointer", overflowWrap: "anywhere" }}
          >
            {p.text}
          </Focusable>
        ) : (
          p.text
        )
      )}
    </div>
  );
};
