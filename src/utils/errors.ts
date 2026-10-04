/**
 * A readable message from a failed backend call. Decky turns Python errors into an Error named
 * "Python <ExceptionClass>", so String(e) can come out as just "Python Exception"; the real text is in
 * the message, or failing that the last line of the traceback.
 */
export function errText(e: unknown): string {
  if (e instanceof Error) {
    if (e.message) return e.message.replace(/^\w*(Error|Exception): /, "");
    const tb = (e as { pythonTraceback?: string }).pythonTraceback?.trim().split("\n").pop();
    if (tb) return tb.replace(/^[\w.]*(Error|Exception): /, "");
  }
  return String(e).replace(/^Error: /, "");
}
