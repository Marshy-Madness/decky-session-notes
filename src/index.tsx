import { addEventListener, definePlugin, removeEventListener, toaster } from "@decky/api";
import { showModal } from "@decky/ui";
import { FaRegStickyNote } from "react-icons/fa";
import { backend } from "./api/backend";
import { QuickAccessPanel } from "./components/QuickAccessPanel";
import { SessionSummaryModal } from "./components/SessionSummaryModal";
import { AttachScreenshotsModal } from "./components/AttachScreenshotsModal";
import { getRunningGame, startLifetimeTracking } from "./hooks/useAppLifetime";
import { startIntegrations } from "./integrations";
import { emitDataChanged, getSettings, loadSettings } from "./state/notesStore";
import { addPendingScreenshot, getPendingScreenshots } from "./state/pendingScreenshots";

/** When you take a screenshot in-game, offer to attach it to a note. */
function startScreenshotWatch(): () => void {
  const registration = (window as any).SteamClient?.GameSessions?.RegisterForScreenshotNotification?.(
    async (n: { unAppID: number; strOperation: string }) => {
      const game = getRunningGame();
      if (n.strOperation !== "written" || !game || getSettings().screenshotPrompt === false) return;
      if (String(n.unAppID) !== game.appId && n.unAppID !== 0) return;

      // Steam fires this a moment before the file is fully on disk, so poll briefly.
      const takenAt = Date.now();
      let path: string | null = null;
      for (let i = 0; i < 6 && !path; i++) {
        await new Promise((r) => setTimeout(r, 750));
        path = await backend.findNewScreenshot(game.appId, takenAt);
      }
      if (!path || getPendingScreenshots()?.paths.includes(path)) return;
      addPendingScreenshot(game.appId, path);

      const count = getPendingScreenshots()?.paths.length ?? 1;
      toaster.toast({
        title: "Session Notes",
        body: count === 1 ? "Screenshot saved. Tap here (or open Session Notes) to attach it to a note." : `${count} screenshots waiting to be attached.`,
        duration: 5000,
        onClick: () => {
          const pending = getPendingScreenshots();
          if (pending) showModal(<AttachScreenshotsModal pending={pending} />);
        },
      });
    }
  );
  return () => registration?.unregister();
}

export default definePlugin(() => {
  loadSettings();
  const stopTracking = startLifetimeTracking((game) => {
    if (getSettings().sessionRecap) {
      showModal(<SessionSummaryModal appId={game.appId} gameName={game.name} />);
    }
  });
  const stopScreenshots = startScreenshotWatch();
  const stopIntegrations = startIntegrations();
  // The backend emits this after a sync pulls in edits made on the website.
  const onRemoteChange = () => emitDataChanged();
  addEventListener("data_changed", onRemoteChange);

  return {
    name: "Session Notes",
    titleView: <div>Session Notes</div>,
    content: <QuickAccessPanel />,
    icon: <FaRegStickyNote />,
    onDismount() {
      stopTracking();
      stopScreenshots();
      stopIntegrations();
      removeEventListener("data_changed", onRemoteChange);
    },
  };
});
