// =====================================================================
// ESP4902 – Breathing SPEED test, WS7040 fans, FREE DELIVERY (no body, no flap)
//
// Purpose: find how fast a breath the fans can follow, and how much a
// feed-forward lead helps. One run steps through every breath period
// (PERIODS_S, slow to fast) once for each lead in LEADS_MS (default 0 then
// 600 ms); each block is N_BREATHS breaths of the preset's breathing waveform,
// with OFF_BETWEEN_S fans-off between blocks.
//
// Lead: the duty sent at time t is the duty for the target at t + lead, so the
// fan's 0.6-0.9 s lag is cancelled (v0.7 defined LEAD_MS = 600 but never used
// it). The lead can't make the fan brake: it still only coasts down.
// No testo needed: the result is the measured rpm (tach, 20 Hz here) against
// the rpm each commanded duty should give, plus the flow that rpm implies.
//
//   inhale half: inhale fan,  |Q| = Q_PEAK * sin(pi * t / T_half)
//   exhale half: exhale fan,  same; the other fan is held at 0 %.
// With one fan, connect it to the inhale pins (or the exhale pins); the other
// half just has no data.
//
// Start a run: type r in the Serial Monitor, or let breath_test.py log start it:
//   python speed_test.py log COM5 speed_01.csv
//   python speed_test.py speed_01.csv
// Type x to stop.
//
// Serial output (CSV, 115200 baud), one row per LOG_MS:
//   t_ms,block,period_s,lead_ms,phase,q_target,duty_in,duty_ex,rpm_in,rpm_ex,rpm_exp,q_rpm_in,q_rpm_ex
//   block: 0-based block index (-1 while off between blocks)
//   phase / q_target: the TARGET at t (not shifted by the lead): off | in | ex, signed (inhale +).
//   duty_*: what was actually sent (for the target at t + lead).
//   rpm_exp: steady-state rpm for the target at t (what the fan should be doing now).
//   q_rpm_*: flow implied by that fan's measured rpm, Q = 1.036 * 351.7 * rpm / 36660.
//
// Board: ESP32S3 Dev Module. ESP32 Arduino core 3.x (2.x also handled).
// =====================================================================
#include <math.h>

// ---------------- PRESET (peak = pi * VE) ----------------
const char* PRESET_NAME = "Light exercise, male (ICRP 66)";
const float VE_LPM      = 25.0f;
const float Q_PEAK      = PI * VE_LPM;   // 78.5 L/min

// ---------------- SWEEP ----------------
// Real breath at 20 bpm = 3 s. The slow periods show the fans' steady-state shape.
const float    PERIODS_S[]   = { 20.0f, 10.0f, 6.0f, 4.0f, 3.0f };
const int      N_PERIODS     = sizeof(PERIODS_S) / sizeof(PERIODS_S[0]);
const uint32_t LEADS_MS[]    = { 0, 600 };   // each period is run once per lead
const int      N_LEADS       = sizeof(LEADS_MS) / sizeof(LEADS_MS[0]);
const int      N_BLOCKS      = N_PERIODS * N_LEADS;
const int      N_BREATHS     = 4;        // per period (the analysis drops the first: spin-up)
const uint32_t OFF_FIRST_S   = 3;        // fans off before the first block
const uint32_t OFF_BETWEEN_S = 3;        // fans off between blocks
const uint32_t LOG_MS        = 50;       // 20 rows/s: ~60 per 3 s breath
const uint32_t CTRL_MS       = 10;

// ---------------- HARDWARE ----------------
const int PWM_PIN_IN  = 18;   // inhale fan, as firmware 0.7
const int TACH_PIN_IN = 5;
// >>> CHANGE THESE to the GPIOs the second fan is wired to <<<
const int PWM_PIN_EX  = 20;
const int TACH_PIN_EX = 21;

const uint32_t PWM_FREQ = 25000;
const uint8_t  PWM_BITS = 10;
const uint8_t  PWM_CH_IN = 0, PWM_CH_EX = 1;   // core 2.x only
const uint32_t TACH_TIMEOUT_US = 500000;
const uint32_t TACH_GLITCH_US  = 800;

// ---------------- CALIBRATION (free delivery, 15 V, runs 13–22) ----------------
const int   N_CAL = 10;
const float CAL_DUTY[N_CAL] = { 25,   30,   35,   40,   50,   60,    70,    80,    90,    100   };
const float CAL_Q   [N_CAL] = { 25.4, 40.1, 54.9, 67.5, 88.6, 108.3, 127.8, 148.2, 171.7, 195.3 };
const float CAL_RPM [N_CAL] = { 3185, 4570, 5843, 6920, 8800, 10750, 13001, 15107, 17236, 19383 };
const float K_CORR = 1.036f, Q_MAX = 351.7f, N_MAX = 36660.0f;

// ---------------- TACH (edge timing, as firmware 0.7) ----------------
struct Tach { volatile uint32_t count, lastUs; uint32_t prevCount, prevEdgeUs; int lastRpm; };
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
  portENTER_CRITICAL(&tachMux); c = t.count; e = t.lastUs; portEXIT_CRITICAL(&tachMux);
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

float interp(float x, const float* xs, const float* ys) {
  if (x <= xs[0]) return ys[0];
  for (int i = 0; i < N_CAL - 1; i++)
    if (x <= xs[i + 1]) return ys[i] + (x - xs[i]) / (xs[i + 1] - xs[i]) * (ys[i + 1] - ys[i]);
  return ys[N_CAL - 1];
}
float dutyForFlow(float q) { return q < CAL_Q[0] ? 0 : (q >= CAL_Q[N_CAL - 1] ? 100 : interp(q, CAL_Q, CAL_DUTY)); }
float rpmForDuty(float d)  { return d <= 0 ? 0 : interp(d, CAL_DUTY, CAL_RPM); }
float flowFromRpm(int rpm) { return rpm > 0 ? K_CORR * Q_MAX * rpm / N_MAX : 0; }

// ---------------- RUN ----------------
bool     running = false;
uint32_t runStart = 0, nextLog = 0;
uint32_t blockStartMs[N_BLOCKS + 1];   // start of each block's breaths (ms since run start); [N] = end
// block b: lead LEADS_MS[b / N_PERIODS], period PERIODS_S[b % N_PERIODS]
float    blockPeriod(int b) { return PERIODS_S[b % N_PERIODS]; }
uint32_t blockLead(int b)   { return LEADS_MS[b / N_PERIODS]; }

void startRun() {
  uint32_t t = OFF_FIRST_S * 1000;
  for (int b = 0; b < N_BLOCKS; b++) {
    blockStartMs[b] = t;
    t += (uint32_t)(blockPeriod(b) * 1000) * N_BREATHS + OFF_BETWEEN_S * 1000;
  }
  blockStartMs[N_BLOCKS] = t;
  running = true;
  runStart = millis();
  nextLog = runStart;
  Serial.printf("# speed run: %s, peak %.1f L/min, periods", PRESET_NAME, Q_PEAK);
  for (int b = 0; b < N_PERIODS; b++) Serial.printf(" %.0f", PERIODS_S[b]);
  Serial.printf(" s, leads");
  for (int l = 0; l < N_LEADS; l++) Serial.printf(" %lu", (unsigned long)LEADS_MS[l]);
  Serial.printf(" ms, %d breaths each, %.0f s total\n", N_BREATHS, t / 1000.0f);
  Serial.println("t_ms,block,period_s,lead_ms,phase,q_target,duty_in,duty_ex,rpm_in,rpm_ex,rpm_exp,q_rpm_in,q_rpm_ex");
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
  Serial.printf("# speed_test_free: %s, peak %.1f L/min (duty %.1f %%)\n", PRESET_NAME, Q_PEAK, dutyForFlow(Q_PEAK));
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

  int rpmIn = readRpm(tachIn), rpmEx = readRpm(tachEx);
  if (!running) return;

  uint32_t t = now - runStart;
  if (t >= blockStartMs[N_BLOCKS]) { endRun("complete"); return; }

  int block = -1;
  float period = 0, qTarget = 0, dIn = 0, dEx = 0, rpmExp = 0;
  uint32_t lead = 0;
  const char* phase = "off";
  for (int b = 0; b < N_BLOCKS; b++) {
    uint32_t pMs = (uint32_t)(blockPeriod(b) * 1000), half = pMs / 2;
    if (t >= blockStartMs[b] && t < blockStartMs[b] + pMs * N_BREATHS) {
      block = b;
      period = blockPeriod(b);
      lead = blockLead(b);
      // target now (logged) ...
      uint32_t tb = (t - blockStartMs[b]) % pMs;
      bool inhale = tb < half;
      float q = Q_PEAK * sinf(PI * (float)(inhale ? tb : tb - half) / (float)half);
      phase = inhale ? "in" : "ex";
      qTarget = inhale ? q : -q;
      rpmExp = rpmForDuty(dutyForFlow(q));
      // ... and the duty sent: for the target `lead` ms ahead (the waveform repeats, so it wraps)
      uint32_t ta = (t - blockStartMs[b] + lead) % pMs;
      bool inA = ta < half;
      float qa = Q_PEAK * sinf(PI * (float)(inA ? ta : ta - half) / (float)half);
      if (inA) dIn = dutyForFlow(qa); else dEx = dutyForFlow(qa);
      break;
    }
  }
  setDuty(PWM_PIN_IN, PWM_CH_IN, dIn);
  setDuty(PWM_PIN_EX, PWM_CH_EX, dEx);

  if ((int32_t)(now - nextLog) >= 0) {
    nextLog += LOG_MS;
    Serial.printf("%lu,%d,%.1f,%lu,%s,%.2f,%.2f,%.2f,%d,%d,%.0f,%.2f,%.2f\n", (unsigned long)t, block, period,
                  (unsigned long)lead, phase,
                  qTarget, dIn, dEx, rpmIn, rpmEx, rpmExp, flowFromRpm(rpmIn), flowFromRpm(rpmEx));
  }
}
