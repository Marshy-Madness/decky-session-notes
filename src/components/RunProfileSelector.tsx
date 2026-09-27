import { FC } from "react";
import { Dropdown, DropdownOption } from "@decky/ui";
import { useNotesContext } from "../state/notesStore";

export const RunProfileSelector: FC = () => {
  const { appId, runProfiles, activeRunProfile, setActiveRunProfile } = useNotesContext();

  if (!appId || runProfiles.length <= 1) return null;

  const options: DropdownOption[] = runProfiles.map((p) => ({ label: p.label, data: p.id }));

  return (
    <Dropdown
      rgOptions={options}
      selectedOption={activeRunProfile?.id}
      onChange={(option) => {
        const profile = runProfiles.find((p) => p.id === option.data);
        if (profile) setActiveRunProfile(profile);
      }}
    />
  );
};
