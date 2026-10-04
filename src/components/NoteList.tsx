import { FC, useEffect, useState } from "react";
import {
  ConfirmModal,
  DialogButton,
  Dropdown,
  Focusable,
  Menu,
  MenuItem,
  Spinner,
  TextField,
  showContextMenu,
  showModal,
} from "@decky/ui";
import { FaBook, FaUserFriends, FaArrowLeft, FaTrashRestore, FaCamera, FaFolder, FaFolderPlus, FaPlus, FaSkull } from "react-icons/fa";
import { backend } from "../api/backend";
import { useGame } from "../state/NotesProvider";
import { emitDataChanged, updateSettings, useSettings } from "../state/notesStore";
import { Folder, Note, SortMode } from "../types";
import { SORT_LABELS, newId, sortNotes } from "../utils/format";
import { KINDS, isGuide } from "../utils/kinds";
import { SharedNoteViewer } from "./SharedNotes";
import { ShareModal } from "./ShareModal";
import { PublishModal } from "./Bookstore";
import { NoteItem } from "./NoteItem";
import { NoteEditor, folderPath } from "./NoteEditor";
import { NoteViewer } from "./NoteViewer";
import { StatsView } from "./StatsView";
import { TagFilterBar } from "./TagFilterBar";
import { NameModal } from "./NameModal";
import { LeftOffCard } from "./LeftOffCard";
import { Counters, addCounter } from "./Counters";
import { AttachScreenshotsModal } from "./AttachScreenshotsModal";
import { DeletedNotesModal, VersionHistoryModal } from "./VersionHistory";
import { usePendingScreenshots } from "../state/pendingScreenshots";
import { lastFolder, noteToReopen, rememberFolder, showNoteModal, EditorDraft } from "../state/resume";
import * as s from "./styles";

const GUIDES = "__guides";
const SHARED = "__shared";

const SORT_OPTIONS = (Object.keys(SORT_LABELS) as SortMode[]).map((k) => ({ label: SORT_LABELS[k], data: k }));

/** All folders and notes for one game (the game comes from NotesProvider). */
export const NoteList: FC<{ live?: boolean; onBack?: () => void }> = ({ live, onBack }) => {
  const { appId, game } = useGame();
  const settings = useSettings();
  const sort = settings.sort ?? "edited";
  const [folderId, setFolderState] = useState<string | null>(() => lastFolder(appId));
  const setFolderId = (id: string | null) => {
    rememberFolder(appId, id);
    setFolderState(id);
  };
  const [search, setSearch] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [activeKinds, setActiveKinds] = useState<string[]>([]);
  const pending = usePendingScreenshots();

  // Bring back the note that was open when Session Notes was put away.
  useEffect(() => {
    const reopen = game && noteToReopen(appId);
    if (!reopen) return;
    const note = reopen.noteId ? game.notes.find((n) => n.id === reopen.noteId) : null;
    if (reopen.noteId && !note) return;
    if (reopen.type === "edit") openEditor(note ?? null, reopen.draft);
    else if (note) openNote(note);
  }, [!!game]);

  if (!game) return <Spinner style={{ width: "32px" }} />;

  const folders = game.folders;
  const searching = search.trim().length > 0 || activeTags.length > 0 || activeKinds.length > 0;
  const q = search.trim().toLowerCase();
  const inGuides = folderId === GUIDES;
  const inShared = folderId === SHARED;
  const shared = game.shared ?? [];
  const guideCount = game.notes.filter((n) => isGuide(n.kind)).length;

  const subFolders = searching || inGuides || inShared
    ? []
    : folders
        .filter((f) => f.parentId === folderId)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const notes = sortNotes(
    game.notes
      .filter((n) =>
        searching
          ? true
          : inGuides
            ? isGuide(n.kind)
            : inShared
              ? false
              : folderId === null
                ? !n.folderId && !isGuide(n.kind) // root guides live in the Guides folder
                : n.folderId === folderId
      )
      .filter((n) => activeKinds.length === 0 || activeKinds.includes(n.kind ?? "note"))
      .filter((n) => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q) ||
        n.recordings.some((r) => r.transcript?.toLowerCase().includes(q)))
      .filter((n) => activeTags.every((t) => n.tags.includes(t))),
    sort
  );
  const allTags = Array.from(new Set(game.notes.flatMap((n) => n.tags))).sort();
  const presentKinds = KINDS.filter((k) => k.kind !== "note" && game.notes.some((n) => n.kind === k.kind));

  const countIn = (id: string) => game.notes.filter((n) => n.folderId === id).length;

  // ---- actions ----

  const openEditor = (note: Note | null, draft?: EditorDraft) =>
    showNoteModal(
      { type: "edit", appId, noteId: note?.id ?? null, draft },
      <NoteEditor
        draft={draft}
        appId={appId}
        note={note}
        folderId={inGuides || inShared ? null : folderId}
        defaultKind={inGuides ? "guide" : undefined}
        folders={folders}
        gameName={game.name}
        onSaved={emitDataChanged}
      />
    );

  const saveNote = async (note: Note) => {
    await backend.saveNote(appId, note);
    emitDataChanged();
  };

  const deleteNote = (note: Note) =>
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

  const openNote = (note: Note) =>
    showNoteModal(
      { type: "view", appId, noteId: note.id },
      <NoteViewer
        appId={appId}
        note={note}
        folderLabel={note.folderId ? folderPath(folders, note.folderId) : undefined}
        onEdit={() => openEditor(note)}
        onTogglePin={() => saveNote({ ...note, pinned: !note.pinned })}
        onDelete={() => deleteNote(note)}
        onHistory={() => showModal(<VersionHistoryModal appId={appId} note={note} />)}
        onUpdate={saveNote}
      />
    );

  const moveNote = (note: Note) =>
    showContextMenu(
      <Menu label="Move to folder">
        <MenuItem onSelected={() => saveNote({ ...note, folderId: null })}>No folder</MenuItem>
        {folders.map((f) => (
          <MenuItem key={f.id} onSelected={() => saveNote({ ...note, folderId: f.id })}>
            {folderPath(folders, f.id)}
          </MenuItem>
        ))}
      </Menu>
    );

  const noteOptions = (note: Note) =>
    showContextMenu(
      <Menu label={note.title}>
        <MenuItem onSelected={() => openEditor(note)}>Edit</MenuItem>
        <MenuItem onSelected={() => saveNote({ ...note, pinned: !note.pinned })}>{note.pinned ? "Unpin" : "Pin to top"}</MenuItem>
        {folders.length > 0 && <MenuItem onSelected={() => moveNote(note)}>Move to folder…</MenuItem>}
        <MenuItem onSelected={() => showModal(<VersionHistoryModal appId={appId} note={note} />)}>Version history…</MenuItem>
        {settings.syncUrl && <MenuItem onSelected={() => showModal(<ShareModal appId={appId} note={note} />)}>Share with…</MenuItem>}
        <MenuItem onSelected={() => showModal(<PublishModal appId={appId} note={note} />)}>
          {note.bookstoreId ? "Update in Bookstore…" : "Publish to Bookstore…"}
        </MenuItem>
        <MenuItem tone="destructive" onSelected={() => deleteNote(note)}>
          Delete
        </MenuItem>
      </Menu>
    );

  const newFolder = () =>
    showModal(
      <NameModal
        heading={folderId ? `New folder in ${folderPath(folders, folderId)}` : "New folder"}
        onSubmit={async (name) => {
          await backend.saveFolder(appId, { id: newId(), name, parentId: folderId, createdAt: 0 });
          emitDataChanged();
        }}
      />
    );

  const folderOptions = (folder: Folder) =>
    showContextMenu(
      <Menu label={folder.name}>
        <MenuItem
          onSelected={() =>
            showModal(
              <NameModal
                heading="Rename folder"
                initial={folder.name}
                onSubmit={async (name) => {
                  await backend.saveFolder(appId, { ...folder, name });
                  emitDataChanged();
                }}
              />
            )
          }
        >
          Rename
        </MenuItem>
        <MenuItem
          tone="destructive"
          onSelected={() =>
            showModal(
              <ConfirmModal
                strTitle={`Delete folder "${folder.name}"?`}
                strDescription="Notes inside are kept and moved up one level."
                strOKButtonText="Delete folder"
                onOK={async () => {
                  await backend.deleteFolder(appId, folder.id);
                  emitDataChanged();
                }}
              />
            )
          }
        >
          Delete folder
        </MenuItem>
      </Menu>
    );

  const currentFolder = folders.find((f) => f.id === folderId);

  return (
    <div>
      {onBack && (
        <Focusable style={s.toolbar}>
          <DialogButton style={s.smallButton} onClick={onBack}>
            <FaArrowLeft /> All games
          </DialogButton>
        </Focusable>
      )}

      <StatsView game={game} live={live} />
      <LeftOffCard game={game} />
      <Counters game={game} />

      {pending?.appId === appId && (
        <Focusable style={{ ...s.row, background: "rgba(255,200,0,0.12)" }}>
          <FaCamera />
          <div style={{ flex: 1 }}>
            {pending.paths.length === 1 ? "You took a screenshot." : `You took ${pending.paths.length} screenshots.`}
          </div>
          <DialogButton style={s.smallButton} onClick={() => showModal(<AttachScreenshotsModal pending={pending} />)}>
            Attach to a note
          </DialogButton>
        </Focusable>
      )}

      <Focusable style={s.toolbar}>
        <DialogButton style={s.smallButton} onClick={() => openEditor(null)}>
          <FaPlus /> Create note
        </DialogButton>
        <DialogButton style={s.smallButton} onClick={newFolder}>
          <FaFolderPlus /> Create folder
        </DialogButton>
        <DialogButton style={s.smallButton} onClick={() => addCounter(appId)}>
          <FaSkull /> Add counter
        </DialogButton>
        <div style={{ flex: 1 }} />
        <div style={{ minWidth: "170px" }}>
          <Dropdown
            rgOptions={SORT_OPTIONS}
            selectedOption={sort}
            onChange={(o) => updateSettings({ sort: o.data })}
            menuLabel="Sort by"
            renderButtonValue={(el) => <span>Sort: {el}</span>}
          />
        </div>
      </Focusable>

      <TextField
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        bShowClearAction
        label="Search notes"
      />
      <div style={{ height: "6px" }} />
      {presentKinds.length > 0 && (
        <Focusable flow-children="row" style={{ ...s.toolbar, flexWrap: "wrap" }}>
          {presentKinds.map((k) => {
            const on = activeKinds.includes(k.kind);
            return (
              <DialogButton
                key={k.kind}
                style={{ ...s.smallButton, padding: "2px 10px", fontSize: "12px", opacity: on ? 1 : 0.7 }}
                onClick={() => setActiveKinds(on ? activeKinds.filter((x) => x !== k.kind) : [...activeKinds, k.kind])}
              >
                {on ? "✓ " : ""}
                {k.icon} {k.label}
              </DialogButton>
            );
          })}
        </Focusable>
      )}
      <TagFilterBar allTags={allTags} activeTags={activeTags} onChange={setActiveTags} />

      {(inGuides || inShared) && !searching && (
        <Focusable style={s.toolbar}>
          <DialogButton style={s.smallButton} onClick={() => setFolderId(null)}>
            <FaArrowLeft /> Back
          </DialogButton>
          <div style={{ ...s.title, opacity: 0.85 }}>{inGuides ? "📘 Guides" : "👥 Shared Notes"}</div>
        </Focusable>
      )}

      {folderId === null && !searching && guideCount > 0 && (
        <Focusable style={s.row} onActivate={() => setFolderId(GUIDES)} onClick={() => setFolderId(GUIDES)}>
          <FaBook size={18} style={{ opacity: 0.8, color: "#1a9fff" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={s.title}>Guides</div>
            <div style={s.subline}>{guideCount} guides & walkthroughs</div>
          </div>
        </Focusable>
      )}
      {folderId === null && !searching && shared.length > 0 && (
        <Focusable style={s.row} onActivate={() => setFolderId(SHARED)} onClick={() => setFolderId(SHARED)}>
          <FaUserFriends size={18} style={{ opacity: 0.8, color: "#2db37d" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={s.title}>Shared Notes</div>
            <div style={s.subline}>
              {shared.length} from {Array.from(new Set(shared.map((x) => x.fromName))).join(", ")}
            </div>
          </div>
        </Focusable>
      )}

      {currentFolder && !searching && (
        <Focusable style={s.toolbar}>
          <DialogButton style={s.smallButton} onClick={() => setFolderId(currentFolder.parentId)}>
            <FaArrowLeft /> Back
          </DialogButton>
          <div style={{ ...s.title, opacity: 0.85 }}>
            <FaFolder size={12} /> {folderPath(folders, folderId)}
          </div>
        </Focusable>
      )}

      {subFolders.map((folder) => (
        <Focusable
          key={folder.id}
          style={s.row}
          onActivate={() => setFolderId(folder.id)}
          onClick={() => setFolderId(folder.id)}
          onOptionsButton={() => folderOptions(folder)}
          onOptionsActionDescription="Folder options"
        >
          <FaFolder size={18} style={{ opacity: 0.8 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={s.title}>{folder.name}</div>
            <div style={s.subline}>
              {countIn(folder.id)} notes
              {folders.some((f) => f.parentId === folder.id) && " · has subfolders"}
            </div>
          </div>
        </Focusable>
      ))}

      {notes.map((note) => (
        <NoteItem key={note.id} appId={appId} note={note} onOpen={() => openNote(note)} onOptions={() => noteOptions(note)} />
      ))}

      {inShared &&
        !searching &&
        shared.map((sh) => (
          <NoteItem
            key={sh.shareId}
            appId={appId}
            note={sh.note}
            from={sh.fromName}
            onOpen={() => showModal(<SharedNoteViewer appId={appId} shared={sh} />)}
            onOptions={() => showModal(<SharedNoteViewer appId={appId} shared={sh} />)}
          />
        ))}

      {subFolders.length === 0 && notes.length === 0 && !(inShared && shared.length) && (
        <div style={{ opacity: 0.7, padding: "12px 0" }}>
          {searching ? "No notes match." : currentFolder ? "This folder is empty." : "No notes yet. Create your first one!"}
        </div>
      )}

      <Focusable style={{ ...s.toolbar, marginTop: "10px" }}>
        <DialogButton
          style={{ ...s.smallButton, fontSize: "12px", opacity: 0.8 }}
          onClick={() => showModal(<DeletedNotesModal appId={appId} />)}
        >
          <FaTrashRestore size={11} /> Recently deleted
        </DialogButton>
      </Focusable>
    </div>
  );
};
