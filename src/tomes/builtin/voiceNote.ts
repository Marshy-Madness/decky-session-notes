import { useSyncExternalStore } from "react";
import { toaster } from "@decky/api";
import { backend } from "../../api/backend";
import { emitDataChanged } from "../../state/notesStore";
import { speechAllowed } from "../../state/speech";
import { Game, Note } from "../../types";
import { newId } from "../../utils/format";
import { errText } from "../../utils/errors";

// A voice note straight from the Desk: record, and it's saved as a new note with the recording (and, when
// speech to text is allowed, its words as the title).

let recording: { appId: string; gameName: string; started: number } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useVoiceNoteRecording() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => recording
  );
}

export async function startVoiceNote(game: Game) {
  if (recording) return;
  try {
    await backend.startRecording(game.appId);
    recording = { appId: game.appId, gameName: game.name, started: Date.now() };
    emit();
  } catch (e) {
    toaster.toast({ title: "Couldn't start recording", body: errText(e) });
  }
}

export async function stopVoiceNote() {
  const rec = recording;
  if (!rec) return;
  recording = null;
  emit();
  const file = await backend.stopRecording();
  if (!file) {
    toaster.toast({ title: "Desk of Madness", body: "No audio was captured. Is a microphone available?" });
    return;
  }
  const when = new Date(rec.started).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const note: Note = {
    id: newId(),
    folderId: null,
    title: `🎙 Voice note · ${when}`,
    body: "",
    tags: [],
    screenshots: [],
    recordings: [file],
    pinned: false,
    createdAt: 0,
    updatedAt: 0,
    launchNumber: null,
    kind: "note",
  };
  const saved = await backend.saveNote(rec.appId, note);
  emitDataChanged();
  toaster.toast({ title: "Voice note saved", body: rec.gameName, duration: 3000 });
  if (!speechAllowed()) return;
  try {
    const words = (await backend.transcribeRecording(rec.appId, file.file)).trim();
    if (!words) return;
    const title = words.length > 60 ? words.slice(0, 57).replace(/\s+\S*$/, "") + "…" : words;
    await backend.saveNote(rec.appId, { ...saved, title: `🎙 ${title}`, recordings: [{ ...file, transcript: words }] });
    emitDataChanged();
  } catch {
    // the recording is saved either way; it can be transcribed from the note later
  }
}
