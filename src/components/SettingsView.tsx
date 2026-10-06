import { FC, useEffect, useState } from "react";
import { ButtonItem, DialogButton, DropdownItem, Focusable, PanelSectionRow, TextField, ToggleField } from "@decky/ui";
import { backend } from "../api/backend";
import { emitDataChanged, loadSettings, updateSettings, useSettings } from "../state/notesStore";
import { BackupStatus, BrowserMode, DictateTarget, ReaderCacheSettings, VoiceFallback } from "../types";
import { ComboRow, VoiceCommandList } from "./ComboSettings";
import { refreshSpeech, useSpeechAllowed } from "../state/speech";
import { LinkPanel } from "./Workshop";
import { openScrolls } from "../scrolls/ScrollsModal";
import { useScrolls } from "../scrolls/host";
import { openOverlayModal } from "./OverlayModal";
import { useSeenButtons } from "../opening";
import { formatDateTime } from "../utils/format";
import { errText } from "../utils/errors";
import { RadialItemsEditor } from "../radial/RadialSettings";
import { TomeList } from "../tomes/TomePicker";
import * as s from "./styles";

const DICTATE_TARGETS: { label: string; data: DictateTarget }[] = [
  { label: "Type it where I am", data: "type" },
  { label: "Save it as a note for this game", data: "note" },
];

const VOICE_FALLBACKS: { label: string; data: VoiceFallback }[] = [
  { label: "Save it as a new note", data: "note" },
  { label: "Add it to the last note", data: "append" },
  { label: "Nothing", data: "nothing" },
];

const SPEECH_LANGUAGES = [
  { label: "Detect automatically", data: "" },
  ...([["en", "English"], ["fr", "French"], ["es", "Spanish"], ["de", "German"], ["it", "Italian"], ["pt", "Portuguese"],
    ["nl", "Dutch"], ["pl", "Polish"], ["ru", "Russian"], ["ja", "Japanese"], ["ko", "Korean"], ["zh", "Chinese"]] as const)
    .map(([data, label]) => ({ label, data: data as string })),
];

const PAIR_CODE = /^[A-Z0-9]{3}-?[A-Z0-9]{3}$/i;

const BROWSER_MODES: { label: string; data: BrowserMode }[] = [
  { label: "Reader view (no ads)", data: "reader" },
  { label: "Full page", data: "full" },
];

const TEXT_SIZES = [13, 15, 17, 19, 21, 24].map((n) => ({ label: `${n} px${n === 17 ? " (normal)" : ""}`, data: n }));

const cacheDaysLabel = (d: number) => (d ? `After ${d} days` : "Never");

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

type Section = "desk" | "sync" | "workshop" | "controls";
const SECTIONS: { id: Section; label: string }[] = [
  { id: "desk", label: "Desk" },
  { id: "sync", label: "Sync" },
  { id: "workshop", label: "Workshop" },
  { id: "controls", label: "Controls" },
];
/** The settings tab you were on, kept while the plugin is loaded. */
let lastSection: Section = "desk";

/** Settings' own tabs: two to a line in the Quick Access menu, one line on the full-screen page. */
const SectionTabs: FC<{ current: Section; onChange: (x: Section) => void }> = ({ current, onChange }) => (
  <Focusable style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "6px" }}>
    {SECTIONS.map((x) => (
      <DialogButton
        key={x.id}
        onClick={() => onChange(x.id)}
        style={{
          ...s.smallButton,
          flex: "1 1 40%",
          justifyContent: "center",
          height: "36px",
          fontSize: "14px",
          fontWeight: current === x.id ? "bold" : undefined,
          ...(current === x.id ? s.tint("#1a9fff") : {}),
        }}
      >
        {x.label}
      </DialogButton>
    ))}
  </Focusable>
);

export const SettingsView: FC = () => {
  const settings = useSettings();
  const interval = settings.syncInterval ?? (settings.autoBackup ? 1 : 0);
  const [url, setUrl] = useState(settings.syncUrl ?? "");
  const [token, setToken] = useState(settings.syncToken ?? "");
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [bsUrl, setBsUrl] = useState(settings.bookstoreUrl ?? "https://workshop.marshymadness.com");
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

  const scrollCount = useScrolls().installed.length;
  const [section, setSectionState] = useState<Section>(lastSection);
  const setSection = (x: Section) => setSectionState((lastSection = x));
  return (
    <>
      <SectionTabs current={section} onChange={setSection} />

      {section === "desk" && (
        <>
          <Heading>Opening Desk of Madness</Heading>
          <PanelSectionRow>
            <ToggleField
              label="Show in the Steam menu"
              description="Add Desk of Madness to the main Steam-button menu. It opens the full-screen notes page."
              checked={settings.mainMenuEntry ?? false}
              onChange={(v) => updateSettings({ mainMenuEntry: v })}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ToggleField
              label="Own Quick Access tab"
              description="Give Desk of Madness its own tab in the Quick Access menu, so you don't have to go through Decky. Takes effect the next time you open the menu."
              checked={settings.qamTab ?? false}
              onChange={(v) => updateSettings({ qamTab: v })}
            />
          </PanelSectionRow>
          <Heading>Desk</Heading>
          <PanelSectionRow>
            <ToggleField
              label="A layout for each game"
              description="Changing the Desk while a game shows makes a layout just for that game. Off: every game shares one layout."
              checked={settings.desk?.perGame !== false}
              onChange={(v) => updateSettings({ desk: { ...settings.desk, perGame: v } })}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ToggleField
              label="Compact Tomes"
              description="Tighter Tomes with one line per item, so more fit in the Quick Access menu."
              checked={!!settings.desk?.compact}
              onChange={(v) => updateSettings({ desk: { ...settings.desk, compact: v } })}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ToggleField
              label="New-books badge"
              description="The Madness Workshop Tome says when new community books arrive for a game since you last looked."
              checked={settings.desk?.workshopBadge !== false}
              onChange={(v) => updateSettings({ desk: { ...settings.desk, workshopBadge: v } })}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <DropdownItem
              label="Counters: X adds"
              description="On the Counters Tome, A adds 1 and X adds this many."
              rgOptions={[2, 3, 5, 10].map((n) => ({ label: `+${n}`, data: n }))}
              selectedOption={settings.desk?.counterStep ?? 3}
              onChange={(o) => updateSettings({ desk: { ...settings.desk, counterStep: o.data } })}
            />
          </PanelSectionRow>
          {settings.desk?.games && Object.keys(settings.desk.games).length > 0 && (
            <PanelSectionRow>
              <ButtonItem
                layout="below"
                description={`${Object.keys(settings.desk.games).length} game(s) have their own layout.`}
                onClick={() => updateSettings({ desk: { ...settings.desk, games: {} } })}
              >
                Reset every game to the shared layout
              </ButtonItem>
            </PanelSectionRow>
          )}

          <Heading>Tomes</Heading>
          <PanelSectionRow>
            <TomeList appId={null} />
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

          <Heading>Browser</Heading>
          <PanelSectionRow>
            <DropdownItem
              label="Open links in notes as"
              description="The reader shows just the article, without ads or pop-ups. X switches between the two in the browser."
              rgOptions={BROWSER_MODES}
              selectedOption={settings.browserMode ?? "reader"}
              onChange={(o) => updateSettings({ browserMode: o.data })}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <DropdownItem
              label="Reader text size"
              rgOptions={TEXT_SIZES}
              selectedOption={settings.readerTextSize ?? 17}
              onChange={(o) => updateSettings({ readerTextSize: o.data })}
            />
          </PanelSectionRow>

          <Heading>Pin to screen</Heading>
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              description={`${settings.overlayX != null ? `${settings.overlayX}, ${settings.overlayY} px` : "Top left"} · text ${
                settings.overlayTextSize ?? 13
              }px · ${settings.overlayHideStats ? "Steam's stats hidden" : "with Steam's stats"}`}
              onClick={openOverlayModal}
            >
              Position and look…
            </ButtonItem>
          </PanelSectionRow>

        </>
      )}

      {section === "sync" && (
        <>
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
          <div style={{ fontSize: "12px", opacity: 0.75, padding: "4px 0" }}>
            {message && <div>{message}</div>}
            {status && (
              <div>
                Last sync: {formatDateTime(status.lastBackup)}
                {status.lastError && !message && <div>⚠️ Last attempt failed: {status.lastError}</div>}
              </div>
            )}
          </div>
          {settings.syncUrl && <ReaderCacheAdmin />}
        </>
      )}

      {section === "workshop" && (
        <>
          <Heading>Madness Workshop</Heading>
          <PanelSectionRow>
            <TextField
              label="Workshop address"
              description="The community site behind the Workshop tab"
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

          <Heading>Scrolls</Heading>
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              description="Add-ons from the Madness Workshop: new Tomes, a News section on library pages, pinning Decky plugins and more. Turn each one on or off here."
              onClick={() => openScrolls("installed")}
            >
              📜 Manage Scrolls ({scrollCount} installed)
            </ButtonItem>
          </PanelSectionRow>

        </>
      )}

      {section === "controls" && (
        <>
          <Heading>Radial menu</Heading>
          <PanelSectionRow>
            <ComboRow
              action="radial"
              label="Radial menu"
              description="Hold it, aim with the right stick (or D-pad), let go to open: Notes, Desk, Web Browser, the current game's notes wheel, or notes you pinned to it."
              canTurnOff
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <RadialItemsEditor />
          </PanelSectionRow>

          <Heading>Straight to a page</Heading>
          <PanelSectionRow>
            <ComboRow
              action="open"
              label="Notes"
              description="The notes for the game you're playing, back where you were. Press it again to put the page away."
              canTurnOff
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ComboRow action="desk" label="Desk" description="Your Desk of Tomes, full screen." canTurnOff />
          </PanelSectionRow>
          <PanelSectionRow>
            <ComboRow action="web" label="Web Browser" description="The browser, on the page you had open last." canTurnOff />
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonsSeen />
          </PanelSectionRow>

          {canSpeak && (
            <>
              <Heading>Speech to text</Heading>
              <PanelSectionRow>
                <ToggleField
                  label="Speech to text combo"
                  description="Press the combo, talk, then press it again. Works anywhere, even in a game. Uses your sync server."
                  checked={settings.dictateChord ?? false}
                  onChange={(v) => updateSettings({ dictateChord: v })}
                />
              </PanelSectionRow>
              <PanelSectionRow>
                <ComboRow
                  action="dictate"
                  label="Speech to text buttons"
                  description="Hold the first button before the others if it's STEAM."
                  disabled={!settings.dictateChord}
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
              <Heading>Voice commands</Heading>
              <PanelSectionRow>
                <ToggleField
                  label="Voice command combo"
                  description="Separate from speech to text: press the combo, say a command like “new note …” or “screenshot …”, then press it again. Commands are fixed keywords; no AI guesses what you meant."
                  checked={settings.voiceCommands ?? false}
                  onChange={(v) => updateSettings({ voiceCommands: v })}
                />
              </PanelSectionRow>
              <PanelSectionRow>
                <ComboRow
                  action="voice"
                  label="Voice command buttons"
                  description="Screenshots are taken the moment you press it, so they show what you were looking at."
                  disabled={!settings.voiceCommands}
                />
              </PanelSectionRow>
              <PanelSectionRow>
                <DropdownItem
                  label="Words that aren't a command"
                  rgOptions={VOICE_FALLBACKS}
                  selectedOption={settings.voiceFallback ?? "note"}
                  disabled={!settings.voiceCommands}
                  onChange={(o) => updateSettings({ voiceFallback: o.data })}
                />
              </PanelSectionRow>
              {settings.voiceCommands && (
                <PanelSectionRow>
                  <VoiceCommandList />
                </PanelSectionRow>
              )}
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


          <Heading>Trackpads</Heading>
          <PanelSectionRow>
            <ToggleField
              label="Trackpads like the Steam store"
              description="On the notes page, in notes and in the browser: the left trackpad scrolls and the right one is a mouse (click it to click). Takes effect the next time a page opens."
              checked={settings.trackpadMouse ?? true}
              onChange={(v) => updateSettings({ trackpadMouse: v })}
            />
          </PanelSectionRow>
        </>
      )}
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

/** For server admins: how long the server keeps reader pages nobody opens. Hidden for everyone else. */
const ReaderCacheAdmin: FC = () => {
  const [st, setSt] = useState<ReaderCacheSettings | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    backend.readerSettings().then(setSt).catch(() => setSt(null));
  }, []);
  if (!st) return null;
  const size = st.readerCache.bytes < 1048576 ? `${Math.round(st.readerCache.bytes / 1024)} KB` : `${(st.readerCache.bytes / 1048576).toFixed(1)} MB`;
  return (
    <>
      <PanelSectionRow>
        <DropdownItem
          label="Server: delete unread reader pages"
          description={`Admin setting for everyone on the server. Pages nobody has opened for this long are deleted. ${st.readerCache.pages} saved (${size}).`}
          rgOptions={st.readerCacheChoices.map((d) => ({ label: cacheDaysLabel(d), data: d }))}
          selectedOption={st.readerCacheDays}
          onChange={async (o) => {
            try {
              setSt(await backend.setReaderCacheDays(o.data));
              setNote(null);
            } catch (e) {
              setNote(`⚠️ ${errText(e)}`);
            }
          }}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          description={note ?? undefined}
          onClick={async () => {
            try {
              const r = await backend.clearReaderCache();
              setSt({ ...st, readerCache: r.readerCache });
              setNote(`Removed ${r.removed} pages`);
            } catch (e) {
              setNote(`⚠️ ${errText(e)}`);
            }
          }}
        >
          Clear the reader cache now
        </ButtonItem>
      </PanelSectionRow>
    </>
  );
};
