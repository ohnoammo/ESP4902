// =====================================================================
// ESP4902 – Slow breathing-waveform test, TWO WS7040 fans, FREE DELIVERY
// (fans on their own, not connected to the body; no flap).
//
// Purpose: check with the testo 425 (1 reading/s) that the fans follow a
// breathing waveform. The breath is SLOWED to BREATH_PERIOD_S (default 20 s,
// ~20 testo readings per breath) with the preset's real peak flow, so the test
// checks the waveform, not breathing speed (the fan lags duty by 0.6–0.9 s and
// the testo smooths, which would flatten a real-time breath).
//
//   inhale half: inhale fan,  |Q| = Q_PEAK * sin(pi * t / T_half)
//   exhale half: exhale fan,  |Q| = Q_PEAK * sin(pi * t / T_half)
//   the other fan is held at 0 %.
//
// One anemometer: put the probe on ONE fan per set of runs (inhale fan for 5
// runs, then exhale fan for 5 runs). Don't move it during a run.
//
// Each run (type r in the Serial Monitor, or let breath_test.py log start it):
//   OFF_S with both fans off (the testo alignment marker: first rise = start),
//   then N_BREATHS breaths, then both fans off and "DONE".
//   Type x at any time to stop.
//
// Serial output (CSV, 115200 baud), one row per 100 ms:
//   t_ms,phase,q_target,duty_in,duty_ex,rpm_in,rpm_ex,q_rpm_in,q_rpm_ex
//   phase: off | in | ex.  q_target is signed (inhale +, exhale -).
//   q_rpm_* = flow predicted from that fan's measured rpm (free-delivery
//   affinity law with k = 1.036), for comparison with the testo.
// Lines starting with # are comments.
//
// Board: ESP32S3 Dev Module. ESP32 Arduino core 3.x (2.x also handled).
// =====================================================================
#include <math.h>

// ---------------- PRESET (pick one; peak = pi * VE) ----------------
// Light exercise, male (ICRP 66): VE 25.0 L/min -> peak 78.5 L/min.
// Others: faster walking VE 28.7 (peak 90), heavy female 45.0 (141), heavy male 50.0 (157).
// Slow walking (58) and light female (65) peak below the validated range (67.5 L/min, 40 %).
const char* PRESET_NAME  = "Light exercise, male (ICRP 66)";
const float VE_LPM       = 25.0f;
const float Q_PEAK       = PI * VE_LPM;   // L/min

// ---------------- TEST SETTINGS ----------------
const float    BREATH_PERIOD_S = 20.0f;   // slowed breath: 10 s inhale + 10 s exhale
const int      N_BREATHS       = 3;       // breaths per run (the plot shows these 3)
const uint32_t OFF_S           = 6;       // fans off before the first breath (>= 5 s for alignment)
const uint32_t LOG_MS          = 100;     // serial row period
const uint32_t CTRL_MS         = 10;      // duty update period

// ---------------- HARDWARE ----------------
// Inhale fan: same wiring as firmware 0.7.
const int PWM_PIN_IN  = 18;
const int TACH_PIN_IN = 5;
// Exhale fan: >>> CHANGE THESE to the GPIOs the second fan is wired to <<<
// Avoid GPIO 0, 3, 45, 46 (strapping), 19/20 (USB), 26-32 (flash).
const int PWM_PIN_EX  = 18;
const int TACH_PIN_EX = 1;

const uint32_t PWM_FREQ   = 25000;   // same as the calibration runs and 0.7
const uint8_t  PWM_BITS   = 10;
const uint8_t  PWM_CH_IN  = 0, PWM_CH_EX = 1;   // core 2.x only
const uint32_t TACH_TIMEOUT_US = 500000;   // no edge for 0.5 s -> rpm = 0
const uint32_t TACH_GLITCH_US  = 800;      // as 0.7 (1 pulse per rev)

// ---------------- CALIBRATION (measured free delivery, 15 V, runs 13–22) ----------------
// Same table as sine_test_free.ino. Below 25 % duty there is no data -> fan off.
// Validated at duty >= 40 % (67.5 L/min).
const int   N_CAL = 10;
const float CAL_DUTY[N_CAL] = { 25,   30,   35,   40,   50,   60,    70,    80,    90,    100  };
const float CAL_Q   [N_CAL] = { 25.4, 40.1, 54.9, 67.5, 88.6, 108.3, 127.8, 148.2, 171.7, 195.3 };
// Affinity law for the rpm-based prediction: Q = K * Q_MAX * rpm / N_MAX.
const float K_CORR = 1.036f, Q_MAX = 351.7f, N_MAX = 36660.0f;

// ---------------- TACH (edge timing, as firmware 0.7) ----------------
struct Tach {
  volatile uint32_t count, lastUs;
  uint32_t prevCount, prevEdgeUs;
  int lastRpm;
};
portMUX_TYPE tachMux = portMUX_INITIALIZER_UNLOCKED;
Tach tachIn = {}, tachEx = {};

void IRAM_ATTR tachEdge(Tach& t) {
  uint32_t now = micros();
  portENTER_CRITICAL_ISR(&tachMux);
  if (now - t.lastUs >= TACH_GLITCH_US) { t.lastUs = now; t.count = t.count + 1; }
  portEXIT_CRITICAL_ISR(&tachMux);
}
void IRAM_ATTR onTachIn() { tachEdge(tachIn); }
void IRAM_ATTR onTachEx() { tachEdge(tachEx); }

int readRpm(Tach& t) {
  uint32_t c, e;
  portENTER_CRITICAL(&tachMux);
  c = t.count; e = t.lastUs;
  portEXIT_CRITICAL(&tachMux);
  if (micros() - e > TACH_TIMEOUT_US) t.lastRpm = 0;
  else if (c != t.prevCount) {
    uint32_t span = e - t.prevEdgeUs;
    if (t.prevCount != 0 && span > 0 && span < TACH_TIMEOUT_US)
      t.lastRpm = (int)((uint64_t)(c - t.prevCount) * 60000000ULL / span);
  }
  t.prevCount = c; t.prevEdgeUs = e;
  return t.lastRpm;
}

// ---------------- PWM ----------------
void pwmAttach(int pin, uint8_t ch) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  (void)ch; ledcAttach(pin, PWM_FREQ, PWM_BITS);
#else
  ledcSetup(ch, PWM_FREQ, PWM_BITS); ledcAttachPin(pin, ch);
#endif
}
void setDuty(int pin, uint8_t ch, float pct) {
  pct = constrain(pct, 0.0f, 100.0f);
  uint32_t raw = (uint32_t)(pct / 100.0f * ((1u << PWM_BITS) - 1) + 0.5f);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  (void)ch; ledcWrite(pin, raw);
#else
  (void)pin; ledcWrite(ch, raw);
#endif
}
void fansOff() { setDuty(PWM_PIN_IN, PWM_CH_IN, 0); setDuty(PWM_PIN_EX, PWM_CH_EX, 0); }

// target flow (L/min) -> duty (%). Below the first point: fan off (no data).
float dutyForFlow(float q) {
  if (q < CAL_Q[0]) return 0;
  for (int i = 0; i < N_CAL - 1; i++)
    if (q <= CAL_Q[i + 1])
      return CAL_DUTY[i] + (q - CAL_Q[i]) / (CAL_Q[i + 1] - CAL_Q[i]) * (CAL_DUTY[i + 1] - CAL_DUTY[i]);
  return 100;
}
float flowFromRpm(int rpm) { return rpm > 0 ? K_CORR * Q_MAX * rpm / N_MAX : 0; }

// ---------------- RUN ----------------
bool     running = false;
uint32_t runStart = 0, nextLog = 0;

void startRun() {
  running = true;
  runStart = millis();
  nextLog = runStart;
  Serial.printf("# run start: %s, peak %.1f L/min, period %.0f s, %d breaths, %lu s off first\n",
                PRESET_NAME, Q_PEAK, BREATH_PERIOD_S, N_BREATHS, (unsigned long)OFF_S);
  Serial.println("t_ms,phase,q_target,duty_in,duty_ex,rpm_in,rpm_ex,q_rpm_in,q_rpm_ex");
}

void endRun(const char* why) {
  running = false;
  fansOff();
  Serial.printf("# run end (%s)\n", why);
  Serial.println("DONE");
}

void setup() {
  Serial.begin(115200);
  pwmAttach(PWM_PIN_IN, PWM_CH_IN);
  pwmAttach(PWM_PIN_EX, PWM_CH_EX);
  fansOff();
  pinMode(TACH_PIN_IN, INPUT_PULLUP);
  pinMode(TACH_PIN_EX, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(TACH_PIN_IN), onTachIn, FALLING);
  attachInterrupt(digitalPinToInterrupt(TACH_PIN_EX), onTachEx, FALLING);
  delay(300);
  Serial.printf("# breath_test_free: %s, peak %.1f L/min (duty %.1f %%)\n",
                PRESET_NAME, Q_PEAK, dutyForFlow(Q_PEAK));
  if (dutyForFlow(Q_PEAK) < 40) Serial.println("# WARNING: peak is below the validated range (40 % duty)");
  if (Q_PEAK > CAL_Q[N_CAL - 1]) Serial.println("# WARNING: peak above the fan's max, it will saturate");
  Serial.println("# type r to start a run, x to stop");
}

void loop() {
  static uint32_t nextCtrl = 0;
  if (Serial.available()) {
    char c = Serial.read();
    if ((c == 'r' || c == 'R') && !running) startRun();
    else if ((c == 'x' || c == 'X') && running) endRun("stopped");
  }
  uint32_t now = millis();
  if ((int32_t)(now - nextCtrl) < 0) return;
  nextCtrl = now + CTRL_MS;

  int rpmIn = readRpm(tachIn), rpmEx = readRpm(tachEx);   // keep both tachs current
  if (!running) return;

  const uint32_t offMs = OFF_S * 1000, periodMs = (uint32_t)(BREATH_PERIOD_S * 1000), halfMs = periodMs / 2;
  uint32_t t = now - runStart;
  const char* phase = "off";
  float qTarget = 0, dIn = 0, dEx = 0;
  if (t >= offMs + (uint32_t)N_BREATHS * periodMs) { endRun("complete"); return; }
  if (t >= offMs) {
    uint32_t tb = (t - offMs) % periodMs;
    bool inhale = tb < halfMs;
    uint32_t th = inhale ? tb : tb - halfMs;
    float q = Q_PEAK * sinf(PI * (float)th / (float)halfMs);
    phase = inhale ? "in" : "ex";
    qTarget = inhale ? q : -q;
    if (inhale) dIn = dutyForFlow(q); else dEx = dutyForFlow(q);
  }
  setDuty(PWM_PIN_IN, PWM_CH_IN, dIn);
  setDuty(PWM_PIN_EX, PWM_CH_EX, dEx);

  if ((int32_t)(now - nextLog) >= 0) {
    nextLog += LOG_MS;
    Serial.printf("%lu,%s,%.2f,%.2f,%.2f,%d,%d,%.2f,%.2f\n", (unsigned long)t, phase, qTarget, dIn, dEx,
                  rpmIn, rpmEx, flowFromRpm(rpmIn), flowFromRpm(rpmEx));
  }
}
