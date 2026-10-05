import { cloneElement, createElement, FC, ReactElement, useEffect } from "react";
import { showModal } from "@decky/ui";
import { ChecklistItem, NoteKind, Recording, Screenshot } from "../types";
import { holdTrackpadMouse } from "../trackpads";
import { NotesPlace, setPlace } from "./place";

// Where you were in Session Notes, so closing it with the button combo and opening it again puts you back
// in the same place: same folder, same note open, and any unsaved edits still there. Kept in memory for as
// long as the plugin is loaded.

export interface EditorDraft {
  title: string;
  body: string;
  tags: string;
  folderId: string | null;
  screenshots: Screenshot[];
  checklist: ChecklistItem[];
  spoiler: boolean;
  kind: NoteKind;
  recordings: Recording[];
  /** Media added while editing, deleted again if the edit is cancelled. */
  added: (Screenshot | Recording)[];
}

export interface OpenNote {
  type: "view" | "edit";
  appId: string;
  /** null for a new note. */
  noteId: string | null;
  draft?: EditorDraft;
}

let open: OpenNote | null = null;
let modal: { Close(): void } | null = null;
let hiding = false;
const folders = new Map<string, string | null>();

export const lastFolder = (appId: string) => folders.get(appId) ?? null;
export const rememberFolder = (appId: string, folderId: string | null) => {
  folders.set(appId, folderId);
  setPlace({ appId, folderId });
};

/** Takes on a place read from the page's address: its folder, and the note to open once the list shows. */
export function seedFromPlace(p: NotesPlace) {
  if (!p.appId) return;
  folders.set(p.appId, p.folderId);
  if (p.note && !modal && !(open?.appId === p.appId && open.noteId === p.note.id && open.type === p.note.type)) {
    open = { type: p.note.type, appId: p.appId, noteId: p.note.id };
  }
}

/** The note to reopen for this game, if one was open when Session Notes was put away. */
export function noteToReopen(appId: string): OpenNote | null {
  return !modal && open?.appId === appId ? open : null;
}

export function saveDraft(draft: EditorDraft) {
  if (open?.type === "edit") open.draft = draft;
}

/** Forgets the open note once its window goes away, unless we're the ones closing it to put Session Notes away. */
const Tracked: FC<{ note: OpenNote; element: ReactElement; closeModal?: () => void }> = ({ note, element, closeModal }) => {
  useEffect(() => {
    const release = holdTrackpadMouse();
    return () => {
      release();
      if (open !== note) return; // another note's window has taken over (e.g. viewer → editor)
      modal = null;
      if (!hiding) {
        open = null;
        setPlace({ note: null });
      }
    };
  }, []);
  return cloneElement(element, { closeModal } as any);
};

/** Shows a note's viewer or editor, remembering it so it can come back. */
export function showNoteModal(note: OpenNote, element: ReactElement) {
  open = note;
  setPlace({ appId: note.appId, note: { type: note.type, id: note.noteId } });
  modal = showModal(createElement(Tracked, { note, element }));
}

/** Closes the open note (keeping it to reopen later). */
export function putAwayNote() {
  if (!modal) return;
  hiding = true;
  try {
    modal.Close();
  } finally {
    // The window unmounts a moment after Close(); keep the note until then.
    setTimeout(() => (hiding = false), 500);
  }
}
