import { NoteKind } from "../types";

export const KINDS: { kind: NoteKind; label: string; icon: string }[] = [
  { kind: "note", label: "Note", icon: "📝" },
  { kind: "guide", label: "Guide", icon: "📘" },
  { kind: "tip", label: "Tip", icon: "💡" },
  { kind: "walkthrough", label: "Walkthrough", icon: "🧭" },
  { kind: "boss", label: "Boss strategy", icon: "⚔️" },
  { kind: "build", label: "Build / loadout", icon: "🛡️" },
  { kind: "collectibles", label: "Collectibles / map", icon: "🗺️" },
  { kind: "secret", label: "Secret / easter egg", icon: "🔮" },
  { kind: "settings", label: "Deck settings", icon: "⚙️" },
  { kind: "achievement", label: "Achievement guide", icon: "🏆" },
];

export const kindInfo = (kind?: NoteKind) => KINDS.find((k) => k.kind === (kind ?? "note")) ?? KINDS[0];

/** Kinds that live in the virtual "Guides" folder. */
export const GUIDE_KINDS: NoteKind[] = ["guide", "walkthrough", "achievement"];
export const isGuide = (kind?: NoteKind) => !!kind && GUIDE_KINDS.includes(kind);
