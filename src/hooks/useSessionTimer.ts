import { useEffect, useState } from "react";

export function useSessionTimer(start: number | null) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!start) {
      setElapsedMs(0);
      return;
    }
    const interval = setInterval(() => setElapsedMs(Date.now() - start), 1000);
    return () => clearInterval(interval);
  }, [start]);

  return elapsedMs;
}
