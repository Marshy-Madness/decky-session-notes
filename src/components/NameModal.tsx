import { FC, useState } from "react";
import { DialogButton, Focusable, ModalRoot, TextField } from "@decky/ui";

/** Small "type a name / short text" dialog used for folders, counters and the left-off pin. */
export const NameModal: FC<{
  heading: string;
  initial?: string;
  label?: string;
  allowEmpty?: boolean;
  onSubmit: (name: string) => void;
  closeModal?: () => void;
}> = ({ heading, initial, label = "Name", allowEmpty, onSubmit, closeModal }) => {
  const [name, setName] = useState(initial ?? "");
  const submit = () => {
    if (!name.trim() && !allowEmpty) return;
    onSubmit(name.trim());
    closeModal?.();
  };
  return (
    <ModalRoot onCancel={closeModal} onOK={submit}>
      <h3 style={{ marginTop: 0 }}>{heading}</h3>
      <TextField label={label} value={name} onChange={(e) => setName(e.target.value)} focusOnMount />
      <Focusable style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
        <DialogButton onClick={submit} disabled={!name.trim() && !allowEmpty}>
          Save
        </DialogButton>
        <DialogButton onClick={closeModal}>Cancel</DialogButton>
      </Focusable>
    </ModalRoot>
  );
};
