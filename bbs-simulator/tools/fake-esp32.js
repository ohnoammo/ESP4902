// Fake ESP32: speaks the same WebSocket protocol as the real board (DEVICE_INTEGRATION.md),
// so the app's real-device mode can be tested without hardware.
//
//   npm run fake-esp32            (listens on ws://0.0.0.0:81, or PORT=8765 npm run fake-esp32)
//
// Then in src/device/config.ts set USE_MOCK_DEVICE = false and DEVICE_URL to
// ws://<this computer's IP>:<port>. Every message in/out is logged, which also makes this
// a handy reference when writing the firmware.

const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 81);
const server = new WebSocketServer({ port: PORT });
console.log(`Fake ESP32 listening on ws://0.0.0.0:${PORT}`);

server.on('connection', (socket, req) => {
  console.log(`app connected from ${req.socket.remoteAddress}`);
  let timer = null;

  const send = (msg) => socket.send(JSON.stringify(msg));
  const stopStreaming = () => {
    clearInterval(timer);
    timer = null;
  };

  socket.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return console.log('ignored non-JSON message:', String(data));
    }
    console.log('<-', msg);

    if (msg.type === 'hello') {
      send({ type: 'info', name: 'Fake ESP32' });
    } else if (msg.type === 'start') {
      const { tidalVolume = 500, respiratoryRate = 15, ieRatio = 2 } = msg;
      const period = 60 / respiratoryRate;
      const inhale = 1 / (1 + ieRatio);
      const startedAt = Date.now();
      let lastSecond = -1;
      stopStreaming();
      // 20 Hz volume; sensors once a second — the same cadence the real board should use.
      timer = setInterval(() => {
        const t = (Date.now() - startedAt) / 1000;
        const p = (t % period) / period;
        const v = p < inhale ? (1 - Math.cos((Math.PI * p) / inhale)) / 2 : (1 + Math.cos((Math.PI * (p - inhale)) / (1 - inhale))) / 2;
        send({ type: 'reading', volume: +(v * tidalVolume).toFixed(1) });
        if (Math.floor(t) !== lastSecond) {
          lastSecond = Math.floor(t);
          const sensors = {
            type: 'reading',
            tidalVolume: +(tidalVolume * (1 + (Math.random() - 0.5) * 0.02)).toFixed(1),
            pressure: +((tidalVolume / 500) * 2.05).toFixed(2),
            temperature: +(33.5 + Math.sin(t / 15) * 0.4).toFixed(2),
            co2: +(4 + Math.sin(t / 11) * 0.2).toFixed(2),
            humidity: +(90 + Math.sin(t / 17) * 2).toFixed(1),
            inhaleFan: Math.round(1800 + Math.sin(t / 7) * 60),
            exhaleFan: Math.round(1200 + Math.sin(t / 8) * 60),
          };
          console.log('->', sensors);
          send(sensors);
        }
      }, 50);
    } else if (msg.type === 'stop') {
      stopStreaming();
    }
  });

  socket.on('close', () => {
    stopStreaming();
    console.log('app disconnected');
  });
});
