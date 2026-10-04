// ──────────────────────────────────────────────────────────────────────────────
// Device settings — the only file you need to edit to switch to the real ESP32.
// See DEVICE_INTEGRATION.md at the project root for the message format.
// ──────────────────────────────────────────────────────────────────────────────

// true  = use the built-in simulated device (no hardware needed).
// false = connect to the ESP32 over WebSocket at DEVICE_URL.
export const USE_MOCK_DEVICE = true;

// WebSocket address of the ESP32. 192.168.4.1 is the ESP32's default IP when it runs
// its own Wi-Fi access point; use the address it prints on Serial if it joins your Wi-Fi.
export const DEVICE_URL = 'ws://192.168.4.1:81';

// How long to wait for the ESP32 to answer before showing "Couldn't reach your simulator".
export const CONNECT_TIMEOUT_MS = 6000;
