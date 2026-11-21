/**
 * One-shot animation bookkeeping (pure). The LCD boot flicker and the rain-bar
 * growth run once per route visit (at the first render that has data); the alert
 * shake runs only when a new alert id appears. Re-renders caused by refreshes or
 * ticks never replay them.
 * @module ui/anim
 */

/**
 * Create a tracker.
 * @returns {{next: (o: {route: string, hasData: boolean, alertId: (string|null), continuation?: boolean}) => {boot: boolean, shake: boolean, restartShake: boolean}}}
 *   `boot`: the root should carry the `boot` class; `shake`: the root should carry `data-shake`;
 *   `restartShake`: a new alert id appeared (not a continuation of the shown event), so restart the shake animation now.
 */
export function createAnimTracker() {
  let route = null;
  let booted = false;
  let shakeActive = false;
  let shakenId = null;
  return {
    next({ route: r, hasData, alertId, continuation = false }) {
      if (r !== route) {
        route = r; // a new route visit: boot may run again, a running shake is dropped
        booted = false;
        shakeActive = false;
      }
      if (hasData) booted = true;
      let restartShake = false;
      const hadAlert = shakenId !== null;
      if (alertId && alertId !== shakenId && r === "today") {
        shakenId = alertId;
        if (!(continuation && hadAlert)) {
          shakeActive = true;
          restartShake = true;
        }
      }
      if (!alertId) shakeActive = false;
      return { boot: booted, shake: shakeActive, restartShake };
    },
  };
}
