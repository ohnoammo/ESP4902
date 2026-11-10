/*
  ESP4902 breathing simulator. Supabase control + digital twin (v0.8)

  Built on blower-0.7 (esp4902_supabase_blower_test.ino). Everything 0.7 did is unchanged:
  breath (duty) and free-flow modes, failsafe stop, command TTL, ack after execution, local
  'x' stop, no network calls on core 1, identical keys in every telemetry row (PGRST102).

  Architecture
    Core 1. controlTask. 10 Hz tick. Waveform -> PWM, tach -> rpm, twin, sample queue.
            Never touches the network.
    Core 0. netTask. WiFi, NTP, command poll (1 s), telemetry batch POST (1 s),
            acks, heartbeat (5 s).

  Hardware
    Inhale blower  PWM GPIO 18 (grey wire), tach GPIO 4 (white wire, 1 pulse/rev). 15 V.
    Exhale blower  PWM GPIO 7, tach GPIO 15 (pins from digital_twin_esp32.ino; check wiring).
    Flap servo     GPIO 16 (pin from digital_twin_esp32.ino; angles and move time TBD).
    Two blowers: each runs only its own half, the other is held at 0 %. Set PWM_PIN_EX = -1
    to go back to one blower driving both halves (the twin then uses the exhale operating
    points for that blower's exhale half).

  Commands (public.commands)
    start {"bpm":15, "duty":40, "ie_ratio":1}               BREATH (duty half-sine, as 0.7)
    start {"mode":"free", "duty":55}                        FREE FLOW (as 0.7)
    start {"mode":"flow", "vt":1.92, "bpm":26, "ie_ratio":1} FLOW BREATH (twin, new)
          vt  tidal volume L (0.3..2.5), bpm 5..40, ie_ratio E/I (0.25..4, missing keeps last).
          Missing/out-of-range vt or bpm -> command marked 'error', nothing runs.
    stop  all blowers to 0 %.

  Digital twin (flow mode only; see digital_twin_spec / the team's brief)
    1. Control.    Q_target(t) -> feed-forward duty by inverting the operating-point table.
                   Each half is a half-sine carrying Vt: Q_peak = pi*Vt / (2*T_half), which is
                   pi*Vt*bpm at I:E 1:1 (the brief's formula).
    2. Prediction. MEASURED rpm -> Q_twin (operating-point table, rpm -> Q) -> dP_twin (CFD
                   system curve, laminar / k-omega blend).
    3. Monitoring. RPM trim: integral correction of duty so measured rpm = expected rpm for the
                   feed-forward duty. One learned value per duty band and per fan, KEPT between
                   breaths and runs (only a reboot clears it), so battery sag is learned once.
                   Faults from rpm only: 1 = fan not spinning, 2 = trim at its limit.
                   Pressure residual (leak 3 / blockage 4) is coded but disabled: no sensor.

  RPM trim gain (TRIM_KI = 0.0005 % duty per rpm*s, the brief's starting value)
    Around the operating points 1 % duty is ~200 rpm, so the loop gain is
    0.0005 * 200 = 0.1 /s: a time constant of ~10 s, i.e. a few breaths to converge. The fan
    lags duty by 0.6-0.9 s, about 10x faster than that, so the loop can't oscillate. To keep the
    lag from biasing the trim during the sine, the measured rpm is compared with the expected
    rpm of the duty commanded TRIM_LAG_TICKS (0.7 s) earlier, and that duty's band is updated.
    The fan can't brake (it coasts ~2,500 rpm/s), so on fast breaths the low-duty bands will
    learn a negative trim; that is the fan's real behaviour, not a tuning problem.

  telemetry columns written (null rather than missing, every row)
    device_id, sampled_at, phase, duty_cmd, rpm_inhale, rpm_exhale,
    q_target, q_twin, dp_twin, dp_meas, residual_pct, rpm_expected, trim, twin_valid, fault
    Twin columns are null outside flow mode. Migration: supabase/migrations/*_twin_telemetry.sql

  Local stop. Type x in the Serial Monitor (115200).
  Libraries. ArduinoJson v7. ESP32 Arduino core 2.x or 3.x (both handled).
  Board. ESP32S3 Dev Module, DIO 80 MHz, PSRAM disabled, 16 MB flash.
  Credentials. secrets.h (git-ignored), copied from secrets.example.h.

  v0.8 changes
    - Flow breath mode driven by the digital twin (above).
    - Telemetry: rpm_exhale and the twin columns. firmware string "blower-0.8-twin" (the app
      enables its flow controls on "twin").
    - Ready for a second (exhale) blower and the flap servo: pins TBD, skipped while -1.
    - WiFi / Supabase credentials moved to secrets.h.
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <math.h>
#include <time.h>
#include <sys/time.h>
#include "secrets.h"

// ===================== USER CONFIG =====================
const char* WIFI_SSID    = SECRET_WIFI_SSID;
const char* WIFI_PASS    = SECRET_WIFI_PASS;
const char* SUPABASE_URL = SECRET_SUPABASE_URL;
const char* SUPABASE_KEY = SECRET_SUPABASE_KEY;
const char* DEVICE_ID    = "sim01";
const char* FW_VERSION   = "blower-0.8-twin";

// telemetry.duty_cmd exists. Set to 0 only if you point this at a database without it.
#define LOG_DUTY 1

// ===================== HARDWARE =====================
const int      PWM_PIN_IN  = 17; // pwm (gray) inhale
const int      TACH_PIN_IN = 5; // tach (white) inhale
const int      PWM_PIN_EX  = 7;      // pwm (gray) exhale (-1 = not wired: inhale blower does both halves)
const int      TACH_PIN_EX = 15;     // tach (white) exhale (-1 = not wired)
const int      SERVO_PIN   = 16;     // flap servo signal  (-1 = not fitted)
const uint32_t PWM_FREQ    = 25000;
const uint8_t  PWM_BITS    = 10;
const uint32_t PWM_MAX     = (1u << PWM_BITS) - 1;
const uint8_t  SERVO_BITS  = 14;
// Core 2.x channels. 0 and 1 share timer 0 (same 25 kHz); the servo's 50 Hz gets timer 2.
const uint8_t  PWM_CH_IN = 0, PWM_CH_EX = 1, SERVO_CH = 4;

// Flap servo (TBD on the rig)
const float    SERVO_ANGLE_INHALE = 0.0f;    // TBD deg
const float    SERVO_ANGLE_EXHALE = 90.0f;   // TBD deg
const uint32_t SERVO_MOVE_MS      = 150;     // TBD time for the flap to move; fans held off

// ===================== BEHAVIOUR =====================
const uint32_t CTRL_PERIOD_MS  = 100;     // 10 Hz control and sampling
const uint32_t FAILSAFE_MS     = 10000;   // no Supabase contact for this long -> stop
const uint32_t COMMAND_TTL_S   = 5;       // stale 'start' is expired, not executed
const float    FLOOR_DUTY      = 20.0f;   // breath exhale floor, above the 19 % start point
const int      DEFAULT_BPM     = 15;
const float    DEFAULT_PEAK    = 40.0f;
const float    DEFAULT_IE      = 1.0f;
const uint32_t TACH_TIMEOUT_US = 500000;  // no edge for 0.5 s -> rpm = 0
const uint32_t TACH_GLITCH_US  = 800;     // 24 V max ~36.7k rpm = 1.6 ms period, so 0.8 ms is safe
const uint32_t HTTP_TIMEOUT_MS = 3000;

// Free flow. Driver deadband. starts at 19 %, stops at 17 %, at every voltage.
const float    DEADBAND_STOP   = 19.0f;   // was 17. 18 % does not hold (2026-10-14 test)
const float    DEADBAND_START  = 19.0f;
const float    KICK_DUTY       = 25.0f;
const uint32_t KICK_MS         = 1000;    // rpm lags duty by ~0.6-0.9 s
const uint32_t NOSPIN_MS       = 2000;    // after the kick window, tach 0 this long -> free_nospin

// ===================== DIGITAL TWIN (fixed: calibration + CFD) =====================
// Operating points, fan connected to the body. Linear interpolation between points.
//   RPM column: MEASURED, free delivery, runs 13-22.
//   Q columns: CALCULATED, not measured. For each rpm the WS7040 datasheet fan curve is
//   scaled by the affinity laws (Q ~ rpm, P ~ rpm^2), flow x k, and intersected with the CFD
//   system curve below; the intersection is the operating point.
//   k = 1.036 from testo 425 runs 13-22 (n = 10; runs 23-24 excluded, probe moved; the earlier
//   0.895 from runs 1-12 is superseded). 95 % CI worst case +2.4 % / -2.0 %. Below 40 % duty the
//   ratio drops (0.832 at 25 %), hence the 40 % validity limit.
//   k was measured at free delivery and is ASSUMED to hold at the operating points: the system
//   dP is < 7 % of the fan's shut-off pressure at each speed (6700*(rpm/36660)^2 Pa).
//   NOT yet validated with the body attached: connected rpm = free rpm, connected flows.
//   Exhale fan assumed to behave like the calibrated fan (TBD until calibrated).
const int   N_OP = 10;
const float OP_DUTY[N_OP] = { 25,   30,   35,   40,   50,   60,    70,    80,    90,    100   };
const float OP_RPM [N_OP] = { 3185, 4570, 5843, 6920, 8800, 10750, 13001, 15107, 17236, 19383 };
const float OP_Q_IN[N_OP] = { 30.3, 43.2, 55.3, 65.6, 83.7, 102.4, 124.1, 144.5, 165.1, 185.8 };
const float OP_Q_EX[N_OP] = { 28.3, 40.5, 51.7, 61.3, 78.2, 95.7,  115.9, 134.9, 154.0, 173.4 };
const float DUTY_VALID_MIN = 40.0f;      // calibration validated at duty >= 40 %

// CFD system curves dP = a*Q^n (Pa, Q in L/min). dP = |p_nostril_barb_tip - p_fan_face|.
// Laminar below 30 L/min, k-omega above 45 L/min, linear blend 30-45 L/min.
const float IN_A_LAM = 0.00690f, IN_N_LAM = 1.811f;   // inhale laminar  (5-35, +-4.4 %)
const float IN_A_TUR = 0.00714f, IN_N_TUR = 1.854f;   // inhale k-omega  (50-175, +-1.2 %)
const float EX_A_LAM = 0.01777f, EX_N_LAM = 1.737f;   // exhale laminar  (5-35, +-3.0 %)
const float EX_A_TUR = 0.01553f, EX_N_TUR = 1.833f;   // exhale k-omega  (50-175, +-0.2 %)
const float Q_BLEND_LO = 30.0f, Q_BLEND_HI = 45.0f;

// Flow-breath input limits
const float VT_MIN = 0.3f, VT_MAX = 2.5f;              // L

// RPM trim (TBD tuning; see the gain note at the top)
const bool     USE_RPM_TRIM   = true;
const float    TRIM_KI        = 0.0005f;  // % duty per (rpm error * s)   TBD tune
const float    TRIM_LIMIT     = 10.0f;    // max |trim|, % duty
const int      TRIM_LAG_TICKS = 7;        // 0.7 s: compare rpm with the duty from this long ago
const uint32_t FAULT_HOLD_MS  = 2000;     // a fault must persist this long (TBD)

// Pressure residual (FUTURE: no sensor fitted). Kept disabled.
const bool  USE_PRESSURE    = false;
const int   PRESSURE_PIN    = -1;         // TBD
const float FAULT_TOL_PCT   = 15.0f;      // TBD: |r| / dP_twin threshold
const float FAULT_MIN_DP_PA = 5.0f;       // ignore residual when dP_twin is tiny

// telemetry.fault
const int8_t FAULT_OK = 0, FAULT_NOSPIN = 1, FAULT_TRIM_SAT = 2;
const int8_t FAULT_LEAK = 3, FAULT_BLOCKAGE = 4;   // reserved for the pressure sensor

// ===================== SHARED STATE =====================
enum Mode : uint8_t { MODE_BREATH, MODE_FREE, MODE_FLOW };
enum Dir : uint8_t { DIR_IN = 0, DIR_EX = 1 };   // declared early: Arduino puts prototypes up here

struct Command {
  long  id;
  char  name[12];
  Mode  mode;
  int   bpm;
  float duty;
  float ie;
  float vt;
};

struct Ack {
  long id;
  bool ok;
};

// One telemetry row. NAN / -1 mean null in the database.
struct Sample {
  int64_t     epochMs;   // 0 if NTP not synced yet (such samples are discarded)
  int         rpmIn;
  int         rpmEx;     // -1 = no exhale tach
  float       duty;
  const char* phase;     // always a string literal
  float       qTarget, qTwin, dpTwin, dpMeas, residualPct, rpmExpected, trim;
  int8_t      valid;     // -1 null, 0, 1
  int8_t      fault;     // -1 null, 0..4
};

QueueHandle_t cmdQ, ackQ, sampleQ;

volatile uint32_t lastContactMs = 0;   // written by netTask, read by controlTask
volatile bool     timeSynced    = false;
volatile bool     localStop     = false;

// ===================== TACH =====================
// Edge counting with a glitch filter, one per blower (same scheme as 0.7).
struct Tach {
  volatile uint32_t count;
  volatile uint32_t lastUs;
  uint32_t prevCount, prevEdgeUs;   // read side, core 1 only
  int      lastRpm;
};
portMUX_TYPE tachMux = portMUX_INITIALIZER_UNLOCKED;
Tach tachIn = {}, tachEx = {};

void IRAM_ATTR tachEdge(Tach& t) {
  uint32_t now = micros();
  portENTER_CRITICAL_ISR(&tachMux);
  if (now - t.lastUs >= TACH_GLITCH_US) {
    t.lastUs = now;
    t.count = t.count + 1;   // not ++: deprecated on volatile
  }
  portEXIT_CRITICAL_ISR(&tachMux);
}
void IRAM_ATTR onTachIn() { tachEdge(tachIn); }
void IRAM_ATTR onTachEx() { tachEdge(tachEx); }

// Edge-to-edge rpm. Good resolution even at ~2400 rpm (~4 pulses per 100 ms tick).
int readRpm(Tach& t) {
  uint32_t c, e;
  portENTER_CRITICAL(&tachMux);
  c = t.count;
  e = t.lastUs;
  portEXIT_CRITICAL(&tachMux);
  uint32_t nowUs = micros();

  if (nowUs - e > TACH_TIMEOUT_US) {
    t.lastRpm = 0;                                // stopped
  } else if (c != t.prevCount) {
    uint32_t span = e - t.prevEdgeUs;
    if (t.prevCount != 0 && span > 0 && span < TACH_TIMEOUT_US) {
      t.lastRpm = (int)((uint64_t)(c - t.prevCount) * 60000000ULL / span);
    }                                             // first edge after a stop. wait for the next
  }                                               // no new edge this tick. keep last value
  t.prevCount = c;
  t.prevEdgeUs = e;
  return t.lastRpm;
}

// ===================== TIME HELPERS =====================
int64_t nowEpochMs() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

void isoFromMs(int64_t ms, char* out, size_t len) {
  time_t s = (time_t)(ms / 1000);
  struct tm t;
  gmtime_r(&s, &t);
  char base[24];
  strftime(base, sizeof(base), "%Y-%m-%dT%H:%M:%S", &t);
  snprintf(out, len, "%s.%03d+00:00", base, (int)(ms % 1000));
}

// "2026-10-04T17:29:35.832812+00:00" (UTC) -> epoch seconds. TZ is UTC via configTime(0,0,...)
// Returns 0 on parse failure, which makes a 'start' look ancient and so expire (fail safe).
time_t parseIsoUtc(const char* s) {
  struct tm t = {};
  int y, mo, d, h, mi, se;
  if (sscanf(s, "%d-%d-%dT%d:%d:%d", &y, &mo, &d, &h, &mi, &se) != 6) return 0;
  t.tm_year = y - 1900; t.tm_mon = mo - 1; t.tm_mday = d;
  t.tm_hour = h; t.tm_min = mi; t.tm_sec = se;
  return mktime(&t);
}

// ===================== PWM / SERVO =====================
const bool HAS_EX_FAN = PWM_PIN_EX >= 0;
const bool HAS_EX_TACH = TACH_PIN_EX >= 0;

void pwmAttach(int pin, uint8_t ch, uint32_t freq, uint8_t bits) {
  if (pin < 0) return;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  (void)ch;
  ledcAttach(pin, freq, bits);
#else
  ledcSetup(ch, freq, bits);
  ledcAttachPin(pin, ch);
#endif
}

void pwmWrite(int pin, uint8_t ch, uint32_t raw) {
  if (pin < 0) return;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  (void)ch;
  ledcWrite(pin, raw);
#else
  ledcWrite(ch, raw);
#endif
}

// fan 0 = inhale blower, 1 = exhale blower. Same mapping as fan_sweep.ino.
void setFanDuty(int fan, float pct) {
  pct = constrain(pct, 0.0f, 100.0f);
  uint32_t raw = (uint32_t)(pct * PWM_MAX / 100.0f + 0.5f);
  if (fan == 0) pwmWrite(PWM_PIN_IN, PWM_CH_IN, raw);
  else          pwmWrite(PWM_PIN_EX, PWM_CH_EX, raw);
}

void allFansOff() {
  setFanDuty(0, 0);
  if (HAS_EX_FAN) setFanDuty(1, 0);
}

// Servo, 50 Hz, 1-2 ms pulse.
void setServo(float deg) {
  if (SERVO_PIN < 0) return;
  const uint32_t top = (1u << SERVO_BITS) - 1;
  float us = 1000.0f + constrain(deg, 0.0f, 180.0f) / 180.0f * 1000.0f;
  pwmWrite(SERVO_PIN, SERVO_CH, (uint32_t)(us / 20000.0f * top));
}

// ===================== TWIN MODEL =====================
float interp(float x, const float* xs, const float* ys, int n) {
  if (x <= xs[0]) return ys[0];
  for (int i = 0; i < n - 1; i++)
    if (x <= xs[i + 1]) return ys[i] + (x - xs[i]) / (xs[i + 1] - xs[i]) * (ys[i + 1] - ys[i]);
  return ys[n - 1];
}

const float* opQ(Dir d) { return d == DIR_IN ? OP_Q_IN : OP_Q_EX; }

// System curve with laminar / k-omega blend.
float dpSystem(float q, Dir d) {
  if (q <= 0) return 0;
  float aL = d == DIR_IN ? IN_A_LAM : EX_A_LAM, nL = d == DIR_IN ? IN_N_LAM : EX_N_LAM;
  float aT = d == DIR_IN ? IN_A_TUR : EX_A_TUR, nT = d == DIR_IN ? IN_N_TUR : EX_N_TUR;
  float L = aL * powf(q, nL), T = aT * powf(q, nT);
  if (q <= Q_BLEND_LO) return L;
  if (q >= Q_BLEND_HI) return T;
  float w = (q - Q_BLEND_LO) / (Q_BLEND_HI - Q_BLEND_LO);
  return (1 - w) * L + w * T;
}

// Control: target flow -> feed-forward duty. Below the first point (25 %) the fan is off.
float dutyForFlow(float q, Dir d) {
  if (q < opQ(d)[0]) return 0;
  return interp(q, opQ(d), OP_DUTY, N_OP);
}

// Expected rpm for a duty (operating-point rpm column).
float rpmForDuty(float duty) { return duty <= 0 ? 0 : interp(duty, OP_DUTY, OP_RPM, N_OP); }

// Prediction: rpm -> flow. Below the first point there is no data; Q ~ rpm (affinity law) down
// to 0, rather than the table's first flow (which would report 30 L/min from a stopped fan).
float flowForRpm(float rpm, Dir d) {
  if (rpm <= 0) return 0;
  if (rpm < OP_RPM[0]) return opQ(d)[0] * rpm / OP_RPM[0];
  return interp(rpm, OP_RPM, opQ(d), N_OP);
}

// Trim band of a duty: index of the operating point at or below it.
int bandOf(float duty) {
  int i = 0;
  while (i < N_OP - 1 && duty >= OP_DUTY[i + 1]) i++;
  return i;
}

// TBD: replace with the real sensor read. Must return dP in Pa with the SAME definition as the
// CFD (|p_barb_tip - p_fan_face|). NAN = no sensor.
float readPressurePa() {
  if (!USE_PRESSURE || PRESSURE_PIN < 0) return NAN;
  int raw = analogRead(PRESSURE_PIN);
  return raw * 0.0f;   // TBD calibration: Pa per count + offset
}

// ===================== CONTROL TASK (core 1) =====================
// Learned duty correction per fan and duty band. Kept between breaths and runs (reboot clears).
float trimBand[2][N_OP] = {};

void controlTask(void*) {
  bool     running    = false;
  Mode     mode       = MODE_BREATH;
  int      bpm        = DEFAULT_BPM;
  float    peak       = DEFAULT_PEAK;
  float    ie         = DEFAULT_IE;
  uint32_t cycleStart = 0;
  uint8_t  idleDiv    = 0;
  float    freeDuty   = 0.0f;
  uint32_t kickUntil  = 0;      // 0 = no kick in progress
  uint32_t spinCheck  = 0;      // time from which a zero tach counts as a stall
  int      rpmPrev    = 0;      // last tick's rpm (inhale blower)
  // Flow breath
  float    flowVt     = 1.0f;
  int      flowBpm    = DEFAULT_BPM;
  float    flowIe     = DEFAULT_IE;
  int      lastDir    = -1;     // -1 = not in a breath yet
  uint32_t flapUntil  = 0;
  uint32_t noSpinSince = 0, trimSatSince = 0;
  float    ffHist[TRIM_LAG_TICKS + 1] = {};   // feed-forward duty history, for the lagged trim
  int      ffHead = 0;
  TickType_t lastWake = xTaskGetTickCount();

  for (;;) {
    vTaskDelayUntil(&lastWake, pdMS_TO_TICKS(CTRL_PERIOD_MS));

    // 1. Commands
    Command c;
    while (xQueueReceive(cmdQ, &c, 0) == pdTRUE) {
      Ack a = { c.id, true };
      if (strcmp(c.name, "start") == 0 && c.mode == MODE_FREE) {
        if (c.duty < 0.0f) {
          a.ok = false;
          Serial.printf("[ctl] FREE #%ld rejected. no duty given\n", c.id);
        } else {
          uint32_t now = millis();
          freeDuty  = constrain(c.duty, 0.0f, 100.0f);
          bool stopped = (rpmPrev == 0);
          kickUntil = (stopped && freeDuty >= DEADBAND_STOP && freeDuty < DEADBAND_START)
                      ? now + KICK_MS : 0;
          spinCheck = now + KICK_MS;
          if (HAS_EX_FAN) setFanDuty(1, 0);
          mode      = MODE_FREE;
          running   = true;
          Serial.printf("[ctl] FREE #%ld  duty %.1f%%%s\n", c.id, freeDuty,
                        kickUntil ? "  (kick-start)" : "");
        }
      } else if (strcmp(c.name, "start") == 0 && c.mode == MODE_FLOW) {
        if (!(c.vt >= VT_MIN && c.vt <= VT_MAX) || c.bpm < 5 || c.bpm > 40) {
          a.ok = false;
          Serial.printf("[ctl] FLOW #%ld rejected. vt %.3f L / bpm %d out of range or missing\n",
                        c.id, c.vt, c.bpm);
        } else {
          flowVt  = c.vt;
          flowBpm = c.bpm;
          if (c.ie > 0.0f) flowIe = constrain(c.ie, 0.25f, 4.0f);
          mode = MODE_FLOW;
          running = true;
          cycleStart = millis();
          lastDir = -1;
          noSpinSince = trimSatSince = 0;
          memset(ffHist, 0, sizeof(ffHist));
          // Inhale peak = pi*Vt / (2*Ti), Ti = (60/bpm) / (1+ie) s -> pi*Vt*bpm*(1+ie)/2 L/min
          float qPeak = PI * flowVt * flowBpm * (1.0f + flowIe) / 2.0f;
          Serial.printf("[ctl] FLOW #%ld  Vt %.3f L  bpm %d  I:E 1:%.2f  inhale peak %.1f L/min\n",
                        c.id, flowVt, flowBpm, flowIe, qPeak);
          if (qPeak > OP_Q_IN[N_OP - 1])
            Serial.println("[ctl] WARNING: inhale peak above the fan's max, it will saturate");
        }
      } else if (strcmp(c.name, "start") == 0) {
        if (c.bpm  > 0)    bpm  = constrain(c.bpm, 5, 40);
        if (c.duty > 0.0f) peak = constrain(c.duty, FLOOR_DUTY, 100.0f);
        if (c.ie   > 0.0f) ie   = constrain(c.ie, 0.25f, 4.0f);
        if (HAS_EX_FAN) setFanDuty(1, 0);
        mode = MODE_BREATH;
        running = true;
        cycleStart = millis();
        Serial.printf("[ctl] START #%ld  bpm %d  peak %.0f%%  I:E 1:%.2f\n", c.id, bpm, peak, ie);
      } else if (strcmp(c.name, "stop") == 0) {
        running = false;
        Serial.printf("[ctl] STOP #%ld\n", c.id);
      } else {
        a.ok = false;
        Serial.printf("[ctl] unknown command '%s' #%ld\n", c.name, c.id);
      }
      xQueueSend(ackQ, &a, 0);   // ack only after executing, so 'done' means done
    }

    // 2. Local stop and network failsafe
    if (localStop) {
      localStop = false;
      if (running) Serial.println("[ctl] LOCAL STOP");
      running = false;
    }
    if (running) {
      uint32_t last = lastContactMs;   // read before millis(), so now >= last
      uint32_t now  = millis();
      if (now - last > FAILSAFE_MS) {
        running = false;
        Serial.printf("[ctl] FAILSAFE. no Supabase contact for %lu ms, blower stopped\n",
                      (unsigned long)(now - last));
      }
    }

    // 3. Output. Twin fields stay null outside flow mode.
    float duty = 0.0f;
    const char* phase = "idle";
    Sample s = {};
    s.qTarget = s.qTwin = s.dpTwin = s.dpMeas = s.residualPct = s.rpmExpected = s.trim = NAN;
    s.valid = -1;
    s.fault = -1;

    // Measure both tachs every tick, so each one's edge bookkeeping stays current.
    int rpmIn = readRpm(tachIn);
    int rpmEx = HAS_EX_TACH ? readRpm(tachEx) : -1;

    if (!running) {
      allFansOff();
      lastDir = -1;
    } else if (mode == MODE_FREE) {
      // 3a. Free flow. Fixed duty with deadband handling (as 0.7).
      uint32_t now = millis();
      if (freeDuty < DEADBAND_STOP) {
        duty  = 0.0f;                       // driver will not run here, so do not pretend
        phase = "free_below";
      } else if (kickUntil && (int32_t)(kickUntil - now) > 0) {
        duty  = KICK_DUTY;
        phase = "free_kick";
      } else {
        kickUntil = 0;
        duty  = freeDuty;
        phase = (freeDuty >= 100.0f) ? "free_sat" : "free";
        if (rpmPrev == 0 && (int32_t)(now - spinCheck) > (int32_t)NOSPIN_MS) {
          if (freeDuty < DEADBAND_START) {  // dropped out inside the deadband. kick again
            kickUntil = now + KICK_MS;
            spinCheck = now + KICK_MS;
            duty  = KICK_DUTY;
            phase = "free_kick";
          } else {
            phase = "free_nospin";          // should be spinning but tach says no
          }
        }
      }
      setFanDuty(0, duty);
    } else if (mode == MODE_BREATH) {
      // 3b. Breath. Half-sine on inhale, floor on exhale. Integer modulo, no float drift.
      uint32_t T_ms  = 60000UL / (uint32_t)bpm;
      uint32_t Ti_ms = (uint32_t)(T_ms / (1.0f + ie));
      uint32_t t     = (millis() - cycleStart) % T_ms;
      if (t < Ti_ms) {
        duty  = FLOOR_DUTY + (peak - FLOOR_DUTY) * sinf(PI * (float)t / (float)Ti_ms);
        phase = "inhale";
      } else {
        duty  = FLOOR_DUTY;
        phase = "exhale";
      }
      setFanDuty(0, duty);
    } else {
      // 3c. Flow breath driven by the twin.
      uint32_t now   = millis();
      uint32_t T_ms  = 60000UL / (uint32_t)flowBpm;
      uint32_t Ti_ms = (uint32_t)(T_ms / (1.0f + flowIe));
      uint32_t t     = (now - cycleStart) % T_ms;
      Dir      dir   = t < Ti_ms ? DIR_IN : DIR_EX;
      uint32_t half  = dir == DIR_IN ? Ti_ms : T_ms - Ti_ms;
      uint32_t tIn   = dir == DIR_IN ? t : t - Ti_ms;
      float qPeak    = PI * flowVt / (2.0f * (half / 60000.0f));   // L/min
      float qTarget  = qPeak * sinf(PI * (float)tIn / (float)half);
      phase = dir == DIR_IN ? "inhale" : "exhale";

      // Phase switch: both fans off, flap moves, then the active fan. The lag history is
      // cleared so the trim never compares one fan's rpm with the other fan's duty.
      if ((int)dir != lastDir) {
        allFansOff();
        setServo(dir == DIR_IN ? SERVO_ANGLE_INHALE : SERVO_ANGLE_EXHALE);
        flapUntil = now + SERVO_MOVE_MS;
        lastDir = dir;
        memset(ffHist, 0, sizeof(ffHist));
      }
      bool flapMoving = (int32_t)(flapUntil - now) > 0;

      // Job 1: feed-forward duty + learned trim. With one blower it drives both halves.
      int   fan  = (dir == DIR_EX && HAS_EX_FAN) ? 1 : 0;
      float ff   = flapMoving ? 0.0f : min(100.0f, dutyForFlow(qTarget, dir));
      float trim = ff > 0 ? trimBand[fan][bandOf(ff)] : 0.0f;
      // Keep the trimmed duty above the driver deadband: below 19 % it would just stop.
      duty = ff > 0 ? constrain(ff + trim, DEADBAND_START, 100.0f) : 0.0f;
      setFanDuty(fan, duty);
      if (HAS_EX_FAN) setFanDuty(1 - fan, 0);

      // Measured rpm of the active fan (an exhale fan without a tach has none).
      bool  rpmKnown = fan == 0 || HAS_EX_TACH;
      int   rpm      = fan == 0 ? rpmIn : rpmEx;

      // Lagged comparison for the trim: duty commanded TRIM_LAG_TICKS ago vs rpm now.
      ffHist[ffHead] = ff;
      ffHead = (ffHead + 1) % (TRIM_LAG_TICKS + 1);
      float ffLag  = ffHist[ffHead];             // oldest entry
      float rpmExp = rpmForDuty(ffLag);
      if (USE_RPM_TRIM && rpmKnown && ff > 0 && ffLag > 0) {
        float& tb = trimBand[fan][bandOf(ffLag)];
        tb = constrain(tb + TRIM_KI * (rpmExp - rpm) * (CTRL_PERIOD_MS / 1000.0f), -TRIM_LIMIT, TRIM_LIMIT);
      }

      // Job 2: prediction from the MEASURED rpm (expected rpm if this fan has no tach).
      float rpmUse = rpmKnown ? (float)rpm : rpmForDuty(duty);
      float qTwin  = duty > 0 ? flowForRpm(rpmUse, dir) : 0.0f;
      float dpTwin = dpSystem(qTwin, dir);
      bool  valid  = duty >= DUTY_VALID_MIN;

      // Job 3: faults from rpm only (pressure residual below, disabled).
      int8_t fault = FAULT_OK;
      if (rpmKnown && duty > 0 && rpm == 0) { if (!noSpinSince) noSpinSince = now; }
      else noSpinSince = 0;
      if (ff > 0 && fabsf(trim) >= TRIM_LIMIT - 0.01f) { if (!trimSatSince) trimSatSince = now; }
      else if (ff > 0) trimSatSince = 0;               // flap pause / fan off keeps the state
      if (noSpinSince && now - noSpinSince >= NOSPIN_MS) fault = FAULT_NOSPIN;
      else if (trimSatSince && now - trimSatSince >= FAULT_HOLD_MS) fault = FAULT_TRIM_SAT;

      float dpMeas = readPressurePa();
      float resPct = NAN;
      if (!isnan(dpMeas) && valid && dpTwin > FAULT_MIN_DP_PA) {
        resPct = (dpMeas - dpTwin) / dpTwin * 100.0f;
        // FUTURE: hold for FAULT_HOLD_MS before flagging, like the rpm faults.
        if (fault == FAULT_OK && fabsf(resPct) > FAULT_TOL_PCT) fault = resPct < 0 ? FAULT_LEAK : FAULT_BLOCKAGE;
      }

      s.qTarget     = qTarget;
      s.qTwin       = qTwin;
      s.dpTwin      = dpTwin;
      s.dpMeas      = dpMeas;
      s.residualPct = resPct;
      s.rpmExpected = rpmExp;
      s.trim        = ff > 0 ? trim : NAN;
      s.valid       = valid ? 1 : 0;
      s.fault       = fault;
    }

    // 4. Queue a sample. 10 Hz running, 1 Hz idle. Never block.
    rpmPrev = rpmIn;
    if (running || ++idleDiv >= 10) {
      idleDiv = 0;
      if (timeSynced) {                     // a sample without a timestamp is useless
        s.epochMs = nowEpochMs();
        s.rpmIn   = rpmIn;
        s.rpmEx   = rpmEx;
        s.duty    = duty;
        s.phase   = phase;
        xQueueSend(sampleQ, &s, 0);
      }
    }
  }
}

// ===================== NETWORK (core 0) =====================
WiFiClientSecure tls;
HTTPClient       http;
long             lastQueuedId = 0;

// Returns HTTP code. Reads the body only when asked (avoids the 204 hang seen in v1).
int supabaseRequest(const char* method, const String& path, const String& body,
                    String* response = nullptr, const char* prefer = "return=minimal") {
  String url = String(SUPABASE_URL) + "/rest/v1/" + path;
  if (!http.begin(tls, url)) return -1;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Content-Type", "application/json");
  if (prefer) http.addHeader("Prefer", prefer);

  int code;
  if (strcmp(method, "GET") == 0) code = http.GET();
  else code = http.sendRequest(method, body);

  if (code >= 200 && code < 300) {
    lastContactMs = millis();
    if (response && code == 200) *response = http.getString();
  } else {
    Serial.printf("[net] %s %s -> HTTP %d\n", method, path.c_str(), code);
    if (code > 0) Serial.println(http.getString());
  }
  http.end();
  return code;
}

// Content errors that will never succeed on retry. Auth (401/403) and rate limit (429)
// are not in this list, so a wrong key does not silently throw data away.
bool isPermanentReject(int code) {
  return code == 400 || code == 404 || code == 409 || code == 422;
}

void ensureWiFi() {
  static uint32_t lastTry = 0;
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastTry < 5000) return;
  lastTry = millis();
  Serial.println("[net] WiFi down, reconnecting");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

void pollCommands() {
  String path = String("commands?select=id,command,params,created_at")
              + "&device_id=eq." + DEVICE_ID
              + "&status=eq.pending&id=gt." + String(lastQueuedId)
              + "&order=id.asc&limit=5";
  String resp;
  if (supabaseRequest("GET", path, "", &resp, nullptr) != 200) return;

  JsonDocument doc;
  if (deserializeJson(doc, resp)) { Serial.println("[net] bad command JSON"); return; }

  for (JsonObject j : doc.as<JsonArray>()) {
    Command c = {};
    c.id = j["id"] | 0L;
    strlcpy(c.name, j["command"] | "", sizeof(c.name));
    c.bpm  = j["params"]["bpm"]      | 0;
    c.duty = j["params"]["duty"]     | 0.0f;
    c.ie   = j["params"]["ie_ratio"] | 0.0f;
    c.vt   = j["params"]["vt"]       | -1.0f;   // flow mode only; missing -> 'error'
    const char* m = j["params"]["mode"] | "breath";
    c.mode = strcmp(m, "free") == 0 ? MODE_FREE : strcmp(m, "flow") == 0 ? MODE_FLOW : MODE_BREATH;
    if (c.mode == MODE_FREE && j["params"]["duty"].isNull()) c.duty = -1.0f;   // -> 'error'

    long age = (long)(time(nullptr) - parseIsoUtc(j["created_at"] | ""));
    if (strcmp(c.name, "start") == 0 && age > (long)COMMAND_TTL_S) {
      char ts[40];
      isoFromMs(nowEpochMs(), ts, sizeof(ts));
      int code = supabaseRequest("PATCH", "commands?id=eq." + String(c.id),
                                 String("{\"status\":\"expired\",\"acked_at\":\"") + ts + "\"}");
      if (code < 200 || code >= 300) break;   // retry on the next poll, keep order
      lastQueuedId = c.id;
      Serial.printf("[net] cmd #%ld 'start' EXPIRED (%ld s old), not executed\n", c.id, age);
      continue;
    }

    if (xQueueSend(cmdQ, &c, 0) != pdTRUE) break;
    lastQueuedId = c.id;
    Serial.printf("[net] cmd #%ld '%s' received\n", c.id, c.name);
  }
}

void sendAcks() {
  Ack a;
  while (xQueuePeek(ackQ, &a, 0) == pdTRUE) {
    char ts[40];
    isoFromMs(nowEpochMs(), ts, sizeof(ts));
    String body = String("{\"status\":\"") + (a.ok ? "done" : "error")
                + "\",\"acked_at\":\"" + ts + "\"}";
    int code = supabaseRequest("PATCH", "commands?id=eq." + String(a.id), body);
    Serial.printf("[net] ack #%ld -> HTTP %d\n", a.id, code);
    if ((code >= 200 && code < 300) || isPermanentReject(code)) {
      xQueueReceive(ackQ, &a, 0);   // delivered (or never will be). remove it
    } else {
      break;                        // network problem. retry this ack next loop
    }
  }
}

// Number or null, rounded to `decimals`. Keeps every row's keys identical (PGRST102).
void putNum(JsonObject o, const char* key, float v, int decimals) {
  if (isnan(v)) { o[key] = nullptr; return; }
  float m = powf(10.0f, (float)decimals);
  o[key] = roundf(v * m) / m;
}

// Holds samples across failed POSTs (30 s at 10 Hz), oldest dropped first.
const int BUF_MAX = 300, BATCH_MAX = 50;
Sample    buf[BUF_MAX];
int       bufN = 0;

void sendTelemetry() {
  Sample s;
  while (xQueueReceive(sampleQ, &s, 0) == pdTRUE) {
    if (s.epochMs <= 0) continue;   // belt and braces. never send a row without sampled_at
    if (bufN == BUF_MAX) { memmove(buf, buf + 1, sizeof(Sample) * (BUF_MAX - 1)); bufN--; }
    buf[bufN++] = s;
  }
  if (bufN == 0) return;

  // Every object MUST have identical keys, or PostgREST rejects the batch (PGRST102).
  int n = min(bufN, BATCH_MAX);
  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  char ts[40];
  for (int i = 0; i < n; i++) {
    const Sample& b = buf[i];
    JsonObject o = arr.add<JsonObject>();
    isoFromMs(b.epochMs, ts, sizeof(ts));
    o["device_id"]  = DEVICE_ID;
    o["sampled_at"] = ts;           // ArduinoJson copies char arrays
    o["rpm_inhale"] = b.rpmIn;
    if (b.rpmEx < 0) o["rpm_exhale"] = nullptr; else o["rpm_exhale"] = b.rpmEx;
    o["phase"]      = b.phase;
#if LOG_DUTY
    o["duty_cmd"]   = roundf(b.duty * 10.0f) / 10.0f;
#endif
    putNum(o, "q_target",     b.qTarget, 1);
    putNum(o, "q_twin",       b.qTwin, 1);
    putNum(o, "dp_twin",      b.dpTwin, 2);
    putNum(o, "dp_meas",      b.dpMeas, 2);
    putNum(o, "residual_pct", b.residualPct, 1);
    putNum(o, "rpm_expected", b.rpmExpected, 0);
    putNum(o, "trim",         b.trim, 2);
    if (b.valid < 0) o["twin_valid"] = nullptr; else o["twin_valid"] = b.valid == 1;
    if (b.fault < 0) o["fault"] = nullptr; else o["fault"] = b.fault;
  }
  String body;
  serializeJson(doc, body);

  int code = supabaseRequest("POST", "telemetry", body);
  if (code == 201 || isPermanentReject(code)) {
    if (code != 201) Serial.printf("[net] dropped %d telemetry rows (HTTP %d)\n", n, code);
    memmove(buf, buf + n, sizeof(Sample) * (bufN - n));
    bufN -= n;
  }                                 // otherwise keep them and retry next second
}

void heartbeat() {
  char ts[40];
  isoFromMs(nowEpochMs(), ts, sizeof(ts));
  String body = String("{\"device_id\":\"") + DEVICE_ID + "\",\"last_seen\":\"" + ts
              + "\",\"firmware\":\"" + FW_VERSION + "\",\"wifi_rssi\":" + WiFi.RSSI() + "}";
  supabaseRequest("POST", "device_status?on_conflict=device_id", body,
                  nullptr, "resolution=merge-duplicates,return=minimal");
}

void netTask(void*) {
  uint32_t lastPoll = 0, lastBeat = 0;
  for (;;) {
    ensureWiFi();
    if (WiFi.status() == WL_CONNECTED) {
      if (!timeSynced && time(nullptr) > 1700000000) {
        timeSynced = true;
        Serial.println("[net] NTP synced");
      }
      if (timeSynced) {                       // no expiry check or timestamps without a clock
        sendAcks();
        uint32_t now = millis();
        if (now - lastPoll >= 1000) {
          lastPoll = now;
          pollCommands();
          sendTelemetry();
        }
        if (now - lastBeat >= 5000) {
          lastBeat = now;
          heartbeat();
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

// ===================== SETUP / LOOP =====================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.printf("\nESP4902 %s\n", FW_VERSION);
  Serial.printf("exhale blower %s, exhale tach %s, flap servo %s\n",
                HAS_EX_FAN ? "wired" : "not wired (inhale blower drives both halves)",
                HAS_EX_TACH ? "wired" : "not wired", SERVO_PIN >= 0 ? "fitted" : "not fitted");

  // Blowers off before anything else
  pwmAttach(PWM_PIN_IN, PWM_CH_IN, PWM_FREQ, PWM_BITS);
  pwmAttach(PWM_PIN_EX, PWM_CH_EX, PWM_FREQ, PWM_BITS);
  allFansOff();
  pwmAttach(SERVO_PIN, SERVO_CH, 50, SERVO_BITS);
  setServo(SERVO_ANGLE_INHALE);

  pinMode(TACH_PIN_IN, INPUT_PULLUP);   // keep your external 3.3 V pull-up / divider; this is a backup
  attachInterrupt(digitalPinToInterrupt(TACH_PIN_IN), onTachIn, FALLING);
  if (HAS_EX_TACH) {
    pinMode(TACH_PIN_EX, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(TACH_PIN_EX), onTachEx, FALLING);
  }

  cmdQ    = xQueueCreate(8, sizeof(Command));
  ackQ    = xQueueCreate(8, sizeof(Ack));
  sampleQ = xQueueCreate(300, sizeof(Sample));

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  configTime(0, 0, "pool.ntp.org", "time.google.com");   // UTC

  tls.setInsecure();      // demo only, no certificate check
  http.setReuse(true);    // keep the TLS session alive between requests

  lastContactMs = millis();
  xTaskCreatePinnedToCore(controlTask, "control", 6144, nullptr, 3, nullptr, 1);
  xTaskCreatePinnedToCore(netTask,     "net",     16384, nullptr, 1, nullptr, 0);
}

void loop() {
  if (Serial.available()) {
    char ch = Serial.read();
    if (ch == 'x' || ch == 'X') localStop = true;
  }
  vTaskDelay(pdMS_TO_TICKS(20));
}
