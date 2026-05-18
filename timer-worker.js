/**
 * Timer Web Worker
 * Runs in a separate thread — not throttled when the tab is in background.
 * Sends a 'tick' message every second while active.
 */
let interval = null;

self.onmessage = function(e) {
  if (e.data === 'start') {
    if (!interval) {
      interval = setInterval(() => self.postMessage('tick'), 1000);
    }
  } else if (e.data === 'stop') {
    clearInterval(interval);
    interval = null;
  }
};
