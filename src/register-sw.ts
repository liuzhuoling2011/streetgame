/** Register the production service worker and wait until it can intercept emulator fetches. */
export async function readyServiceWorker(): Promise<void> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    const url = `${import.meta.env.BASE_URL}sw.js`;
    await navigator.serviceWorker.register(url, { scope: import.meta.env.BASE_URL });
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => { window.setTimeout(resolve, 1800); }),
    ]);
  } catch {
    /* private mode, or preview without a secure context */
  }
}
