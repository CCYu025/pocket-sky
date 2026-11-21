/**
 * Browser geolocation wrapper.
 * @module app/geolocate
 */

/**
 * Create a `geolocate()` function for the controller.
 * @param {Navigator} nav Navigator (injectable for tests).
 * @returns {() => Promise<{lat:number, lon:number}>} Rejects when unsupported, denied or timed out.
 */
export function browserGeolocate(nav) {
  return () =>
    new Promise((resolve, reject) => {
      if (!nav || !nav.geolocation) {
        reject(new Error("unsupported"));
        return;
      }
      nav.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        (e) => reject(e),
        { timeout: 8000, maximumAge: 600000 },
      );
    });
}
