import { FC, useEffect, useState } from "react";
import { DialogButton, Focusable, Spinner } from "@decky/ui";
import * as s from "./styles";

// A spinner that doesn't spin forever: a failed backend call shows its error, and one that never answers
// says so after a while, both with a button to try again.

const SLOW_MS = 12000;

export const Loading: FC<{ error?: string | null; onRetry: () => void; what?: string }> = ({ error, onRetry, what = "your notes" }) => {
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setSlow(false);
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, [error, attempt]);
  const retry = () => {
    setAttempt((n) => n + 1);
    onRetry();
  };

  if (!error && !slow) return <Spinner style={{ width: "32px" }} />;
  return (
    <Focusable style={{ fontSize: "14px", padding: "8px 0" }}>
      <div style={{ marginBottom: "8px" }}>
        {error ? `Couldn't load ${what}: ${error}` : `Still waiting for ${what}. The plugin's backend isn't answering; restarting Decky Loader usually fixes that.`}
      </div>
      <DialogButton style={s.smallButton} onClick={retry}>
        Try again
      </DialogButton>
    </Focusable>
  );
};

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
