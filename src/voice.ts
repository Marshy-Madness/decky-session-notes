import { toaster } from "@decky/api";
import { backend } from "./api/backend";
import { comboLabel, getCombo } from "./combos";
import { getRunningGame, RunningGame } from "./hooks/useAppLifetime";
import { openNotesPage } from "./opening";
import { emitDataChanged, getSettings } from "./state/notesStore";
import { Counter, CounterKind, Game, Note, NoteKind, Recording, Screenshot } from "./types";
import { errText } from "./utils/errors";
import { newId } from "./utils/format";

// Voice commands: press the voice combo, say a command, press it again (or stop talking for a while and it
// stops by itself). The sync server writes out what you said and we match it against keywords below; no AI
// decides what you meant. A screenshot is taken the moment you press the combo, so "screenshot" commands
// show what was on screen when you asked, not a few seconds later.

const MAX_LISTEN_MS = 20_000;
const TODO_TITLE = "To-do";

type State = "idle" | "listening" | "working" | "memo";
let state: State = "idle";
let timer: ReturnType<typeof setTimeout> | undefined;
let shot: Promise<string> | null = null; // "" when the screenshot worked, else why not
let memo: { game: RunningGame; started: number } | null = null;

/** The note the last command wrote to; "add …", "tag …" and the rest work on it. */
let lastNote: { appId: string; id: string } | null = null;
let undo: { label: string; run: () => Promise<void> } | null = null;

export function voiceBusy(): boolean {
  return state !== "idle";
}

const comboText = () => comboLabel(getCombo("voice"));

export async function toggleVoiceCommand() {
  if (state === "working") return;
  if (state === "memo") return finishMemo();
  if (state === "listening") return finish();
  try {
    await backend.startDictation();
  } catch (e) {
    toaster.toast({ title: "Couldn't start listening", body: errText(e) });
    return;
  }
  state = "listening";
  shot = getRunningGame() ? backend.captureScreen().catch((e) => errText(e)) : null;
  timer = setTimeout(finish, MAX_LISTEN_MS);
  toaster.toast({ title: "🗣 Say a command…", body: `Then press ${comboText()} again. Say "help" for the list.`, duration: 3000 });
}

export function stopVoiceCommand() {
  clearTimeout(timer);
  if (state === "listening") backend.cancelDictation();
  if (state === "memo") backend.stopRecording().catch(() => {});
  backend.discardCaptured().catch(() => {});
  state = "idle";
  memo = null;
}

async function finish() {
  clearTimeout(timer);
  state = "working";
  const game = getRunningGame();
  try {
    const words = (await backend.stopDictation(game?.appId ?? "", game?.name ?? "")).trim();
    if (!words) {
      toaster.toast({ title: "Session Notes", body: "Didn't catch anything. Try again a little louder." });
    } else {
      await runCommand(words, game);
    }
  } catch (e) {
    toaster.toast({ title: "Voice command failed", body: errText(e) });
  } finally {
    if (state === "working") state = "idle";
    await shot?.catch(() => "");
    shot = null;
    backend.discardCaptured().catch(() => {});
  }
}

// ---- the commands ----

type Ctx = { words: string; rest: string; game: RunningGame };
type Command = {
  /** What to say; the first one is shown in the list. Spaces also match hyphens or nothing ("to do" = "todo"). */
  say: string[];
  /** Shown in the list of commands, e.g. "new note <text>". */
  usage: string;
  does: string;
  /** Only matches when nothing follows the keywords. */
  exact?: boolean;
  /** Needs a game running (anything that writes notes does). */
  game?: boolean;
  run: (ctx: Ctx) => Promise<string | void>;
};

const SEP = "[\\s,.:;!?\\-]";

function matcher(say: string[], exact?: boolean): RegExp {
  const words = say
    .map((k) => k.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(`${SEP}*`))
    .sort((a, b) => b.length - a.length)
    .join("|");
  const tail = exact ? `${SEP}*` : `(?:${SEP}+(.*))?`;
  return new RegExp(`^${SEP}*(?:(?:please|okay|ok|hey)${SEP}+)?(?:${words})${tail}$`, "is");
}

const tidy = (text: string) => text.trim().replace(/^[\s,.:;!?\-]+/, "").trim();
const noEndPunct = (text: string) => text.replace(/[\s.,!?;:]+$/, "");

function titleFrom(text: string, fallback: string): string {
  const words = noEndPunct(text).split(/\s+/).filter(Boolean);
  if (!words.length) return fallback;
  const title = words.slice(0, 8).join(" ");
  return words.length > 8 ? `${noEndPunct(title)}…` : title;
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function blankNote(fields: Partial<Note>): Note {
  return {
    id: newId(),
    folderId: null,
    title: "",
    body: "",
    tags: ["voice"],
    screenshots: [],
    recordings: [],
    pinned: false,
    createdAt: 0,
    updatedAt: 0,
    launchNumber: null,
    ...fields,
  };
}

async function loadGame(game: RunningGame): Promise<Game> {
  await backend.ensureGame(game.appId, game.name);
  return backend.getGame(game.appId);
}

async function createNote(game: RunningGame, fields: Partial<Note>, what: string): Promise<Note> {
  await backend.ensureGame(game.appId, game.name);
  const note = await backend.saveNote(game.appId, blankNote(fields));
  lastNote = { appId: game.appId, id: note.id };
  undo = {
    label: what,
    run: async () => {
      await backend.deleteNote(game.appId, note.id);
      for (const m of [...note.screenshots, ...note.recordings]) await backend.deleteMedia(game.appId, m).catch(() => {});
    },
  };
  emitDataChanged();
  return note;
}

/** The note the last command used, or else the one edited most recently. */
async function targetNote(game: RunningGame): Promise<Note | null> {
  const notes = (await loadGame(game)).notes;
  if (lastNote?.appId === game.appId) {
    const n = notes.find((x) => x.id === lastNote!.id);
    if (n) return n;
  }
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

async function changeNote(game: RunningGame, note: Note, patch: Partial<Note>, what: string): Promise<Note> {
  const saved = await backend.saveNote(game.appId, { ...note, ...patch });
  lastNote = { appId: game.appId, id: note.id };
  undo = { label: what, run: async () => void (await backend.saveNote(game.appId, note)) };
  emitDataChanged();
  return saved;
}

/** Adds text to the last note, or starts a new one if the game has none yet. */
async function appendText(game: RunningGame, text: string, extra: Partial<Note> = {}): Promise<string> {
  const note = await targetNote(game);
  if (!note) {
    await createNote(game, { title: titleFrom(text, "Voice note"), body: text, ...extra }, "new note");
    return `📝 New note: ${titleFrom(text, "Voice note")}`;
  }
  const body = text ? (note.body.trim() ? `${note.body.trimEnd()}\n${text}` : text) : note.body;
  await changeNote(
    game,
    note,
    { body, screenshots: [...note.screenshots, ...(extra.screenshots ?? [])] },
    `addition to "${note.title}"`
  );
  return `➕ Added to "${note.title || "Untitled"}"`;
}

/** The screenshot taken when the combo was pressed, or a fresh one if that didn't work. */
async function takenShot(game: RunningGame): Promise<Screenshot> {
  let problem = shot ? await shot : "no screenshot yet";
  shot = null;
  if (problem) problem = await backend.captureScreen();
  if (problem) throw new Error(`Couldn't take a screenshot: ${problem}`);
  const item = await backend.attachCaptured(game.appId);
  if (!item) throw new Error("Couldn't take a screenshot");
  return item;
}

async function lastSteamShot(game: RunningGame): Promise<Screenshot> {
  const [newest] = await backend.listSteamScreenshots(game.appId, 1);
  if (!newest) throw new Error(`No Steam screenshots for ${game.name} yet. Take one with STEAM + R1 first.`);
  return backend.attachScreenshot(game.appId, newest.path);
}

async function todoNote(game: RunningGame): Promise<Note | null> {
  const notes = (await loadGame(game)).notes;
  return notes.find((n) => n.title.trim().toLowerCase().replace(/[\s-]/g, "") === "todo") ?? null;
}

const simplify = (text: string) => noEndPunct(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

/** The item whose words overlap the most with what was said. */
function bestMatch<T>(items: T[], text: (t: T) => string, said: string): T | null {
  const want = new Set(simplify(said).split(" ").filter(Boolean));
  let best: T | null = null;
  let score = 0;
  for (const it of items) {
    const words = simplify(text(it)).split(" ");
    const s = words.filter((w) => want.has(w)).length / Math.max(want.size, 1);
    if (s > score) {
      score = s;
      best = it;
    }
  }
  return score >= 0.5 ? best : null;
}

async function findCounter(game: RunningGame, kind: CounterKind, name: string): Promise<Counter | null> {
  const counters = ((await loadGame(game)).counters ?? []).filter((c) => c.kind === kind);
  if (!name) return counters[0] ?? null;
  return bestMatch(counters, (c) => c.name, name);
}

async function bump(game: RunningGame, kind: CounterKind, name: string, delta: number): Promise<string> {
  let counter = await findCounter(game, kind, name);
  if (!counter) {
    if (delta < 0) throw new Error(`No counter called "${name}"`);
    const label = kind === "death" ? "Deaths" : capital(noEndPunct(name));
    if (!label) throw new Error("Say which counter, like \"count chests\"");
    counter = await backend.saveCounter(game.appId, { id: newId(), name: label, kind, count: 0, sessionCount: 0, createdAt: 0 });
  }
  const after = await backend.bumpCounter(game.appId, counter.id, delta);
  undo = { label: `${counter.name} ${delta > 0 ? "+" : "−"}1`, run: async () => void (await backend.bumpCounter(game.appId, counter!.id, -delta)) };
  emitDataChanged();
  return `${kind === "death" ? "💀" : kind === "boss" ? "⚔️" : "#"} ${counter.name}: ${after?.count ?? "?"}`;
}

async function forLastNote(game: RunningGame, fn: (note: Note) => Promise<string>): Promise<string> {
  const note = await targetNote(game);
  if (!note) throw new Error(`${game.name} has no notes yet`);
  return fn(note);
}

const KIND_WORDS: [NoteKind, string[]][] = [
  ["tip", ["tip", "hint"]],
  ["boss", ["boss", "boss note"]],
  ["secret", ["secret"]],
  ["build", ["build", "loadout"]],
  ["collectibles", ["collectibles", "collectible", "collectable", "collectables"]],
  ["guide", ["guide"]],
  ["walkthrough", ["walkthrough", "walk through"]],
  ["achievement", ["achievement", "trophy"]],
  ["settings", ["settings", "setting"]],
];

export const COMMANDS: Command[] = [
  {
    say: ["help", "commands", "what can i say"],
    usage: "help",
    does: "Shows a few of these commands",
    exact: true,
    run: async () => {
      toaster.toast({
        title: "🗣 Voice commands",
        body: "new note … · add … · screenshot … · to do … · done … · tag … · pin · left off … · died · count … · undo. Full list in Settings.",
        duration: 10000,
      });
    },
  },
  {
    say: ["cancel", "never mind", "nevermind", "forget it"],
    usage: "cancel",
    does: "Does nothing (if you started by mistake)",
    exact: true,
    run: async () => "Cancelled",
  },
  {
    say: ["undo", "undo that", "scratch that"],
    usage: "undo",
    does: "Undoes the last voice command",
    exact: true,
    run: async () => {
      if (!undo) return "Nothing to undo";
      const u = undo;
      undo = null;
      await u.run();
      emitDataChanged();
      return `↩️ Undid the ${u.label}`;
    },
  },
  {
    say: ["open notes", "show notes", "open session notes", "notes"],
    usage: "open notes",
    does: "Opens the full-screen notes page",
    exact: true,
    run: async () => {
      openNotesPage();
    },
  },
  {
    say: ["add screenshot", "add a screenshot", "attach screenshot", "attach a screenshot", "screenshot to note", "screenshot to last note"],
    usage: "add screenshot <text>",
    does: "Screenshot (taken when you pressed the combo) added to the last note, with any text",
    game: true,
    run: async ({ rest, game }) => (await appendText(game, rest, { screenshots: [await takenShot(game)] })).replace("Added", "Screenshot added"),
  },
  {
    say: ["last screenshot", "use last screenshot", "steam screenshot", "latest screenshot"],
    usage: "last screenshot <text>",
    does: "New note with the newest Steam screenshot (STEAM + R1) for this game",
    game: true,
    run: async ({ rest, game }) => {
      const pic = await lastSteamShot(game);
      await createNote(game, { title: titleFrom(rest, "Screenshot"), body: rest, screenshots: [pic] }, "screenshot note");
      return `📸 New note with your last screenshot`;
    },
  },
  {
    say: ["screenshot", "screen shot", "take screenshot", "take a screenshot", "snap", "snapshot", "capture", "picture"],
    usage: "screenshot <text>",
    does: "New note with a screenshot of the moment you pressed the combo, text becomes the note",
    game: true,
    run: async ({ rest, game }) => {
      const pic = await takenShot(game);
      await createNote(game, { title: titleFrom(rest, "Screenshot"), body: rest, screenshots: [pic] }, "screenshot note");
      return `📸 New note: ${titleFrom(rest, "Screenshot")}`;
    },
  },
  {
    say: ["died", "i died", "death", "dead", "another death", "plus death", "add death"],
    usage: "died",
    does: "Adds one to the death counter (made if missing)",
    exact: true,
    game: true,
    run: async ({ game }) => bump(game, "death", "", 1),
  },
  {
    say: ["boss attempt", "attempt", "try again", "another try", "another attempt"],
    usage: "boss attempt <boss>",
    does: "Adds one to that boss's attempt counter (made if missing)",
    game: true,
    run: async ({ rest, game }) => bump(game, "boss", rest, 1),
  },
  {
    say: ["beat", "defeated", "boss down", "beat the boss", "boss defeated"],
    usage: "defeated <boss>",
    does: "Marks a boss counter as beaten",
    game: true,
    run: async ({ rest, game }) => {
      const counter = await findCounter(game, "boss", rest);
      if (!counter) throw new Error(rest ? `No boss counter like "${noEndPunct(rest)}"` : "No boss counters yet");
      await backend.saveCounter(game.appId, { ...counter, defeated: true });
      undo = { label: "boss win", run: async () => void (await backend.saveCounter(game.appId, counter)) };
      emitDataChanged();
      return `🏆 ${counter.name} defeated after ${counter.count} attempts`;
    },
  },
  {
    say: ["minus", "take one from", "remove one from", "subtract"],
    usage: "minus <counter>",
    does: "Takes one off a counter",
    game: true,
    run: async ({ rest, game }) => {
      if (/death|died/i.test(rest)) return bump(game, "death", "", -1);
      for (const kind of ["custom", "boss"] as CounterKind[]) {
        const c = await findCounter(game, kind, rest);
        if (c) return bump(game, kind, c.name, -1);
      }
      throw new Error(`No counter like "${noEndPunct(rest)}"`);
    },
  },
  {
    say: ["count", "plus one", "add one to", "one more"],
    usage: "count <name>",
    does: "Adds one to a custom counter (\"count chests\"), made if missing",
    game: true,
    run: async ({ rest, game }) => bump(game, "custom", rest, 1),
  },
  {
    say: ["voice memo", "record memo", "record", "memo", "record audio"],
    usage: "voice memo",
    does: "Records audio until you press the combo again, saved as a new note with its transcript",
    exact: true,
    game: true,
    run: async ({ game }) => {
      await backend.startRecording(game.appId);
      memo = { game, started: Date.now() };
      state = "memo";
      toaster.toast({ title: "🔴 Recording memo…", body: `Press ${comboText()} to stop.`, duration: 4000 });
    },
  },
  {
    say: ["new note", "create note", "create a note", "make a note", "make note", "note", "write down", "write"],
    usage: "new note <text>",
    does: "New note for this game; the first words become its title",
    game: true,
    run: async ({ rest, game }) => {
      if (!rest) throw new Error('Say what to write, like "new note the key is under the bridge"');
      await createNote(game, { title: titleFrom(rest, "Voice note"), body: rest }, "new note");
      return `📝 New note: ${titleFrom(rest, "Voice note")}`;
    },
  },
  ...KIND_WORDS.map(([kind, words]): Command => ({
    say: [...words.map((w) => `new ${w}`), ...words],
    usage: `${words[0]} <text>`,
    does: `New note marked as a ${kind === "collectibles" ? "collectibles" : kind} note`,
    game: true,
    run: async ({ rest, game }) => {
      if (!rest) throw new Error(`Say the ${words[0]} too, like "${words[0]} …"`);
      await createNote(game, { title: titleFrom(rest, capital(words[0])), body: rest, kind }, `${words[0]} note`);
      return `📝 New ${words[0]}: ${titleFrom(rest, "")}`;
    },
  })),
  {
    say: ["title", "rename", "rename note", "call it", "name it"],
    usage: "title <text>",
    does: "Renames the last note",
    game: true,
    run: async ({ rest, game }) =>
      forLastNote(game, async (note) => {
        if (!rest) throw new Error("Say the new title too");
        await changeNote(game, note, { title: capital(noEndPunct(rest)) }, "rename");
        return `✏️ Renamed to "${capital(noEndPunct(rest))}"`;
      }),
  },
  {
    say: ["to do", "add to do", "task", "remind me to", "remind me"],
    usage: "to do <text>",
    does: `Adds a checklist item to the game's "${TODO_TITLE}" note (made if missing)`,
    game: true,
    run: async ({ rest, game }) => {
      if (!rest) throw new Error('Say the task too, like "to do buy arrows"');
      const item = { id: newId(), text: capital(noEndPunct(rest)), done: false };
      const note = await todoNote(game);
      if (note) await changeNote(game, note, { checklist: [...(note.checklist ?? []), item] }, "to-do item");
      else await createNote(game, { title: TODO_TITLE, checklist: [item] }, "to-do note");
      return `☑️ To do: ${item.text}`;
    },
  },
  {
    say: ["done", "check off", "check", "finished", "completed", "complete", "tick"],
    usage: "done <text>",
    does: "Ticks off the matching to-do item (the first open one if you say just \"done\")",
    game: true,
    run: async ({ rest, game }) => {
      const note = await todoNote(game);
      const open = (note?.checklist ?? []).filter((i) => !i.done);
      if (!note || !open.length) throw new Error("Nothing left on the to-do list");
      const item = rest ? bestMatch(open, (i) => i.text, rest) : open[0];
      if (!item) throw new Error(`No to-do item like "${noEndPunct(rest)}"`);
      await changeNote(game, note, { checklist: note.checklist!.map((i) => (i.id === item.id ? { ...i, done: true } : i)) }, "tick");
      return `✅ Done: ${item.text}`;
    },
  },
  {
    say: ["add tag", "add tags", "tags", "tag"],
    usage: "tag <words>",
    does: "Adds tags to the last note (\"tag boss and fire\" adds two)",
    game: true,
    run: async ({ rest, game }) =>
      forLastNote(game, async (note) => {
        const tags = simplify(rest).split(/\s+(?:and)\s+|\s+/).filter((t) => t && t !== "and");
        if (!tags.length) throw new Error("Say the tag too, like \"tag boss\"");
        await changeNote(game, note, { tags: [...new Set([...note.tags, ...tags])] }, "tags");
        return `🏷 Tagged ${tags.join(", ")}`;
      }),
  },
  {
    say: ["pin to screen", "show on screen", "pin on screen"],
    usage: "pin to screen",
    does: "Shows the last note's checklist on screen (Pin to screen)",
    exact: true,
    game: true,
    run: async ({ game }) =>
      forLastNote(game, async (note) => {
        const st = await backend.pinOverlay(game.appId, note.id);
        return st.overlayRunning ? `📌 "${note.title}" is on screen` : "📌 Pinned. Turn on Steam's Performance Overlay to see it";
      }),
  },
  {
    say: ["unpin from screen", "hide from screen", "clear screen", "remove from screen"],
    usage: "clear screen",
    does: "Takes the pinned note off the screen",
    exact: true,
    run: async () => {
      await backend.unpinOverlay();
      return "Removed from screen";
    },
  },
  {
    say: ["unpin", "unpin note"],
    usage: "unpin",
    does: "Unpins the last note",
    exact: true,
    game: true,
    run: async ({ game }) =>
      forLastNote(game, async (note) => {
        await changeNote(game, note, { pinned: false }, "unpin");
        return `Unpinned "${note.title}"`;
      }),
  },
  {
    say: ["pin", "pin note", "pin it", "pin that"],
    usage: "pin",
    does: "Pins the last note to the top of the list",
    exact: true,
    game: true,
    run: async ({ game }) =>
      forLastNote(game, async (note) => {
        await changeNote(game, note, { pinned: true }, "pin");
        return `📌 Pinned "${note.title}"`;
      }),
  },
  {
    say: ["spoiler", "mark spoiler", "mark as spoiler", "hide it"],
    usage: "spoiler",
    does: "Hides the last note behind a spoiler warning (say it again to undo)",
    exact: true,
    game: true,
    run: async ({ game }) =>
      forLastNote(game, async (note) => {
        await changeNote(game, note, { spoiler: !note.spoiler }, "spoiler");
        return note.spoiler ? "Not a spoiler any more" : `🙈 "${note.title}" marked as a spoiler`;
      }),
  },
  {
    say: ["left off", "i left off", "where i left off", "left off at", "bookmark"],
    usage: "left off <text>",
    does: "Sets the \"where I left off\" pin you see next time you play",
    game: true,
    run: async ({ rest, game }) => {
      if (!rest) throw new Error("Say where you left off too");
      const before = (await loadGame(game)).leftOff?.text ?? "";
      await backend.setLeftOff(game.appId, capital(rest));
      undo = { label: "left-off pin", run: async () => void (await backend.setLeftOff(game.appId, before)) };
      emitDataChanged();
      return `🔖 Left off: ${capital(rest)}`;
    },
  },
  {
    say: ["add to note", "add to last note", "add to the note", "append", "add", "also"],
    usage: "add <text>",
    does: "Adds a line to the last note (the one your last command used, or the latest edited)",
    game: true,
    run: async ({ rest, game }) => {
      if (!rest) throw new Error('Say what to add, like "add he sells the lantern too"');
      return appendText(game, rest);
    },
  },
  {
    say: ["type"],
    usage: "type <text>",
    does: "Types the text into whatever has focus, like the on-screen keyboard",
    run: async ({ rest }) => {
      const input = (window as any).SteamClient?.Input;
      if (!rest || typeof input?.ControllerKeyboardSendText !== "function") throw new Error("Couldn't type that");
      input.ControllerKeyboardSendText(rest);
      return `✍️ Typed: ${rest}`;
    },
  },
];

const MATCHERS = COMMANDS.map((c) => ({ c, re: matcher(c.say, c.exact) }));

export async function runCommand(words: string, game: RunningGame | null) {
  let found: { c: Command; rest: string } | null = null;
  for (const { c, re } of MATCHERS) {
    const m = words.match(re);
    if (m) {
      found = { c, rest: tidy(m[1] ?? "") };
      break;
    }
  }
  if (!found) {
    const fallback = getSettings().voiceFallback ?? "note";
    if (fallback === "nothing" || !game) {
      toaster.toast({ title: "🤷 Not a command", body: `"${words}". Say "help" for the list.`, duration: 6000 });
      return;
    }
    const body = tidy(words);
    found = fallback === "append"
      ? { c: COMMANDS.find((c) => c.usage === "add <text>")!, rest: body }
      : { c: COMMANDS.find((c) => c.usage === "new note <text>")!, rest: body };
  }
  if (found.c.game && !game) {
    toaster.toast({ title: "Start a game first", body: `"${found.c.usage}" saves to the game you're playing.` });
    return;
  }
  const result = await found.c.run({ words, rest: found.rest, game: game! });
  if (result) toaster.toast({ title: "Session Notes", body: result, duration: 4000 });
}

async function finishMemo() {
  const m = memo;
  memo = null;
  state = "working";
  try {
    const rec: Recording | null = await backend.stopRecording();
    if (!m || !rec) throw new Error("Nothing was recorded");
    const when = new Date(m.started).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const note = await createNote(m.game, { title: `Voice memo ${when}`, recordings: [rec] }, "voice memo");
    toaster.toast({ title: "🎙 Memo saved", body: `${m.game.name}: ${note.title}` });
    // Write it out in the background; the note keeps the audio either way.
    backend
      .transcribeRecording(m.game.appId, rec.file)
      .then(async (text) => {
        if (!text) return;
        const fresh = (await backend.getGame(m.game.appId)).notes.find((n) => n.id === note.id);
        if (fresh && !fresh.body) await backend.saveNote(m.game.appId, { ...fresh, title: titleFrom(text, fresh.title), body: text });
        emitDataChanged();
      })
      .catch(() => {});
  } catch (e) {
    toaster.toast({ title: "Voice memo failed", body: errText(e) });
  } finally {
    state = "idle";
  }
}
