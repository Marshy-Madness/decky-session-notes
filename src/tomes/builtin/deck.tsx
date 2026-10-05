import { FC, useEffect, useState } from "react";
import { backend } from "../../api/backend";
import { BackupStatus } from "../../types";
import { formatWhen } from "../../utils/format";
import { registerTome } from "../registry";
import { Hint } from "../bits";

// The Deck itself: off by default, since the Desk is about your games.

type Stats = Awaited<ReturnType<typeof backend.systemStats>>;

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(bytes >= 100 * 1024 ** 3 ? 0 : 1)} GB`;

/** Calls `load` now and every `ms` while the Tome is on screen. */
function usePoll<T>(load: () => Promise<T>, ms: number): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () => load().then((v) => alive && setValue(v)).catch(() => {});
    run();
    const t = setInterval(run, ms);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return value;
}

const Bar: FC<{ value: number; warn?: number }> = ({ value, warn = 0.85 }) => (
  <div style={{ height: "6px", borderRadius: "3px", background: "rgba(255,255,255,0.1)", overflow: "hidden", marginTop: "3px" }}>
    <div style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, height: "100%", background: value >= warn ? "#e5534b" : "#1a9fff" }} />
  </div>
);

const Row: FC<{ label: string; value: string; bar?: number; warn?: number }> = ({ label, value, bar, warn }) => (
  <div style={{ marginBottom: "6px", fontSize: "14px" }}>
    <div style={{ display: "flex" }}>
      <span style={{ opacity: 0.65, flex: 1 }}>{label}</span>
      <b>{value}</b>
    </div>
    {bar != null && <Bar value={bar} warn={warn} />}
  </div>
);

const SystemTome: FC = () => {
  const st = usePoll<Stats>(backend.systemStats, 3000);
  if (!st) return <Hint>Reading…</Hint>;
  const { temps, memory, battery, load } = st;
  return (
    <>
      {temps.cpu != null && <Row label="CPU temperature" value={`${Math.round(temps.cpu)} °C`} bar={temps.cpu / 100} warn={0.9} />}
      {temps.gpu != null && <Row label="GPU temperature" value={`${Math.round(temps.gpu)} °C`} bar={temps.gpu / 100} warn={0.9} />}
      {load != null && <Row label="CPU load" value={`${Math.round(load * 100)}%`} bar={load} />}
      {memory.total && memory.used != null && <Row label="Memory" value={`${gb(memory.used)} of ${gb(memory.total)}`} bar={memory.used / memory.total} />}
      {battery && <Row label={`Battery${battery.status ? ` (${battery.status.toLowerCase()})` : ""}`} value={`${battery.percent}%`} bar={battery.percent / 100} warn={2} />}
    </>
  );
};

const StorageTome: FC = () => {
  const drives = usePoll(backend.storageStats, 60_000);
  if (!drives) return <Hint>Reading…</Hint>;
  return (
    <>
      {drives.map((d) => (
        <Row key={d.path} label={d.label} value={`${gb(d.free)} free of ${gb(d.total)}`} bar={1 - d.free / d.total} warn={0.9} />
      ))}
    </>
  );
};

const NetworkTome: FC = () => {
  const net = usePoll(backend.networkStats, 10_000);
  const sync = usePoll<BackupStatus>(backend.backupStatus, 15_000);
  if (!net) return <Hint>Reading…</Hint>;
  return (
    <>
      <Row label="Wi-Fi" value={net.connected ? net.ssid ?? "Connected" : "Not connected"} />
      {net.signal != null && <Row label="Signal" value={`${net.signal}%`} bar={net.signal / 100} warn={2} />}
      {sync && (
        <Row
          label="Notes sync"
          value={sync.running ? "Syncing…" : sync.lastError ? `⚠️ ${sync.lastError}` : sync.lastBackup ? `Synced ${formatWhen(sync.lastBackup)}` : "Not set up"}
        />
      )}
    </>
  );
};

registerTome({
  id: "system",
  name: "System",
  icon: "🌡️",
  category: "deck",
  description: "CPU and GPU temperature, load, memory and battery.",
  defaultOn: false,
  needsGame: false,
  component: SystemTome,
});
registerTome({
  id: "storage",
  name: "Storage",
  icon: "💾",
  category: "deck",
  description: "Free space on the Deck and any SD card.",
  defaultOn: false,
  needsGame: false,
  component: StorageTome,
});
registerTome({
  id: "network",
  name: "Network",
  icon: "🌐",
  category: "deck",
  description: "Wi-Fi, signal and when your notes last synced.",
  defaultOn: false,
  needsGame: false,
  component: NetworkTome,
});
