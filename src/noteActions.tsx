import { ConfirmModal, showModal } from "@decky/ui";
import { backend } from "./api/backend";
import { NoteEditor, folderPath } from "./components/NoteEditor";
import { NoteViewer } from "./components/NoteViewer";
import { DeletedNotesModal, VersionHistoryModal } from "./components/VersionHistory";
import { emitDataChanged, getSettings, updateSettings } from "./state/notesStore";
import { EditorDraft, showNoteModal } from "./state/resume";
import { Game, Note, NoteKind, Screenshot } from "./types";

// Opening, editing and saving notes, shared by the notes list and the Desk's Tomes so both work on the same
// notes in the same way.

const RECENT_MAX = 12;

/** Remembers that a note was opened, for Game Brain's and the Guides Tome's "last used". */
export function noteOpened(appId: string, noteId: string) {
  const desk = getSettings().desk ?? {};
  const list = [noteId, ...(desk.recent?.[appId] ?? []).filter((id) => id !== noteId)].slice(0, RECENT_MAX);
  updateSettings({ desk: { ...desk, recent: { ...desk.recent, [appId]: list } } });
}

export const recentlyOpened = (appId: string): string[] => getSettings().desk?.recent?.[appId] ?? [];

export async function saveNote(appId: string, note: Note) {
  await backend.saveNote(appId, note);
  emitDataChanged();
}

export interface EditorOptions {
  folderId?: string | null;
  defaultKind?: NoteKind;
  draft?: EditorDraft;
  initialScreenshots?: Screenshot[];
}

/** The note editor; `note` null writes a new one. */
export function openEditor(game: Game, note: Note | null, opts: EditorOptions = {}) {
  showNoteModal(
    { type: "edit", appId: game.appId, noteId: note?.id ?? null, draft: opts.draft },
    <NoteEditor
      draft={opts.draft}
      appId={game.appId}
      note={note}
      folderId={opts.folderId ?? null}
      defaultKind={opts.defaultKind}
      initialScreenshots={opts.initialScreenshots}
      folders={game.folders}
      gameName={game.name}
      onSaved={emitDataChanged}
    />
  );
}

export function confirmDelete(appId: string, note: Note) {
  showModal(
    <ConfirmModal
      strTitle={`Delete "${note.title}"?`}
      strDescription="The note, its voice recordings and attached screenshots will be removed."
      strOKButtonText="Delete"
      bDestructiveWarning
      onOK={async () => {
        await backend.deleteNote(appId, note.id);
        emitDataChanged();
      }}
    />
  );
}

/** Reads a note (with its checklist, media and pin-to-screen). */
export function openNote(game: Game, note: Note) {
  const appId = game.appId;
  noteOpened(appId, note.id);
  showNoteModal(
    { type: "view", appId, noteId: note.id },
    <NoteViewer
      appId={appId}
      note={note}
      folderLabel={note.folderId ? folderPath(game.folders, note.folderId) : undefined}
      onEdit={() => openEditor(game, note)}
      onTogglePin={() => saveNote(appId, { ...note, pinned: !note.pinned })}
      onDelete={() => confirmDelete(appId, note)}
      onHistory={() => showModal(<VersionHistoryModal appId={appId} note={note} />)}
      onUpdate={(n) => saveNote(appId, n)}
    />
  );
}

export const openDeleted = (appId: string) => showModal(<DeletedNotesModal appId={appId} />);

/** Ticks a checklist item on or off, in the note itself. */
export function setChecklistItem(appId: string, note: Note, itemId: string, done: boolean) {
  const checklist = (note.checklist ?? []).map((i) => (i.id === itemId ? { ...i, done } : i));
  return saveNote(appId, { ...note, checklist });
}
