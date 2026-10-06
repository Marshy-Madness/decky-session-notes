import { FC, Fragment, useEffect, useState } from "react";
import { DialogButton, Focusable, showModal } from "@decky/ui";
import { backend } from "../../api/backend";
import { useDataVersion } from "../../state/notesStore";
import { usePendingScreenshots } from "../../state/pendingScreenshots";
import { useSessionTimer } from "../../hooks/useSessionTimer";
import { openEditor, openNote, recentlyOpened } from "../../noteActions";
import { AttachScreenshotsModal } from "../../components/AttachScreenshotsModal";
import { SessionList } from "../../components/SessionList";
import { Game, Note, NoteKind, SteamScreenshot } from "../../types";
import { firstLine, formatClock, formatDuration, formatWhen } from "../../utils/format";
import { isGuide, kindInfo } from "../../utils/kinds";
import { registerTome, TomeProps } from "../registry";
import { Btn, Buttons, Hint, Line, byUpdated, ellipsis } from "../bits";
import { startVoiceNote, stopVoiceNote, useVoiceNoteRecording } from "./voiceNote";
import * as s from "../../components/styles";

// ---------- 📝 Recent Notes ----------

const FILTERS: { label: string; match: (n: Note) => boolean }[] = [
  { label: "All", match: () => true },
  { label: "Notes", match: (n) => (n.kind ?? "note") === "note" },
  { label: "Guides", match: (n) => isGuide(n.kind) },
  { label: "Tips", match: (n) => n.kind === "tip" },
  { label: "Boss", match: (n) => n.kind === "boss" },
  { label: "Builds", match: (n) => n.kind === "build" },
];

const NoteLine: FC<{ game: Game; note: Note }> = ({ game, note }) => (
  <Line icon={note.pinned ? "📌" : kindInfo(note.kind).icon} onOpen={() => openNote(game, note)} okLabel="Open">
    <div style={ellipsis}>{note.title}</div>
    <div className="dom-sub" style={{ fontSize: "12px", opacity: 0.6, ...ellipsis }}>
      {formatWhen(note.updatedAt)}
      {firstLine(note.body) && ` · ${firstLine(note.body)}`}
    </div>
  </Line>
);

let lastFilter = 0;

const RecentNotes: FC<TomeProps> = ({ game, fullScreen, showNotes }) => {
  const [filter, setFilterState] = useState(lastFilter);
  const setFilter = (i: number) => setFilterState((lastFilter = i));
  if (!game) return null;
  const notes = game.notes.filter(FILTERS[filter].match).sort(byUpdated).slice(0, fullScreen ? 8 : 5);
  return (
    <>
      <Focusable flow-children="row" style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
        {FILTERS.map((f, i) => (
          <DialogButton
            key={f.label}
            style={{
              ...s.smallButton,
              padding: "2px 10px",
              fontSize: "12px",
              minHeight: 0,
              ...(i === filter ? s.tint("#1a9fff") : {}),
            }}
            onClick={() => setFilter(i)}
          >
            {f.label}
          </DialogButton>
        ))}
      </Focusable>
      {notes.map((n) => (
        <NoteLine key={n.id} game={game} note={n} />
      ))}
      {notes.length === 0 && <Hint>Nothing here yet.</Hint>}
      <Buttons>
        <Btn primary onClick={() => openEditor(game, null)}>
          + New note
        </Btn>
        <Btn onClick={() => showNotes()}>All notes</Btn>
      </Buttons>
    </>
  );
};

// ---------- 📚 Guides ----------

const GUIDE_GROUPS: { kind: NoteKind; label: string }[] = [
  { kind: "boss", label: "Boss strategies" },
  { kind: "walkthrough", label: "Walkthroughs" },
  { kind: "achievement", label: "Achievements" },
  { kind: "guide", label: "Guides" },
];
const guideish = (n: Note) => isGuide(n.kind) || n.kind === "boss";

const Guides: FC<TomeProps> = ({ game, showNotes }) => {
  if (!game) return null;
  const guides = game.notes.filter(guideish);
  const used = recentlyOpened(game.appId)
    .map((id) => guides.find((g) => g.id === id))
    .filter((g): g is Note => !!g);
  const recent = (used.length ? used : [...guides].sort(byUpdated)).slice(0, 3);
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: "13px", marginBottom: "6px" }}>
        {GUIDE_GROUPS.map((g) => {
          const n = guides.filter((x) => x.kind === g.kind).length;
          return (
            n > 0 && (
              <span key={g.kind}>
                {kindInfo(g.kind).icon} {g.label} <b>{n}</b>
              </span>
            )
          );
        })}
      </div>
      <div style={{ fontSize: "11px", fontWeight: "bold", letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.6, margin: "4px 0" }}>
        {used.length ? "Recently used" : "Recently edited"}
      </div>
      {recent.map((n) => (
        <NoteLine key={n.id} game={game} note={n} />
      ))}
      <Buttons>
        <Btn primary onClick={() => showNotes("__guides")}>
          Browse guides
        </Btn>
        <Btn onClick={() => openEditor(game, null, { defaultKind: "guide" })}>+ New guide</Btn>
      </Buttons>
    </>
  );
};

// ---------- 📊 Game Stats ----------

const GameStats: FC<TomeProps> = ({ game, live }) => {
  const [history, setHistory] = useState(false);
  const open = live ? game?.sessions.find((x) => x.end == null) : undefined;
  const sessionMs = useSessionTimer(open?.start ?? null);
  if (!game) return null;
  const sum = game.summary;
  const rows: [string, string][] = [
    ["Playtime", formatDuration(sum.playtimeSeconds + (open ? sessionMs / 1000 : 0))],
    ["Launches", String(sum.launchCount)],
    ["Last played", live ? "Now" : formatWhen(sum.lastLaunched)],
    ...(open ? ([["This session", sessionMs >= 3600_000 ? formatDuration(sessionMs / 1000) : formatClock(sessionMs / 1000)]] as [string, string][]) : []),
    ["Notes", String(sum.noteCount)],
  ];
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 14px", fontSize: "14px" }}>
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <span style={{ opacity: 0.65 }}>{k}</span>
            <b>{v}</b>
          </Fragment>
        ))}
      </div>
      <Buttons>
        <Btn onClick={() => setHistory((h) => !h)}>{history ? "Hide session history" : "Session history"}</Btn>
      </Buttons>
      {history && (
        <div style={{ marginTop: "6px" }}>
          <SessionList sessions={game.sessions} />
        </div>
      )}
    </>
  );
};

// ---------- 🎙️ Voice Notes ----------

const VoiceNotes: FC<TomeProps> = ({ game }) => {
  const recording = useVoiceNoteRecording();
  const elapsed = useSessionTimer(recording?.started ?? null);
  if (!game) return null;
  const recent = game.notes
    .flatMap((note) => note.recordings.map((rec) => ({ note, rec })))
    .sort((a, b) => b.rec.createdAt - a.rec.createdAt)
    .slice(0, 3);
  const here = recording?.appId === game.appId;
  return (
    <>
      <Buttons style={{ marginTop: 0 }}>
        {recording ? (
          <Btn primary onClick={stopVoiceNote}>
            ⏹ Stop and save · {formatClock(elapsed / 1000)}
            {!here && ` (${recording.gameName})`}
          </Btn>
        ) : (
          <Btn primary onClick={() => startVoiceNote(game)}>
            🎙 Record a voice note
          </Btn>
        )}
      </Buttons>
      {recent.length > 0 && (
        <div style={{ fontSize: "11px", fontWeight: "bold", letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.6, margin: "8px 0 4px" }}>
          Recent
        </div>
      )}
      {recent.map(({ note, rec }) => (
        <Line key={rec.id} icon="▶" onOpen={() => openNote(game, note)} okLabel="Open">
          <div style={ellipsis}>{rec.transcript ? `“${rec.transcript}”` : note.title}</div>
          <div className="dom-sub" style={{ fontSize: "12px", opacity: 0.6 }}>
            {formatWhen(rec.createdAt)}
            {rec.durationSec ? ` · ${formatClock(rec.durationSec)}` : ""}
          </div>
        </Line>
      ))}
    </>
  );
};

// ---------- 📸 Screenshot → Note ----------

const Screenshot: FC<TomeProps> = ({ game }) => {
  const [shot, setShot] = useState<SteamScreenshot | null | undefined>(undefined);
  const pending = usePendingScreenshots();
  const version = useDataVersion();
  useEffect(() => {
    if (!game) return;
    backend
      .listSteamScreenshots(game.appId, 1)
      .then((list) => setShot(list[0] ?? null))
      .catch(() => setShot(null));
  }, [game?.appId, version, pending?.paths.length]);
  if (!game) return null;
  const waiting = pending?.appId === game.appId ? pending.paths : [];
  const paths = waiting.length ? waiting : shot ? [shot.path] : [];
  const attach = () => paths.length && showModal(<AttachScreenshotsModal pending={{ appId: game.appId, paths }} />);
  if (shot === undefined) return <Hint>Looking for screenshots…</Hint>;
  return (
    <>
      {shot ? (
        <Focusable onActivate={attach} onClick={attach} onOKActionDescription="Attach to a note" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <img src={shot.preview} style={{ width: "128px", height: "80px", objectFit: "cover", borderRadius: "6px", flex: "0 0 auto" }} />
          <div style={{ fontSize: "13px" }}>
            <div>{waiting.length > 1 ? `${waiting.length} new screenshots` : waiting.length ? "New screenshot" : "Last screenshot"}</div>
            <div style={{ opacity: 0.6 }}>{formatWhen(shot.takenAt)}</div>
          </div>
        </Focusable>
      ) : (
        <Hint>No screenshots for this game yet. STEAM + R1 takes one.</Hint>
      )}
      {paths.length > 0 && (
        <Buttons>
          <Btn primary onClick={attach}>
            New note / add to a note…
          </Btn>
        </Buttons>
      )}
    </>
  );
};

registerTome({
  id: "recent-notes",
  name: "Recent Notes",
  icon: "📝",
  category: "gaming",
  description: "Your latest notes for this game, filtered by type.",
  defaultOn: true,
  needsGame: true,
  component: RecentNotes,
});
registerTome({
  id: "guides",
  name: "Guides",
  icon: "📚",
  category: "gaming",
  description: "Boss strategies, walkthroughs and achievement guides, with the ones you used last.",
  defaultOn: true,
  needsGame: true,
  isEmpty: (g) => !g || !g.notes.some(guideish),
  component: Guides,
});
registerTome({
  id: "game-stats",
  name: "Game Stats",
  icon: "📊",
  category: "gaming",
  description: "Playtime, launches, last played and this session's time.",
  defaultOn: true,
  needsGame: true,
  component: GameStats,
});
registerTome({
  id: "voice-notes",
  name: "Voice Notes",
  icon: "🎙️",
  category: "gaming",
  description: "Record a voice note in one press; recent ones with what was said.",
  defaultOn: true,
  needsGame: true,
  component: VoiceNotes,
});
registerTome({
  id: "screenshot",
  name: "Screenshot → Note",
  icon: "📸",
  category: "gaming",
  description: "Your latest screenshot: make it a new note or add it to one.",
  defaultOn: true,
  needsGame: true,
  component: Screenshot,
});

