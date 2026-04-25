/**
 * Hard wall-clock timeout for any Promise. The wrapped promise keeps
 * running in the background — Promise.race only short-circuits the
 * await — so this is *not* a cancellation primitive. It's an escape
 * hatch when you'd rather take a missing result than let a stuck
 * call wedge an entire pipeline stage.
 *
 * Use sparingly: for HTTP-bound work, prefer AbortSignal.timeout()
 * which actually cancels the request. Use this only when the
 * underlying API doesn't accept a signal (e.g. an SDK call with a
 * built-in timeoutMs that turns out to be too generous).
 */
export class TimeoutError extends Error {
  constructor(public readonly label: string, public readonly ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}
