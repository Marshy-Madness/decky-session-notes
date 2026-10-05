import { FC, useState } from "react";
import { Focusable, GamepadButton, GamepadEvent, showModal } from "@decky/ui";
import { FaCheckSquare, FaRegSquare } from "react-icons/fa";
import { backend } from "../../api/backend";
import { emitDataChanged, useSettings } from "../../state/notesStore";
import { openEditor, openNote, recentlyOpened, setChecklistItem } from "../../noteActions";
import { editLeftOff } from "../../components/LeftOffCard";
import { addCounter, counterMenu } from "../../components/Counters";
import { AttachScreenshotsModal } from "../../components/AttachScreenshotsModal";
import { openNotesPage } from "../../opening";
import { getPendingScreenshots } from "../../state/pendingScreenshots";
import { Counter, Game, Note } from "../../types";
import { firstLine, formatWhen } from "../../utils/format";
import { isGuide, kindInfo } from "../../utils/kinds";
import { registerTome, TomeProps } from "../registry";
import { Btn, Buttons, Hint, Line, allItems, byUpdated, ellipsis, openItems, tomeRow } from "../bits";
import { startVoiceNote, stopVoiceNote, useVoiceNoteRecording } from "./voiceNote";

const COUNTER_ICON: Record<Counter["kind"], string> = { death: "☠️", boss: "⚔️", custom: "#️⃣" };

const lastGuide = (game: Game): Note | undefined => {
  const guides = game.notes.filter((n) => isGuide(n.kind) || n.kind === "boss");
  const used = recentlyOpened(game.appId).map((id) => guides.find((g) => g.id === id)).find(Boolean);
  return used ?? [...guides].sort(byUpdated)[0];
};

const topCounter = (game: Game) =>
  [...(game.counters ?? [])].filter((c) => !c.defeated).sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))[0];

// ---------- 🧠 Game Brain ----------

const GameBrain: FC<TomeProps> = ({ game, showNotes }) => {
  if (!game) return null;
  const left = game.leftOff?.text;
  const next = openItems(game)[0];
  const guide = lastGuide(game);
  const counter = topCounter(game);
  const last = [...game.notes].sort(byUpdated)[0];
  return (
    <>
      <Line icon="📍" label="Left off" onOpen={() => editLeftOff(game.appId, left ?? "")} okLabel="Edit">
        {left ? <span style={{ whiteSpace: "pre-wrap" }}>{left}</span> : <span style={{ opacity: 0.6 }}>Not set yet. Press A to add it.</span>}
      </Line>
      {next && (
        <Line
          icon="☑️"
          label="Next"
          onOpen={() => setChecklistItem(game.appId, next.note, next.item.id, true)}
          okLabel="Tick off"
          onOptions={() => openNote(game, next.note)}
          optionsLabel="Open note"
        >
          {next.item.text}
          <div style={{ fontSize: "12px", opacity: 0.6, ...ellipsis }}>from {next.note.title}</div>
        </Line>
      )}
      {guide && (
        <Line icon={kindInfo(guide.kind).icon} label="Guide" onOpen={() => openNote(game, guide)} okLabel="Open">
          <div style={ellipsis}>{guide.title}</div>
        </Line>
      )}
      {counter && (
        <Line
          icon={COUNTER_ICON[counter.kind]}
          label="Counter"
          onOpen={() => backend.bumpCounter(game.appId, counter.id, 1).then(emitDataChanged)}
          okLabel="+1"
          onOptions={() => counterMenu(game.appId, counter)}
          optionsLabel="Counter options"
        >
          {counter.name}: <b>{counter.count}</b>
          {counter.sessionCount > 0 && <span style={{ opacity: 0.6 }}> (+{counter.sessionCount} this session)</span>}
        </Line>
      )}
      {last && (
        <Line icon={kindInfo(last.kind).icon} label="Last note" onOpen={() => openNote(game, last)} okLabel="Open">
          <div style={ellipsis}>{last.title}</div>
          {firstLine(last.body) && <div style={{ fontSize: "12px", opacity: 0.65, ...ellipsis }}>“{firstLine(last.body)}”</div>}
        </Line>
      )}
      <Buttons>
        <Btn primary onClick={() => showNotes()}>
          📝 Open notes
        </Btn>
        <Btn onClick={() => openEditor(game, null)}>+ New note</Btn>
      </Buttons>
    </>
  );
};

// ---------- 📍 Where I Left Off ----------

const LeftOff: FC<TomeProps> = ({ game }) => {
  if (!game) return null;
  const left = game.leftOff?.text ? game.leftOff : null;
  return left ? (
    <>
      <div style={{ fontSize: "15px", whiteSpace: "pre-wrap" }}>{left.text}</div>
      <div style={{ fontSize: "12px", opacity: 0.6, marginTop: "2px" }}>
        {formatWhen(left.updatedAt)}
        {left.launchNumber != null && ` · Launch #${left.launchNumber}`}
      </div>
      <Buttons>
        <Btn primary onClick={() => editLeftOff(game.appId, left.text)}>
          Edit
        </Btn>
        <Btn onClick={() => backend.setLeftOff(game.appId, "").then(emitDataChanged)}>Clear</Btn>
      </Buttons>
    </>
  ) : (
    <>
      <Hint>No “Where I left off” yet.</Hint>
      <Buttons>
        <Btn primary onClick={() => editLeftOff(game.appId, "")}>
          + Add
        </Btn>
      </Buttons>
    </>
  );
};

// ---------- ☑️ Active Checklist ----------

const Checklist: FC<TomeProps> = ({ game, fullScreen }) => {
  const [all, setAll] = useState(false);
  // Ticked here and not yet gone from view: kept (struck through) so a mis-tick can be undone.
  const [ticked, setTicked] = useState<{ noteId: string; itemId: string; text: string }[]>([]);
  if (!game) return null;
  const items = openItems(game);
  const total = allItems(game).length;
  const limit = all ? items.length : fullScreen ? 10 : 6;
  const tick = (note: Note, itemId: string, text: string) => {
    setTicked((t) => [...t, { noteId: note.id, itemId, text }]);
    setChecklistItem(game.appId, note, itemId, true);
  };
  const untick = (noteId: string, itemId: string) => {
    const note = game.notes.find((n) => n.id === noteId);
    setTicked((t) => t.filter((x) => x.itemId !== itemId));
    if (note) setChecklistItem(game.appId, note, itemId, false);
  };
  return (
    <>
      <div style={{ fontSize: "12px", opacity: 0.65, marginBottom: "4px" }}>
        {items.length} of {total} still to do
      </div>
      {items.slice(0, limit).map(({ note, item }) => (
        <Line
          key={note.id + item.id}
          icon={<FaRegSquare />}
          onOpen={() => tick(note, item.id, item.text)}
          okLabel="Tick off"
          onOptions={() => openNote(game, note)}
          optionsLabel="Open note"
        >
          {item.text}
          <div style={{ fontSize: "11px", opacity: 0.55, ...ellipsis }}>{note.title}</div>
        </Line>
      ))}
      {ticked
        .filter((t) => !items.some((i) => i.item.id === t.itemId))
        .map((t) => (
          <Line key={t.itemId} icon={<FaCheckSquare color="#2db37d" />} onOpen={() => untick(t.noteId, t.itemId)} okLabel="Undo" style={{ opacity: 0.55 }}>
            <s>{t.text}</s>
          </Line>
        ))}
      {items.length === 0 && <Hint>All done! 🎉</Hint>}
      {items.length > limit && (
        <Buttons>
          <Btn onClick={() => setAll(true)}>Show all {items.length}</Btn>
        </Buttons>
      )}
    </>
  );
};

// ---------- ⚔️ Counters ----------

const CounterLine: FC<{ appId: string; counter: Counter; step: number }> = ({ appId, counter, step }) => {
  const bump = (by: number) => {
    if (counter.count + by < 0) by = -counter.count;
    if (by) backend.bumpCounter(appId, counter.id, by).then(emitDataChanged);
  };
  const onDirection = (e: GamepadEvent) => {
    if (e.detail.button === GamepadButton.DIR_LEFT) return bump(-1);
    if (e.detail.button === GamepadButton.DIR_RIGHT) return bump(1);
    return false as any; // up/down still move between rows
  };
  return (
    <Focusable
      style={{ ...tomeRow, opacity: counter.defeated ? 0.6 : 1 }}
      onActivate={() => bump(1)}
      onGamepadDirection={onDirection}
      onSecondaryButton={() => bump(step)}
      onOptionsButton={() => counterMenu(appId, counter)}
      onOKActionDescription="+1"
      onSecondaryActionDescription={`+${step}`}
      onOptionsActionDescription="Counter options"
    >
      <span style={{ width: "20px", textAlign: "center" }}>{COUNTER_ICON[counter.kind]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "14px", ...ellipsis }}>
          {counter.name}
          {counter.defeated && " ✅"}
        </div>
        {counter.sessionCount > 0 && <div style={{ fontSize: "11px", opacity: 0.6 }}>+{counter.sessionCount} this session</div>}
      </div>
      <span style={{ fontSize: "12px", opacity: 0.45 }}>◀</span>
      <span style={{ minWidth: "34px", textAlign: "center", fontSize: "20px", fontWeight: "bold" }}>{counter.count}</span>
      <span style={{ fontSize: "12px", opacity: 0.45 }}>▶</span>
    </Focusable>
  );
};

const Counters: FC<TomeProps> = ({ game }) => {
  const step = useSettings().desk?.counterStep ?? 3;
  if (!game) return null;
  const counters = [...(game.counters ?? [])].sort((a, b) => Number(a.defeated ?? false) - Number(b.defeated ?? false) || a.createdAt - b.createdAt);
  return (
    <>
      {counters.map((c) => (
        <CounterLine key={c.id} appId={game.appId} counter={c} step={step} />
      ))}
      {counters.length === 0 && <Hint>No counters yet: deaths, boss attempts, anything you want to count.</Hint>}
      <div style={{ fontSize: "11px", opacity: 0.5, marginTop: "2px" }}>A or ▶ +1 · ◀ −1 · X +{step}</div>
      <Buttons>
        <Btn onClick={() => addCounter(game.appId)}>+ Add counter</Btn>
      </Buttons>
    </>
  );
};

// ---------- ⚡ Quick Actions ----------

const QuickActions: FC<TomeProps> = ({ game, fullScreen, goTab }) => {
  const recording = useVoiceNoteRecording();
  if (!game) return null;
  const pending = getPendingScreenshots();
  return (
    <Buttons style={{ marginTop: 0 }}>
      <Btn primary onClick={() => openEditor(game, null)}>
        📝 New note
      </Btn>
      <Btn onClick={() => (recording ? stopVoiceNote() : startVoiceNote(game))}>{recording ? "⏹ Stop recording" : "🎙 Voice note"}</Btn>
      <Btn
        onClick={async () => {
          const shots = pending?.appId === game.appId ? pending : { appId: game.appId, paths: (await backend.listSteamScreenshots(game.appId, 1)).map((x) => x.path) };
          if (shots.paths.length) showModal(<AttachScreenshotsModal pending={shots} />);
        }}
      >
        📸 Screenshot → note
      </Btn>
      <Btn onClick={() => editLeftOff(game.appId, game.leftOff?.text ?? "")}>📍 Left off</Btn>
      <Btn onClick={() => addCounter(game.appId)}>⚔️ Counter</Btn>
      <Btn onClick={() => goTab("workshop")}>🏭 Workshop</Btn>
      {!fullScreen && <Btn onClick={openNotesPage}>⛶ Full screen</Btn>}
    </Buttons>
  );
};

registerTome({
  id: "game-brain",
  name: "Game Brain",
  icon: "🧠",
  category: "desk",
  description: "Everything that matters for this game at a glance: left off, next step, guide, counter, last note.",
  defaultOn: true,
  needsGame: true,
  component: GameBrain,
});
registerTome({
  id: "quick-actions",
  name: "Quick Actions",
  icon: "⚡",
  category: "desk",
  description: "New note, voice note, screenshot to note, left off, counters.",
  defaultOn: true,
  needsGame: true,
  component: QuickActions,
});
registerTome({
  id: "left-off",
  name: "Where I Left Off",
  icon: "📍",
  category: "desk",
  description: "Your “where I left off” pin, to edit in one press.",
  defaultOn: false,
  needsGame: true,
  component: LeftOff,
});
registerTome({
  id: "checklist",
  name: "Active Checklist",
  icon: "☑️",
  category: "desk",
  description: "Unfinished checklist items from all of this game's notes. A ticks one off.",
  defaultOn: true,
  needsGame: true,
  isEmpty: (g) => !g || allItems(g).length === 0,
  component: Checklist,
});
registerTome({
  id: "counters",
  name: "Counters",
  icon: "⚔️",
  category: "desk",
  description: "Deaths, boss attempts and your own counters. A +1, ◀ −1, X +3.",
  defaultOn: true,
  needsGame: true,
  component: Counters,
});
