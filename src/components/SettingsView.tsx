import { FC, useEffect, useState } from "react";
import { ButtonItem, DropdownItem, PanelSectionRow, TextField, ToggleField } from "@decky/ui";
import { backend } from "../api/backend";
import { emitDataChanged, loadSettings, updateSettings, useSettings } from "../state/notesStore";
import { BackupStatus, DictateTarget, OpenChord } from "../types";
import { refreshSpeech, useSpeechAllowed } from "../state/speech";
import { LinkPanel } from "./Bookstore";
import { PositionPicker } from "./PositionPicker";
import { useSeenButtons } from "../opening";
import { formatDateTime } from "../utils/format";
import { errText } from "../utils/errors";

const CHORD_OPTIONS: { label: string; data: OpenChord }[] = [
  { label: "L4 + R4 (upper back grips)", data: "l4r4" },
  { label: "L5 + R5 (lower back grips)", data: "l5r5" },
  { label: "L3 + R3 (click both sticks)", data: "l3r3" },
  { label: "Off", data: "off" },
];

const DICTATE_TARGETS: { label: string; data: DictateTarget }[] = [
  { label: "Type it where I am", data: "type" },
  { label: "Save it as a note for this game", data: "note" },
];

const SPEECH_LANGUAGES = [
  { label: "Detect automatically", data: "" },
  ...([["en", "English"], ["fr", "French"], ["es", "Spanish"], ["de", "German"], ["it", "Italian"], ["pt", "Portuguese"],
    ["nl", "Dutch"], ["pl", "Polish"], ["ru", "Russian"], ["ja", "Japanese"], ["ko", "Korean"], ["zh", "Chinese"]] as const)
    .map(([data, label]) => ({ label, data: data as string })),
];

const PAIR_CODE = /^[A-Z0-9]{3}-?[A-Z0-9]{3}$/i;

const INTERVAL_OPTIONS = [
  { label: "Every minute", data: 1 },
  { label: "Every 5 minutes", data: 5 },
  { label: "Every 10 minutes", data: 10 },
  { label: "Every 30 minutes", data: 30 },
  { label: "Every 60 minutes", data: 60 },
  { label: "Manual only", data: 0 },
];

const Heading: FC<{ children: string }> = ({ children }) => (
  <div style={{ fontSize: "12px", textTransform: "uppercase", opacity: 0.6, margin: "14px 0 4px", letterSpacing: "0.05em" }}>
    {children}
  </div>
);

export const SettingsView: FC = () => {
  const settings = useSettings();
  const interval = settings.syncInterval ?? (settings.autoBackup ? 1 : 0);
  const [url, setUrl] = useState(settings.syncUrl ?? "");
  const [token, setToken] = useState(settings.syncToken ?? "");
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [bsUrl, setBsUrl] = useState(settings.bookstoreUrl ?? "https://bookstore.marshymadness.com");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSpeak = useSpeechAllowed();
  const refreshStatus = () => backend.backupStatus().then(setStatus);
  useEffect(() => {
    refreshStatus();
    refreshSpeech();
  }, []);
  useEffect(() => {
    setUrl(settings.syncUrl ?? "");
    setToken(settings.syncToken ?? "");
  }, [settings.syncUrl, settings.syncToken]);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(true);
    setMessage(`${label}…`);
    try {
      await updateSettings({ syncUrl: url.trim(), syncToken: token.trim() });
      if (PAIR_CODE.test(token.trim())) {
        // A pairing code from the website: swap it for a device token.
        const user = await backend.pairDevice(token.trim());
        await loadSettings();
        refreshSpeech();
        setMessage(`🔗 Linked to ${user.name}'s account`);
      }
      setMessage(await fn());
    } catch (e) {
      setMessage(`⚠️ ${errText(e)}`);
    } finally {
      setBusy(false);
      refreshStatus();
    }
  };

  const test = () => run("Checking", async () => {
    await backend.testBackupServer();
    return "✅ Connected";
  });
  const syncNow = () =>
    run("Syncing", async () => {
      const r = await backend.syncNow();
      emitDataChanged();
      return `✅ Synced: sent ${r.pushed} game(s), received changes for ${r.pulled}`;
    });

  return (
    <>
      <Heading>Opening Session Notes</Heading>
      <PanelSectionRow>
        <ToggleField
          label="Show in the Steam menu"
          description="Add Session Notes to the main Steam-button menu. It opens the full-screen notes page."
          checked={settings.mainMenuEntry ?? false}
          onChange={(v) => updateSettings({ mainMenuEntry: v })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          label="Own Quick Access tab"
          description="Give Session Notes its own tab in the Quick Access menu, so you don't have to go through Decky. Takes effect the next time you open the menu."
          checked={settings.qamTab ?? false}
          onChange={(v) => updateSettings({ qamTab: v })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <DropdownItem
          label="Button combo"
          description="Press it any time, even in a game, to open the full-screen notes page. B closes it."
          rgOptions={CHORD_OPTIONS}
          selectedOption={settings.openChord ?? "l4r4"}
          onChange={(o) => updateSettings({ openChord: o.data })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonsSeen />
      </PanelSectionRow>

      <Heading>While playing</Heading>
      <PanelSectionRow>
        <ToggleField
          label="Screenshot prompt"
          description="After you take a screenshot (STEAM + R1), offer to attach it to a note."
          checked={settings.screenshotPrompt ?? true}
          onChange={(v) => updateSettings({ screenshotPrompt: v })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          label="Remove from Steam screenshots"
          description="After a screenshot is attached to a note, delete it from Steam's screenshot library. The note keeps its own copy."
          checked={settings.removeFromSteam ?? false}
          onChange={(v) => updateSettings({ removeFromSteam: v })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          label="Session recap"
          description="When you quit a game, ask where you left off. Your answer is pinned for next time."
          checked={settings.sessionRecap ?? false}
          onChange={(v) => updateSettings({ sessionRecap: v })}
        />
      </PanelSectionRow>

      {canSpeak && (
        <>
          <Heading>Speech to text</Heading>
          <PanelSectionRow>
            <ToggleField
              label="STEAM + L5 + R5 to speak"
              description="Hold STEAM and press both lower back buttons, talk, then press them again. Works anywhere, even in a game. Uses your sync server."
              checked={settings.dictateChord ?? false}
              onChange={(v) => updateSettings({ dictateChord: v })}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <DropdownItem
              label="What happens to the words"
              description="Typing works like Steam's on-screen keyboard. If no game is running, the words are always typed."
              rgOptions={DICTATE_TARGETS}
              selectedOption={settings.dictateTarget ?? "type"}
              disabled={!settings.dictateChord}
              onChange={(o) => updateSettings({ dictateTarget: o.data })}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <DropdownItem
              label="Language"
              rgOptions={SPEECH_LANGUAGES}
              selectedOption={settings.speechLanguage ?? ""}
              onChange={(o) => updateSettings({ speechLanguage: o.data || undefined })}
            />
          </PanelSectionRow>
        </>
      )}

      <Heading>Pin to screen</Heading>
      <PanelSectionRow>
        <ToggleField
          label="Hide Steam's performance stats"
          description="Only show your pinned to-dos, not FPS, battery and the rest. The Performance Overlay still has to be on (Level 1 or higher)."
          checked={settings.overlayHideStats ?? false}
          onChange={(v) => updateSettings({ overlayHideStats: v })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <PositionPicker
          value={settings.overlayPosition ?? "top-left"}
          onChange={(p) => updateSettings({ overlayPosition: p })}
        />
      </PanelSectionRow>

      <Heading>Sync</Heading>
      <PanelSectionRow>
        <TextField
          label="Server address"
          description="e.g. https://steamnotes.example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <TextField
          label="Pairing code or token"
          description="On the website: your name → Devices → Connect a device. Type the code shown there (like K7P-4QX)."
          value={token}
          onChange={(e) => setToken(e.target.value)}
          bIsPassword={!PAIR_CODE.test(token.trim())}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <DropdownItem
          label="Check website for changes"
          description={
            interval === 0
              ? "Nothing syncs until you press Sync now."
              : "Your Deck edits are sent ~20 seconds after you make them."
          }
          rgOptions={INTERVAL_OPTIONS}
          selectedOption={interval}
          disabled={!settings.syncUrl}
          onChange={(o) => updateSettings({ syncInterval: o.data })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <div style={{ display: "flex", gap: "6px" }}>
          <ButtonItem layout="below" onClick={test} disabled={busy || !url.trim()}>
            Test
          </ButtonItem>
          <ButtonItem layout="below" onClick={syncNow} disabled={busy || !url.trim()}>
            Sync now
          </ButtonItem>
        </div>
      </PanelSectionRow>
      <Heading>Bookstore</Heading>
      <PanelSectionRow>
        <TextField
          label="Bookstore address"
          description="The public library behind the Bookstore tab"
          value={bsUrl}
          onChange={(e) => setBsUrl(e.target.value)}
          onBlur={() => updateSettings({ bookstoreUrl: bsUrl.trim() || undefined })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        {settings.bookstoreUser ? (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ flex: 1 }}>Linked as {settings.bookstoreUser.name}</div>
            <ButtonItem layout="below" onClick={async () => { await backend.bsUnlink(); await loadSettings(); }}>
              Unlink
            </ButtonItem>
          </div>
        ) : (
          <LinkPanel />
        )}
      </PanelSectionRow>

      <div style={{ fontSize: "12px", opacity: 0.75, padding: "4px 0" }}>
        {message && <div>{message}</div>}
        {status && (
          <div>
            Last sync: {formatDateTime(status.lastBackup)}
            {status.lastError && !message && <div>⚠️ Last attempt failed: {status.lastError}</div>}
          </div>
        )}
      </div>
    </>
  );
};

/** Live check for the button combo: hold the buttons and their names should show up here. */
const ButtonsSeen: FC = () => {
  const seen = useSeenButtons();
  const [deck, setDeck] = useState<{ devices: number; error: string | null } | null>(null);
  useEffect(() => {
    backend.buttonsStatus().then(setDeck).catch(() => {});
  }, []);
  return (
    <div style={{ fontSize: "12px", opacity: 0.8, padding: "4px 0" }}>
      Buttons held: {seen === null ? "nothing reported yet" : seen.names ? `${seen.names} (from ${seen.source})` : "none"}
      {deck && (
        <div>
          Deck controller: {deck.devices ? "listening" : `not connected${deck.error ? ` (${deck.error})` : ""}`}
        </div>
      )}
      <div style={{ opacity: 0.7 }}>Hold your combo and its buttons should show up here.</div>
    </div>
  );
};
