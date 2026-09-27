import { FC, useEffect, useState } from "react";
import { PanelSectionRow, TextField, ButtonItem } from "@decky/ui";
import { backend } from "../api/backend";
import { Settings } from "../types";

export const SettingsView: FC = () => {
  const [settings, setSettings] = useState<Settings>({});

  useEffect(() => {
    backend.getSettings().then(setSettings);
  }, []);

  const save = () => backend.saveSettings(settings);

  return (
    <>
      <PanelSectionRow>
        <TextField
          label="Break reminder (minutes)"
          value={settings.breakReminderMinutes ? String(settings.breakReminderMinutes) : ""}
          onChange={(e) => setSettings({ ...settings, breakReminderMinutes: Number(e.target.value) })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <TextField
          label="Sync path"
          value={settings.syncPath ?? ""}
          onChange={(e) => setSettings({ ...settings, syncPath: e.target.value })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={save}>
          Save Settings
        </ButtonItem>
      </PanelSectionRow>
    </>
  );
};
