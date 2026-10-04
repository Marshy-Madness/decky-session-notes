import { useEffect, useState } from "react";

/** Milliseconds elapsed since `start`, ticking every second; 0 when `start` is null. */
export function useSessionTimer(start: number | null) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!start) {
      setElapsedMs(0);
      return;
    }
    setElapsedMs(Date.now() - start);
    const interval = setInterval(() => setElapsedMs(Date.now() - start), 1000);
    return () => clearInterval(interval);
  }, [start]);

  return elapsedMs;
}
