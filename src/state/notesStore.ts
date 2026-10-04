import { useEffect, useState, useSyncExternalStore } from "react";
import { backend } from "../api/backend";
import { Settings } from "../types";

// ---- "something changed on disk" signal, so open views can refetch ----

let dataVersion = 0;
const dataListeners = new Set<() => void>();

export function emitDataChanged() {
  dataVersion++;
  dataListeners.forEach((l) => l());
}

export function useDataVersion(): number {
  return useSyncExternalStore(
    (l) => {
      dataListeners.add(l);
      return () => dataListeners.delete(l);
    },
    () => dataVersion
  );
}

// ---- settings ----

let settings: Settings = {};
let loaded = false;
const settingsListeners = new Set<() => void>();

export function getSettings(): Settings {
  return settings;
}

export async function loadSettings() {
  settings = (await backend.getSettings()) ?? {};
  loaded = true;
  settingsListeners.forEach((l) => l());
}

export async function updateSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  settingsListeners.forEach((l) => l());
  await backend.saveSettings(settings);
}

export function useSettings(): Settings {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    settingsListeners.add(l);
    if (!loaded) loadSettings();
    return () => {
      settingsListeners.delete(l);
    };
  }, []);
  return settings;
}
