import { FC, useEffect, useRef, useState } from "react";
import { DialogButton, Dropdown, Focusable, ModalRoot, Spinner, TextField, ToggleField, showModal } from "@decky/ui";
import { FaArrowLeft, FaCopy, FaEdit, FaHeart, FaRegComment, FaSearch } from "react-icons/fa";
import { toaster } from "@decky/api";
import { backend } from "../api/backend";
import { useRunningGame } from "../hooks/useAppLifetime";
import { emitDataChanged, loadSettings, useSettings } from "../state/notesStore";
import { BookstoreEntry, BookstoreGame, BookstoreSummary, BookstoreUser, EditPolicy, Note, NoteKind } from "../types";
import { formatDateTime } from "../utils/format";
import { KINDS, kindInfo } from "../utils/kinds";
import { MediaImage, MediaLoader } from "./MediaImage";
import { NameModal } from "./NameModal";
import { ReadOnlyNote } from "./ReadOnlyNote";
import * as s from "./styles";

const mediaCache = new Map<string, Promise<string | null>>();
export const bookstoreMedia: MediaLoader = (file) => {
  if (!mediaCache.has(file)) mediaCache.set(file, backend.bsMedia(file).catch(() => null));
  return mediaCache.get(file)!;
};

const errText = (e: unknown) => String(e).replace(/^Error: /, "");

// ---------- linking your Steam account ----------

/** Shows a code to type on the Bookstore website (phone/PC) and waits until it's approved. */
export const LinkPanel: FC<{ onLinked?: (user: BookstoreUser) => void }> = ({ onLinked }) => {
  const [link, setLink] = useState<{ userCode: string; verifyUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearInterval(timer.current), []);

  const start = async () => {
    setError(null);
    try {
      const res = await backend.bsStartLink();
      setLink(res);
      timer.current = window.setInterval(async () => {
        try {
          const r = await backend.bsPollLink(res.deviceCode);
          if (r.status === "linked" && r.user) {
            window.clearInterval(timer.current);
            await loadSettings();
            toaster.toast({ title: "Bookstore", body: `Linked as ${r.user.name}` });
            onLinked?.(r.user);
          }
        } catch (e) {
          window.clearInterval(timer.current);
          setError(errText(e));
          setLink(null);
        }
      }, Math.max(3, res.interval) * 1000);
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div>
      {error && <div style={{ color: "#ff6b6b", marginBottom: "6px" }}>⚠️ {error}</div>}
      {link ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "13px", opacity: 0.8 }}>On your phone or PC, open</div>
          <div style={{ fontWeight: "bold", margin: "4px 0" }}>{link.verifyUrl}</div>
          <div style={{ fontSize: "13px", opacity: 0.8 }}>sign in with Steam and enter</div>
          <div style={{ fontSize: "30px", letterSpacing: "4px", fontWeight: "bold", margin: "8px 0" }}>{link.userCode}</div>
          <Spinner style={{ width: "22px" }} />
        </div>
      ) : (
        <DialogButton onClick={start}>Link your Steam account</DialogButton>
      )}
    </div>
  );
};

const LinkModal: FC<{ closeModal?: () => void; onLinked?: () => void }> = ({ closeModal, onLinked }) => (
  <ModalRoot onCancel={closeModal}>
    <h2 style={{ marginTop: 0 }}>Link the Bookstore</h2>
    <div style={{ fontSize: "13px", opacity: 0.8, marginBottom: "10px" }}>
      Browsing is open to everyone. To post, like, comment or copy notes, link your Steam account once.
    </div>
    <LinkPanel
      onLinked={() => {
        closeModal?.();
        onLinked?.();
      }}
    />
  </ModalRoot>
);

const requireLink = (linked: boolean, then: () => void) => (linked ? then() : showModal(<LinkModal onLinked={then} />));

// ---------- reading a post ----------

const EntryModal: FC<{ id: string; appId: string; closeModal?: () => void }> = ({ id, appId, closeModal }) => {
  const settings = useSettings();
  const linked = !!settings.bookstoreUser;
  const [entry, setEntry] = useState<BookstoreEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => backend.bsEntry(id).then(setEntry).catch((e) => setError(errText(e)));
  useEffect(() => {
    load();
  }, [id]);

  const act = async (fn: () => Promise<BookstoreEntry | unknown>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r && typeof r === "object" && "id" in (r as object)) setEntry(r as BookstoreEntry);
    } catch (e) {
      toaster.toast({ title: "Bookstore", body: errText(e) });
    }
    setBusy(false);
  };

  if (error) return <ModalRoot onCancel={closeModal}>⚠️ {error}</ModalRoot>;
  if (!entry) return <ModalRoot onCancel={closeModal}><Spinner style={{ width: "32px" }} /></ModalRoot>;

  const note: Note = {
    id: entry.id, folderId: null, title: entry.title, body: entry.body, tags: entry.tags, screenshots: entry.screenshots,
    recordings: entry.recordings, pinned: false, createdAt: entry.createdAt, updatedAt: entry.updatedAt, launchNumber: null,
    checklist: entry.checklist, spoiler: entry.spoiler, kind: entry.kind,
  };

  return (
    <ModalRoot onCancel={closeModal} bAllowFullSize>
      <ReadOnlyNote
        appId={appId}
        note={note}
        loader={bookstoreMedia}
        spoilerLabel={entry.spoilerLabel}
        chips={
          <>
            <span style={s.chip}>by {entry.author.name}</span>
            <span style={s.chip}>♥ {entry.likes}</span>
            <span style={s.chip}>💬 {entry.comments}</span>
            {!entry.allowCopy && <span style={s.chip}>🚫 No copies</span>}
          </>
        }
      />
      <Focusable style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
        <DialogButton
          style={s.smallButton}
          disabled={busy}
          onClick={() => requireLink(linked, () => act(() => backend.bsLike(entry.id)))}
        >
          <FaHeart color={entry.liked ? "#ff6b9a" : undefined} /> {entry.liked ? "Liked" : "Like"}
        </DialogButton>
        <DialogButton
          style={s.smallButton}
          onClick={() =>
            requireLink(linked, () =>
              showModal(
                <NameModal heading="Add a comment" label="Comment" onSubmit={(text) => act(() => backend.bsComment(entry.id, text))} />
              )
            )
          }
        >
          <FaRegComment /> Comment
        </DialogButton>
        {entry.allowCopy && (
          <DialogButton
            style={s.smallButton}
            disabled={busy}
            onClick={() =>
              act(async () => {
                await backend.bsCopy(entry.id, entry.appId);
                emitDataChanged();
                toaster.toast({ title: "Bookstore", body: `Copied "${entry.title}" to your notes for ${entry.gameName}.` });
              })
            }
          >
            <FaCopy /> Copy to my notes
          </DialogButton>
        )}
        {entry.canEdit && (
          <DialogButton style={s.smallButton} onClick={() => showModal(<EditEntryModal entry={entry} onSaved={setEntry} />)}>
            <FaEdit /> Edit
          </DialogButton>
        )}
        <DialogButton style={s.smallButton} onClick={closeModal}>
          Close
        </DialogButton>
      </Focusable>

      <div style={{ marginTop: "14px", fontSize: "13px", opacity: 0.8 }}>Comments ({entry.commentList.length})</div>
      <Focusable style={{ maxHeight: "25vh", overflowY: "auto" }}>
        {entry.commentList.map((c) => (
          <Focusable key={c.id} style={{ ...s.row, display: "block", padding: "6px 10px" }}>
            <div style={{ fontSize: "12px", opacity: 0.7 }}>
              {c.author.name} · {formatDateTime(c.createdAt)}
            </div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: "13px" }}>{c.text}</div>
          </Focusable>
        ))}
      </Focusable>
    </ModalRoot>
  );
};

/** Quick edit of a Bookstore post from the Deck (text, type, spoiler; media is edited on the website). */
const EditEntryModal: FC<{ entry: BookstoreEntry; onSaved: (e: BookstoreEntry) => void; closeModal?: () => void }> = ({
  entry,
  onSaved,
  closeModal,
}) => {
  const [title, setTitle] = useState(entry.title);
  const [body, setBody] = useState(entry.body);
  const [kind, setKind] = useState<NoteKind>(entry.kind);
  const [spoiler, setSpoiler] = useState(entry.spoiler);
  const [spoilerLabel, setSpoilerLabel] = useState(entry.spoilerLabel);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const save = async () => {
    try {
      onSaved(await backend.bsUpdate(entry.id, { title, body, kind, spoiler, spoilerLabel }));
      closeModal?.();
    } catch (e) {
      toaster.toast({ title: "Bookstore", body: errText(e) });
    }
  };

  return (
    <ModalRoot onCancel={closeModal} bAllowFullSize>
      <h2 style={{ marginTop: 0 }}>Edit post</h2>
      <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Dropdown rgOptions={KINDS.map((k) => ({ label: `${k.icon} ${k.label}`, data: k.kind }))} selectedOption={kind} onChange={(o) => setKind(o.data)} />
      <Focusable onActivate={() => bodyRef.current?.focus()} style={{ marginTop: "8px" }}>
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          style={{ width: "100%", boxSizing: "border-box", background: "rgba(0,0,0,0.35)", color: "white", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "4px", padding: "8px", fontFamily: "inherit" }}
        />
      </Focusable>
      <ToggleField label="Spoiler" checked={spoiler} onChange={setSpoiler} />
      {spoiler && <TextField label="Spoils what? (e.g. Beat the first boss)" value={spoilerLabel} onChange={(e) => setSpoilerLabel(e.target.value)} />}
      <Focusable style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        <DialogButton onClick={save}>Save</DialogButton>
        <DialogButton onClick={closeModal}>Cancel</DialogButton>
      </Focusable>
    </ModalRoot>
  );
};

// ---------- publishing one of your notes ----------

const POLICIES: { label: string; data: EditPolicy }[] = [
  { label: "Only me", data: "owner" },
  { label: "Me and people I choose", data: "select" },
  { label: "Anyone signed in", data: "anyone" },
];

export const PublishModal: FC<{ appId: string; note: Note; closeModal?: () => void }> = ({ appId, note, closeModal }) => {
  const settings = useSettings();
  const [kind, setKind] = useState<NoteKind>(note.kind ?? "note");
  const [spoiler, setSpoiler] = useState(note.spoiler ?? false);
  const [spoilerLabel, setSpoilerLabel] = useState("");
  const [policy, setPolicy] = useState<EditPolicy>("owner");
  const [editors, setEditors] = useState<BookstoreUser[]>([]);
  const [results, setResults] = useState<BookstoreUser[]>([]);
  const [allowCopy, setAllowCopy] = useState(true);
  const [busy, setBusy] = useState(false);

  if (!settings.bookstoreUser) {
    return (
      <ModalRoot onCancel={closeModal}>
        <h2 style={{ marginTop: 0 }}>Publish to the Bookstore</h2>
        <div style={{ fontSize: "13px", opacity: 0.8, marginBottom: "10px" }}>Link your Steam account first so people know who posted it.</div>
        <LinkPanel />
      </ModalRoot>
    );
  }

  const findPeople = () =>
    showModal(
      <NameModal
        heading="Find people"
        label="Steam name"
        onSubmit={async (q) => setResults((await backend.bsUsers(q)).filter((u) => u.steamId !== settings.bookstoreUser?.steamId))}
      />
    );

  const publish = async () => {
    setBusy(true);
    try {
      const e = await backend.bsPublish(appId, note.id, {
        kind, spoiler, spoilerLabel, editPolicy: policy, editors: editors.map((u) => u.steamId), allowCopy,
      });
      emitDataChanged();
      toaster.toast({ title: "Bookstore", body: `${note.bookstoreId ? "Updated" : "Published"} "${e.title}"` });
      closeModal?.();
    } catch (e) {
      toaster.toast({ title: "Couldn't publish", body: errText(e) });
      setBusy(false);
    }
  };

  return (
    <ModalRoot onCancel={closeModal} bAllowFullSize>
      <h2 style={{ marginTop: 0 }}>{note.bookstoreId ? "Update published version" : "Publish to the Bookstore"}</h2>
      <div style={{ fontSize: "13px", opacity: 0.75 }}>
        "{note.title}" with its screenshots, voice notes and checklist goes public as {settings.bookstoreUser.name}.
      </div>
      <Dropdown rgOptions={KINDS.map((k) => ({ label: `${k.icon} ${k.label}`, data: k.kind }))} selectedOption={kind} onChange={(o) => setKind(o.data)} />
      <ToggleField label="Spoiler" description="Hidden until people choose to reveal it" checked={spoiler} onChange={setSpoiler} />
      {spoiler && <TextField label="Spoils what? (e.g. Beat the first boss)" value={spoilerLabel} onChange={(e) => setSpoilerLabel(e.target.value)} />}
      <div style={{ fontSize: "13px", opacity: 0.8, margin: "10px 0 4px" }}>Who can edit</div>
      <Dropdown rgOptions={POLICIES} selectedOption={policy} onChange={(o) => setPolicy(o.data)} />
      {policy === "select" && (
        <div style={{ marginTop: "6px" }}>
          {[...editors, ...results.filter((r) => !editors.some((e) => e.steamId === r.steamId))].map((u) => (
            <ToggleField
              key={u.steamId}
              label={u.name}
              checked={editors.some((e) => e.steamId === u.steamId)}
              onChange={(on) => setEditors(on ? [...editors, u] : editors.filter((e) => e.steamId !== u.steamId))}
            />
          ))}
          <DialogButton style={s.smallButton} onClick={findPeople}>
            <FaSearch /> Find people
          </DialogButton>
        </div>
      )}
      <ToggleField
        label="Allow copies"
        description="People can copy it into their own notes (their copy is private to them)"
        checked={allowCopy}
        onChange={setAllowCopy}
      />
      <Focusable style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        <DialogButton onClick={publish} disabled={busy}>
          {busy ? "Uploading…" : note.bookstoreId ? "Update" : "Publish"}
        </DialogButton>
        <DialogButton onClick={closeModal}>Cancel</DialogButton>
      </Focusable>
    </ModalRoot>
  );
};

// ---------- the Bookstore tab ----------

const SORTS = [
  { label: "Most liked", data: "top" },
  { label: "Newest", data: "new" },
  { label: "Recently updated", data: "updated" },
];
const CONTAINS = [
  { key: "screenshots", label: "📷 Screenshots" },
  { key: "voice", label: "🎙 Voice" },
  { key: "checklist", label: "☑ Checklist" },
];

let lastGame: { appId: string; name: string } | null = null;

export const BookstoreView: FC = () => {
  const running = useRunningGame();
  const [game, setGame] = useState<{ appId: string; name: string } | null>(
    lastGame ?? (running ? { appId: running.appId, name: running.name } : null)
  );
  const [kinds, setKinds] = useState<string[]>([]);
  const [has, setHas] = useState<string[]>([]);
  const [sort, setSort] = useState("top");
  const [entries, setEntries] = useState<BookstoreSummary[] | null>(null);
  const [games, setGames] = useState<BookstoreGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (g: { appId: string; name: string } | null) => {
    lastGame = g;
    setGame(g);
  };

  useEffect(() => {
    setError(null);
    if (!game) {
      backend.bsGames().then(setGames).catch((e) => setError(errText(e)));
      return;
    }
    setEntries(null);
    backend
      .bsEntries({ appId: game.appId, kind: kinds.join(","), has: has.join(","), sort })
      .then(setEntries)
      .catch((e) => setError(errText(e)));
  }, [game?.appId, kinds.join(), has.join(), sort]);

  const toggle = (list: string[], set: (v: string[]) => void, key: string) =>
    set(list.includes(key) ? list.filter((x) => x !== key) : [...list, key]);

  if (error) return <div style={{ opacity: 0.8 }}>⚠️ {error}</div>;

  if (!game) {
    return (
      <div>
        <Focusable style={s.toolbar}>
          {running && (
            <DialogButton style={s.smallButton} onClick={() => pick({ appId: running.appId, name: running.name })}>
              🎮 {running.name}
            </DialogButton>
          )}
          <DialogButton
            style={s.smallButton}
            onClick={() =>
              showModal(
                <NameModal heading="Search games" label="Game name" onSubmit={async (q) => setGames(await backend.bsGames(q))} />
              )
            }
          >
            <FaSearch /> Search games
          </DialogButton>
        </Focusable>
        {!games && <Spinner style={{ width: "28px" }} />}
        {games?.length === 0 && <div style={{ opacity: 0.7 }}>Nothing here yet. Publish one of your notes to start it off!</div>}
        {games?.map((g) => (
          <Focusable key={g.appId} style={s.row} onActivate={() => pick({ appId: g.appId, name: g.gameName })} onClick={() => pick({ appId: g.appId, name: g.gameName })}>
            <div style={{ flex: 1, ...s.title }}>{g.gameName}</div>
            <span style={s.chip}>{g.count} posts</span>
          </Focusable>
        ))}
      </div>
    );
  }

  return (
    <div>
      <Focusable style={s.toolbar}>
        <DialogButton style={s.smallButton} onClick={() => pick(null)}>
          <FaArrowLeft /> Games
        </DialogButton>
        <div style={{ ...s.title, fontSize: "17px", flex: 1 }}>{game.name}</div>
        <div style={{ minWidth: "160px" }}>
          <Dropdown rgOptions={SORTS} selectedOption={sort} onChange={(o) => setSort(o.data)} />
        </div>
      </Focusable>
      <Focusable flow-children="row" style={{ ...s.toolbar, flexWrap: "wrap" }}>
        {KINDS.map((k) => (
          <DialogButton
            key={k.kind}
            style={{ ...s.smallButton, padding: "2px 10px", fontSize: "12px", opacity: kinds.includes(k.kind) ? 1 : 0.65 }}
            onClick={() => toggle(kinds, setKinds, k.kind)}
          >
            {kinds.includes(k.kind) ? "✓ " : ""}
            {k.icon} {k.label}
          </DialogButton>
        ))}
      </Focusable>
      <Focusable flow-children="row" style={{ ...s.toolbar, flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", opacity: 0.7 }}>Contains:</span>
        {CONTAINS.map((c) => (
          <DialogButton
            key={c.key}
            style={{ ...s.smallButton, padding: "2px 10px", fontSize: "12px", opacity: has.includes(c.key) ? 1 : 0.65 }}
            onClick={() => toggle(has, setHas, c.key)}
          >
            {has.includes(c.key) ? "✓ " : ""}
            {c.label}
          </DialogButton>
        ))}
      </Focusable>

      {!entries && <Spinner style={{ width: "28px" }} />}
      {entries?.length === 0 && <div style={{ opacity: 0.7, padding: "8px 0" }}>No posts match. Publish one of your notes from its ☰ menu!</div>}
      {entries?.map((e) => {
        const k = kindInfo(e.kind);
        return (
          <Focusable
            key={e.id}
            style={s.row}
            onActivate={() => showModal(<EntryModal id={e.id} appId={game.appId} />)}
            onClick={() => showModal(<EntryModal id={e.id} appId={game.appId} />)}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={s.title}>
                {k.icon} {e.title}
              </div>
              <div style={{ ...s.subline, filter: e.spoiler ? "blur(5px)" : undefined }}>
                {e.spoiler ? `Spoiler${e.spoilerLabel ? ": " + e.spoilerLabel : ""}` : e.firstLine || " "}
              </div>
              <div style={s.chipRow}>
                <span style={s.chip}>{k.label}</span>
                <span style={s.chip}>by {e.author.name}</span>
                <span style={s.chip}>♥ {e.likes}</span>
                <span style={s.chip}>💬 {e.comments}</span>
                {e.hasScreenshots && <span style={s.chip}>📷</span>}
                {e.hasVoice && <span style={s.chip}>🎙</span>}
                {e.hasChecklist && <span style={s.chip}>☑</span>}
                {e.spoiler && <span style={s.chip}>🙈 {e.spoilerLabel || "Spoiler"}</span>}
              </div>
            </div>
            {e.thumb && (
              <MediaImage
                appId={game.appId}
                file={e.thumb}
                loader={bookstoreMedia}
                style={{ width: "128px", height: "72px", flex: "0 0 auto", filter: e.spoiler ? "blur(6px)" : undefined }}
              />
            )}
          </Focusable>
        );
      })}
    </div>
  );
};
