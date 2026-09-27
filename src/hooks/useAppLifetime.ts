import { useEffect, useState } from "react";

interface RunningGame {
  appId: string;
  name: string;
}

export function useAppLifetime() {
  const [runningGame, setRunningGame] = useState<RunningGame | null>(null);

  useEffect(() => {
    const registration = (window as any).SteamClient?.GameSessions?.RegisterForAppLifetimeNotifications(
      (notification: any) => {
        if (notification.bRunning) {
          const appId = String(notification.unAppID);
          const overview = (window as any).appStore?.GetAppOverviewByAppID?.(notification.unAppID);
          setRunningGame({ appId, name: overview?.display_name ?? appId });
        } else {
          setRunningGame(null);
        }
      }
    );

    return () => registration?.unregister();
  }, []);

  return runningGame;
}
