import { toaster } from "@decky/api";
import { backend } from "./api/backend";
import { comboLabel, getCombo } from "./combos";
import { getRunningGame } from "./hooks/useAppLifetime";
import { emitDataChanged, getSettings } from "./state/notesStore";
import { speechAllowed } from "./state/speech";
import { errText } from "./utils/errors";
import { newId } from "./utils/format";

// Speech to text anywhere: the dictate combo (STEAM + L5 + R5 unless changed) starts listening, the same combo
// again stops. The words are typed
// into whatever has focus (through Steam's on-screen keyboard API, so games get them too), or saved as a note
// for the running game. Off unless turned on in settings, and only if the server owner allowed this account.

const MAX_LISTEN_MS = 60_000;
let state: "idle" | "listening" | "writing" = "idle";
let timer: ReturnType<typeof setTimeout> | undefined;

export function dictationBusy(): boolean {
  return state !== "idle";
}

export function dictationChordEnabled(): boolean {
  return !!getSettings().dictateChord && speechAllowed();
}

export async function toggleAnywhereDictation() {
  if (state === "writing") return;
  if (state === "listening") return finish();
  try {
    await backend.startDictation();
  } catch (e) {
    toaster.toast({ title: "Couldn't start listening", body: errText(e) });
    return;
  }
  state = "listening";
  timer = setTimeout(finish, MAX_LISTEN_MS);
  toaster.toast({ title: "🎙 Listening…", body: `Talk, then press ${comboLabel(getCombo("dictate"))} again.`, duration: 3000 });
}

async function finish() {
  clearTimeout(timer);
  state = "writing";
  const game = getRunningGame();
  try {
    const words = await backend.stopDictation(game?.appId ?? "", game?.name ?? "");
    if (!words) {
      toaster.toast({ title: "Session Notes", body: "Didn't catch anything. Try again a little louder." });
    } else if (getSettings().dictateTarget === "note" && game) {
      await saveAsNote(game.appId, game.name, words);
      toaster.toast({ title: `📝 Saved to ${game.name}`, body: words });
    } else if (typeWords(words)) {
      toaster.toast({ title: "✍️ Typed", body: words, duration: 3000 });
    } else {
      toaster.toast({ title: "🎙 You said", body: words, duration: 8000 });
    }
  } catch (e) {
    toaster.toast({ title: "Speech to text failed", body: errText(e) });
  } finally {
    state = "idle";
  }
}

function typeWords(words: string): boolean {
  const input = (window as any).SteamClient?.Input;
  if (typeof input?.ControllerKeyboardSendText !== "function") return false;
  input.ControllerKeyboardSendText(words);
  return true;
}

async function saveAsNote(appId: string, gameName: string, words: string) {
  await backend.ensureGame(appId, gameName);
  const title = words.split(/\s+/).slice(0, 8).join(" ").replace(/[.,!?;:]+$/, "");
  await backend.saveNote(appId, {
    id: newId(),
    folderId: null,
    title: words.split(/\s+/).length > 8 ? `${title}…` : title,
    body: words,
    tags: ["voice"],
    screenshots: [],
    recordings: [],
    pinned: false,
    createdAt: 0,
    updatedAt: 0,
    launchNumber: null,
  });
  emitDataChanged();
}

export function stopAnywhereDictation() {
  clearTimeout(timer);
  if (state === "listening") backend.cancelDictation();
  state = "idle";
}
