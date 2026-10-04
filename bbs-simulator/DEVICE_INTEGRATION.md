# Connecting the ESP32 to the app

The app talks to the microcontroller over a **WebSocket** using small **JSON** messages.
Everything device-related lives in `src/device/`; you shouldn't need to touch any screen code.

## 1. Run the app

Requires Node.js 20+ and the **Expo Go** app on your phone.

```bash
npm install
npx expo start --tunnel
```

Scan the QR code (Android: from inside Expo Go; iPhone: Camera app). `--tunnel` avoids Wi-Fi/firewall
issues; drop it if phone and computer are on the same network. Press `w` to run it in a browser instead.

Out of the box the app uses a **built-in simulated device**, so it works with no hardware.

## 2. Switch to the real device

Edit `src/device/config.ts`:

```ts
export const USE_MOCK_DEVICE = false;
export const DEVICE_URL = 'ws://192.168.4.1:81'; // the ESP32's address + port
```

- `192.168.4.1` is the ESP32's default IP when it runs its own access point (the phone joins the ESP32's Wi-Fi).
- If the ESP32 joins an existing Wi-Fi instead, use the IP it prints on Serial. Phone and ESP32 must be on the same network.
- Note: with `--tunnel`, the *app code* is delivered over the internet, but the WebSocket still goes straight
  from the phone to the ESP32, so the phone must be able to reach the ESP32's IP.

## 3. The protocol

All messages are JSON text frames.

### App → ESP32

| Message | When |
| --- | --- |
| `{"type":"hello"}` | Right after connecting. **Must be answered with `info`** (below) within 6 s or the app shows "Couldn't reach your simulator". |
| `{"type":"start","tidalVolume":500,"respiratoryRate":15,"ieRatio":2}` | User taps Start. Units: mL, breaths/min, and I:E as 1:`ieRatio`. Start the blower and begin streaming readings. |
| `{"type":"stop"}` | User taps Stop. Stop the blower and stop streaming. |

### ESP32 → App

| Message | Notes |
| --- | --- |
| `{"type":"info","name":"BBS-ESP32"}` | Reply to `hello`. `name` is shown in Settings. |
| `{"type":"reading", ...fields}` | Any subset of the fields below. The app keeps the latest value of each. |

**Reading fields** (all numbers, all optional):

| Field | Unit | Suggested rate | Used for |
| --- | --- | --- | --- |
| `volume` | mL | **~20 per second** | The live breathing waveform (instantaneous lung volume, 0 = fully exhaled). |
| `tidalVolume` | mL | once per breath or 1/s | "mL" reading on the live screen; recorded. |
| `pressure` | cmH2O | once per breath or 1/s | "cmH2O" reading (peak of the last breath); recorded. |
| `temperature` | °C | 1/s | Sensors screen; recorded. |
| `co2` | % | 1/s | Sensors screen; recorded. |
| `humidity` | % RH | 1/s | Sensors screen; recorded. |
| `inhaleFan` | RPM | 1/s | Sensors screen; recorded. |
| `exhaleFan` | RPM | 1/s | Sensors screen; recorded. |

Example stream:
```json
{"type":"reading","volume":312.5}
{"type":"reading","volume":318.9}
{"type":"reading","tidalVolume":498,"pressure":2.1,"temperature":34.2,"co2":4.1,"humidity":92,"inhaleFan":1820,"exhaleFan":1240}
```

- The app records **one sample per second** using the latest value of each field, and recording starts once the
  first non-`volume` reading arrives. A field that is never sent is recorded as `0`.
- Unknown fields and non-JSON text (e.g. debug prints) are ignored.
- If the connection drops mid-run, the app saves what it has recorded and shows the device as offline.

## 4. Test without hardware: the fake ESP32

`tools/fake-esp32.js` speaks exactly this protocol and logs every message:

```bash
PORT=8765 npm run fake-esp32
```
(On Windows PowerShell: `$env:PORT=8765; npm run fake-esp32`.)

Then set `USE_MOCK_DEVICE = false` and `DEVICE_URL = 'ws://<your computer's IP>:8765'`
(or `ws://localhost:8765` when running the app in a browser with `w`).

## 5. Example ESP32 sketch (Arduino)

Libraries (Arduino Library Manager): **WebSockets** by Markus Sattler, **ArduinoJson** by Benoit Blanchon.
Replace the marked lines with your real sensor reads and blower control.

```cpp
#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>

WebSocketsServer ws(81);
bool running = false;
float tidalVolume = 500, respiratoryRate = 15, ieRatio = 2;
unsigned long startedAt = 0, lastVolume = 0, lastSensors = 0;

void sendJson(uint8_t client, JsonDocument &doc) {
  String out; serializeJson(doc, out); ws.sendTXT(client, out);
}

void onEvent(uint8_t client, WStype_t type, uint8_t *payload, size_t len) {
  if (type == WStype_DISCONNECTED) { running = false; /* stop blower */ return; }
  if (type != WStype_TEXT) return;
  JsonDocument msg;
  if (deserializeJson(msg, payload, len)) return;
  const char *t = msg["type"];
  if (!strcmp(t, "hello")) {
    JsonDocument r; r["type"] = "info"; r["name"] = "BBS-ESP32"; sendJson(client, r);
  } else if (!strcmp(t, "start")) {
    tidalVolume = msg["tidalVolume"]; respiratoryRate = msg["respiratoryRate"]; ieRatio = msg["ieRatio"];
    startedAt = millis(); running = true;
    // TODO: start the blower with these parameters
  } else if (!strcmp(t, "stop")) {
    running = false;
    // TODO: stop the blower
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.softAP("BBS-Simulator", "breathe123");     // phone joins this network
  Serial.println(WiFi.softAPIP());                  // 192.168.4.1
  ws.begin(); ws.onEvent(onEvent);
}

void loop() {
  ws.loop();
  if (!running) return;
  unsigned long now = millis();

  if (now - lastVolume >= 50) {                     // 20 Hz
    lastVolume = now;
    JsonDocument r; r["type"] = "reading";
    r["volume"] = 0;                                 // TODO: instantaneous volume in mL
    String out; serializeJson(r, out); ws.broadcastTXT(out);
  }
  if (now - lastSensors >= 1000) {                  // 1 Hz
    lastSensors = now;
    JsonDocument r; r["type"] = "reading";
    r["tidalVolume"] = 0;   // TODO
    r["pressure"]    = 0;   // TODO cmH2O
    r["temperature"] = 0;   // TODO °C
    r["co2"]         = 0;   // TODO %
    r["humidity"]    = 0;   // TODO % RH
    r["inhaleFan"]   = 0;   // TODO RPM
    r["exhaleFan"]   = 0;   // TODO RPM
    String out; serializeJson(r, out); ws.broadcastTXT(out);
  }
}
```

## 6. Where the code is

| File | What |
| --- | --- |
| `src/device/config.ts` | Mock/real switch, ESP32 address, timeout. |
| `src/device/types.ts` | The `Device` interface and `Reading` fields. |
| `src/device/esp32Device.ts` | WebSocket client implementing the protocol above. |
| `src/device/mockDevice.ts` | Built-in simulator (same message cadence). |
| `src/state/RunContext.tsx` | Turns readings into recorded 1 s samples + the live waveform buffer. |

Native builds (`eas build`) are already configured to allow plain `ws://` on the local network
(`app.json`: Android cleartext traffic, iOS local-network permission).
