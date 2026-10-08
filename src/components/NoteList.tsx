import { CSSProperties, FC, useEffect, useState } from "react";
import {
  ConfirmModal,
  DialogButton,
  Focusable,
  Menu,
  MenuItem,
  TextField,
  showContextMenu,
  showModal,
} from "@decky/ui";
import { FaBook, FaUserFriends, FaArrowLeft, FaTrashRestore, FaCamera, FaFolder, FaFolderPlus, FaPlus, FaSkull, FaSortAmountDown, FaCheck } from "react-icons/fa";
import { backend } from "../api/backend";
import { useGame } from "../state/NotesProvider";
import { emitDataChanged, updateSettings, useSettings } from "../state/notesStore";
import { Folder, Note, SortMode } from "../types";
import { SORT_LABELS, newId, sortNotes } from "../utils/format";
import { KINDS, isGuide } from "../utils/kinds";
import { SharedNoteViewer } from "./SharedNotes";
import { ShareModal } from "./ShareModal";
import { Loading } from "./Loading";
import { PublishModal } from "./Workshop";
import { NoteItem } from "./NoteItem";
import { folderPath } from "./NoteEditor";
import { confirmDelete, openEditor as openEditorFor, openNote as openNoteFor, saveNote as saveNoteFor } from "../noteActions";
import { StatsView } from "./StatsView";
import { TagFilterBar } from "./TagFilterBar";
import { NameModal } from "./NameModal";
import { LeftOffCard } from "./LeftOffCard";
import { Counters, addCounter } from "./Counters";
import { AttachScreenshotsModal } from "./AttachScreenshotsModal";
import { DeletedNotesModal, VersionHistoryModal } from "./VersionHistory";
import { usePendingScreenshots } from "../state/pendingScreenshots";
import { lastFolder, noteToReopen, rememberFolder, EditorDraft } from "../state/resume";
import { setPlace } from "../state/place";
import * as s from "./styles";

const GUIDES = "__guides";
const SHARED = "__shared";

// Icon-only in the narrow Quick Access menu (the label shows beside them when one is focused); labelled on
// the full-screen page, where there's room.
const ADD_ACTIONS = [
  { id: "note", label: "New note", short: "New note", icon: <FaPlus /> },
  { id: "folder", label: "New folder", short: "Folder", icon: <FaFolderPlus /> },
  { id: "counter", label: "Add counter", short: "Counter", icon: <FaSkull /> },
] as const;

const SORT_MODES = Object.keys(SORT_LABELS) as SortMode[];

// On the full-screen page notes and folders sit in as many columns as fit; the Quick Access menu keeps one.
const gridStyle = (fullScreen: boolean): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: fullScreen ? "repeat(auto-fill, minmax(min(100%, 300px), 1fr))" : "minmax(0, 1fr)",
  columnGap: "8px",
});

/** All folders and notes for one game (the game comes from NotesProvider). */
export const NoteList: FC<{ live?: boolean; onBack?: () => void; backLabel?: string; fullScreen?: boolean }> = ({
  live,
  onBack,
  backLabel = "All games",
  fullScreen = false,
}) => {
  const { appId, game, error, refresh } = useGame();
  const settings = useSettings();
  const sort = settings.sort ?? "edited";
  const [folderId, setFolderState] = useState<string | null>(() => lastFolder(appId));
  const setFolderId = (id: string | null) => {
    rememberFolder(appId, id);
    setFolderState(id);
  };
  const [search, setSearch] = useState("");
  const [addHint, setAddHint] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [activeKinds, setActiveKinds] = useState<string[]>([]);
  const pending = usePendingScreenshots();

  // This game's notes are what's showing: that goes in the address on the full-screen page.
  useEffect(() => setPlace({ appId, folderId }), [appId]);

  // Bring back the note that was open when Desk of Madness was put away.
  useEffect(() => {
    const reopen = game && noteToReopen(appId);
    if (!reopen) return;
    const note = reopen.noteId ? game.notes.find((n) => n.id === reopen.noteId) : null;
    if (reopen.noteId && !note) return;
    if (reopen.type === "edit") openEditor(note ?? null, reopen.draft);
    else if (note) openNote(note);
  }, [!!game]);

  if (!game) return <Loading error={error} onRetry={refresh} what="this game's notes" />;

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
    openEditorFor(game, note, {
      draft,
      folderId: inGuides || inShared ? null : folderId,
      defaultKind: inGuides ? "guide" : undefined,
    });

  const saveNote = (note: Note) => saveNoteFor(appId, note);
  const deleteNote = (note: Note) => confirmDelete(appId, note);
  const openNote = (note: Note) => openNoteFor(game, note);

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
          {note.bookstoreId ? "Update in Workshop…" : "Publish to Workshop…"}
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

  const pickSort = () =>
    showContextMenu(
      <Menu label="Sort notes by">
        {SORT_MODES.map((m) => (
          <MenuItem key={m} onSelected={() => updateSettings({ sort: m })}>
            <span style={{ display: "inline-block", width: "20px" }}>{m === sort && <FaCheck size={11} />}</span>
            {SORT_LABELS[m]}
          </MenuItem>
        ))}
      </Menu>
    );

  return (
    <div>
      <StatsView game={game} live={live} onBack={onBack} backLabel={backLabel} fullScreen={fullScreen} />
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

      {/* Add buttons, search and sort share one row; in the Quick Access menu search wraps onto its own line. */}
      <Focusable flow-children="row" style={{ ...s.toolbar, gap: "6px 6px" }}>
        {ADD_ACTIONS.map((a) => (
          <DialogButton
            key={a.label}
            style={
              fullScreen
                ? { ...(a.id === "note" ? s.primaryButton : s.smallButton), height: "40px", padding: "0 14px" }
                : a.id === "note"
                  ? s.primaryIconButton
                  : s.iconButton
            }
            onClick={a.id === "note" ? () => openEditor(null) : a.id === "folder" ? newFolder : () => addCounter(appId)}
            onGamepadFocus={() => setAddHint(a.label)}
            onMouseEnter={() => setAddHint(a.label)}
            {...({ title: a.label, "aria-label": a.label } as any)}
          >
            {a.icon} {fullScreen && a.short}
          </DialogButton>
        ))}
        {!fullScreen && <div style={s.iconHint}>{addHint}</div>}
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <TextField
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            bShowClearAction
            {...({ placeholder: "🔍  Search notes" } as any)}
          />
        </div>
        <DialogButton
          style={fullScreen ? { ...s.smallButton, height: "40px" } : s.iconButton}
          onClick={pickSort}
          {...({ title: `Sort: ${SORT_LABELS[sort]}`, "aria-label": `Sort: ${SORT_LABELS[sort]}` } as any)}
        >
          <FaSortAmountDown /> {fullScreen && SORT_LABELS[sort]}
        </DialogButton>
      </Focusable>
      {presentKinds.length > 0 && (
        <Focusable flow-children="row" style={{ ...s.toolbar, flexWrap: "wrap" }}>
          {presentKinds.map((k) => {
            const on = activeKinds.includes(k.kind);
            return (
              <DialogButton
                key={k.kind}
                style={{ ...s.smallButton, padding: "3px 12px", fontSize: "13px", opacity: on ? 1 : 0.7 }}
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

      {searching && <div style={s.sectionLabel}>{notes.length === 1 ? "1 match" : `${notes.length} matches`}</div>}

      {(inGuides || inShared) && !searching && (
        <Focusable style={s.toolbar}>
          <DialogButton style={s.smallButton} onClick={() => setFolderId(null)}>
            <FaArrowLeft /> Back
          </DialogButton>
          <div style={{ ...s.title, opacity: 0.85 }}>{inGuides ? "📘 Guides" : "👥 Shared Notes"}</div>
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

      <Focusable flow-children="grid" style={gridStyle(fullScreen)}>
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

      </Focusable>

      {subFolders.length === 0 && notes.length === 0 && !(inShared && shared.length) && (
        <div style={{ opacity: 0.7, padding: "12px 0" }}>
          {searching ? "No notes match." : currentFolder ? "This folder is empty." : "No notes yet. Press the blue + button to write your first one."}
        </div>
      )}

      <Focusable style={{ ...s.toolbar, marginTop: "16px" }}>
        <DialogButton
          style={{ ...s.smallButton, fontSize: "13px", opacity: 0.75 }}
          onClick={() => showModal(<DeletedNotesModal appId={appId} />)}
        >
          <FaTrashRestore size={11} /> Recently deleted
        </DialogButton>
      </Focusable>
    </div>
  );
};
