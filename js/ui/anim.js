/**
 * One-shot animation bookkeeping (pure). The LCD boot flicker and the rain-bar
 * growth run once per route visit (at the first render that has data); the alert
 * shake runs only when a new alert id appears. Re-renders caused by refreshes or
 * ticks never replay them.
 * @module ui/anim
 */

/**
 * Create a tracker.
 * @returns {{next: (o: {route: string, hasData: boolean, alertId: (string|null)}) => {boot: boolean, shake: boolean, restartShake: boolean}}}
 *   `boot`: the root should carry the `boot` class; `shake`: the root should carry `data-shake`;
 *   `restartShake`: a new alert id appeared, so restart the shake animation now.
 */
export function createAnimTracker() {
  let route = null;
  let booted = false;
  let shakeActive = false;
  let shakenId = null;
  return {
    next({ route: r, hasData, alertId }) {
      if (r !== route) {
        route = r; // a new route visit: boot may run again, a running shake is dropped
        booted = false;
        shakeActive = false;
      }
      if (r === "today" && hasData) booted = true;
      let restartShake = false;
      if (alertId && alertId !== shakenId && r === "today") {
        shakenId = alertId;
        shakeActive = true;
        restartShake = true;
      }
      if (!alertId) shakeActive = false;
      return { boot: booted, shake: shakeActive, restartShake };
    },
  };
}
