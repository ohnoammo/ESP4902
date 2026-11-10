/*
  ESP4902 breathing simulator. Final firmware (final-1.0-twin)

  = esp32_supabase_rtos_v4.ino (WiFi, Supabase, FreeRTOS, safety)
  + twin_installed_breathing.ino (two-fan control loop and digital twin, behaviour unchanged)

  Tasks
    Core 1. controlTask (prio 3)  50 Hz tick: commands, failsafe, fans, twin. No Serial, no network.
    Core 0. netTask     (prio 1)  WiFi, telemetry batch POST (1 s), command poll (1 s), acks,
                                  heartbeat (5 s). Network calls never touch the control loop.
    Core 0. logTask     (prio 1)  10 Hz Serial CSV, BME280 read once a second.

  Control (per 20 ms tick, from twin_installed_breathing.ino)
    Target       Q(t) = pi*Vt*f*sin(2*pi*t/T) L/min. + inhale (inhale fan), - exhale (exhale fan).
    Feed-forward the target LEAD_S ahead -> duty, inverse of that fan's INSTALLED table.
    Fast feedback  + KP * (rpm_cmd - rpm).
    Slow trim    integral on rpm per duty band, +-10 %, only while expected rpm changes < 3000 rpm/s.
    Twin         measured rpm -> installed flow, signed like the target.
    Only one fan runs at a time; the idle fan is held at PWM 0 and EN LOW.

  Commands (public.commands)
    start {"preset":"demo_15"}                  demo_15 | walk_slow | walk_fast | light_f | light_m
    start {"vt":0.5, "bpm":14}                  custom (also accepts "mode":"flow" from the app)
    start {"mode":"free","duty":50,"fan":"exhale"}  free flow: one fan at a fixed duty until stop
                                                fan "inhale" (default) or "exhale"
    start {} or unknown preset                  demo_15 (low-duty default)
    optional "breaths": n (default 10, 0 = run until stop)
    stop                                         both fans off
    A 'start' older than COMMAND_TTL_S is marked 'expired' and not run (v4 FIX 7).
    Out-of-range vt (0.1..2.5 L), bpm (5..40) or free duty (0..100) -> 'error', nothing runs.

  Free flow (mode "free")
    The chosen fan at a fixed duty, the other held off, until stop (no breath count). From rest, a
    duty below 25 % first kicks at 25 % for 1 s. Phases: free, free_kick, free_sat (100 %),
    free_nospin (fault 1: commanded, no tach for 2 s), free_below (duty 0). The twin reports the
    installed-calibration flow at the measured rpm; q_target / rpm_expected are what the table
    expects at that duty. No trim: free flow is open loop by design. Serial Q_target / Q_twin are
    negative on the exhale fan; telemetry says which fan in active_fan.

  Serial CSV, 115200, 10 Hz while running (non-CSV lines start with '#'):
    act,breath,t_ms,phase,Q_target,duty,trim,rpm,rpm_exp,Q_twin,valid,fault
    fault: 0 ok, 1 no spin (>2 s), 2 trim saturated, 3 target above fan capacity

  telemetry columns written (identical keys every row; null where not applicable)
    device_id, sampled_at, phase, duty_cmd, rpm_inhale, rpm_exhale, temp_c, rh_pct, pressure_hpa,
    q_target, q_twin, rpm_expected, trim, twin_valid, fault, active_fan
    q_target / q_twin are MAGNITUDES (L/min), as the existing columns are defined; the sign comes
    from phase ('inhale' +, 'exhale' -), or in free flow from active_fan.
    active_fan = the fan being driven ('inhale' / 'exhale', null when idle).
    pressure_hpa and active_fan need the migration
    supabase/migrations/20261111_final_pressure.sql (applied to ESP4902 2026-11-10). Without it,
    PostgREST rejects every telemetry batch that carries them: set SEND_NEW_COLUMNS to false to
    run before the migration (the app then shows exhale free flow as inhale).

  Libraries   ArduinoJson v7, Adafruit BME280 (+ Adafruit Unified Sensor)
  Board       ESP32S3 Dev Module, Arduino core 3.x
  Credentials secrets.h (git-ignored), copied from secrets.example.h
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_BME280.h>
#include <sys/time.h>
#include <time.h>
#include <math.h>
#include "secrets.h"

const char* WIFI_SSID    = SECRET_WIFI_SSID;
const char* WIFI_PASS    = SECRET_WIFI_PASS;
const char* SUPABASE_URL = SECRET_SUPABASE_URL;
const char* SUPABASE_KEY = SECRET_SUPABASE_KEY;
const char* DEVICE_ID    = "sim01";
const char* FW_VERSION   = "final-1.0-twin";   // the app enables its flow controls on "twin"
const bool  SEND_NEW_COLUMNS = true;            // pressure_hpa, active_fan: need migration 20261111

// ---------------- PINS (verified 10 Nov 2026) ----------------
const int PWM_IN = 17, TACH_IN = 4, EN_IN = 6;   // inhale fan (left)
const int PWM_EX = 18, TACH_EX = 5, EN_EX = 7;   // exhale fan (right)
const int PWM_FREQ = 25000, PWM_RES = 10;        // EN open-drain: LOW = stop
const int I2C_SDA = 8, I2C_SCL = 9;              // BME280

// ---------------- TIMING (v4) ----------------
const uint32_t CTRL_PERIOD_MS = 20;       // 50 Hz control
const int      LOG_EVERY      = 5;        // 10 Hz samples / Serial
const uint32_t POST_PERIOD_MS = 1000;
const uint32_t POLL_PERIOD_MS = 1000;
const uint32_t BEAT_PERIOD_MS = 5000;
const uint32_t FAILSAFE_MS    = 10000;    // no good request for this long -> stop
const uint32_t RECONNECT_MS   = 10000;
const uint32_t HTTP_TIMEOUT_MS = 3000;
const long     COMMAND_TTL_S  = 5;
const int      QUEUE_DEPTH    = 50;       // 5 s of samples
const int      MAX_BATCH      = 50;

// ---------------- CONTROL (twin_installed_breathing.ino) ----------------
const int   N_BREATHS_DEFAULT = 10;
const float LEAD_S = 0.2f;
const float KP     = 0.005f;
const float TRIM_KI = 0.0005f, TRIM_LIMIT = 10.0f, STEADY_RPM_RATE = 3000.0f;
const float VT_MIN = 0.1f, VT_MAX = 2.5f;
const float BPM_MIN = 5, BPM_MAX = 40;    // keep in sync with DB check constraint

struct Activity { const char* name; float vt_L; float bpm; };
// Report Table V (walking [37], light exercise [38]) + a demo both fans can deliver.
// Exhale fan max is 17.3 L/min, so every preset except demo_15 clips the exhale peak (fault 3).
const int N_ACT = 5;
const Activity ACTS[N_ACT] = {
  {"demo_15",   0.318f, 15.0f},   // peak 15.0 L/min: within both fans' installed range (default)
  {"walk_slow", 0.95f,  20.5f},   // peak 61.2 L/min
  {"walk_fast", 1.18f,  25.4f},   // peak 94.2 L/min
  {"light_f",   0.992f, 21.0f},   // peak 65.4 L/min
  {"light_m",   1.25f,  20.0f},   // peak 78.5 L/min
};
const int ACT_CUSTOM = -1;
const int ACT_FREE   = -3;             // free flow (fixed duty)
const uint32_t KICK_MS = 1000;        // free flow: kick at 25 % from rest below 25 %

// ---------------- INSTALLED CALIBRATION (15 V, sealed, 10 Nov 2026) ----------------
const int N_CAL = 10;
const float CAL_DUTY[N_CAL] = { 25,   30,   35,   40,   50,   60,    70,    80,    90,    100   };
const float EX_Q  [N_CAL]   = { 1.8,  3.0,  4.0,  5.1,  7.5,  8.8,   10.8,  13.8,  15.8,  17.3  };  // exhale nostril
const float EX_RPM[N_CAL]   = { 3446, 5107, 6341, 7450, 9421, 11217, 13117, 15392, 17565, 19685 };
const float IN_Q  [N_CAL]   = { 6.4,  10.5, 14.8, 21.2, 35.8, 48.6,  61.4,  74.6,  90.1,  105.1 };  // inhale outlet, upper bound
const float IN_RPM[N_CAL]   = { 3333, 5267, 6850, 8231, 10711,12666, 14411, 16187, 18271, 20540 };

struct Fan {
  int pwm, tach, en;
  const float *q, *rpm;
  float trim[N_CAL];          // learned per duty band, kept until reboot
  volatile uint32_t last, per;
};
Fan IN = {PWM_IN, TACH_IN, EN_IN, IN_Q, IN_RPM, {0}, 0, 0};
Fan EX = {PWM_EX, TACH_EX, EN_EX, EX_Q, EX_RPM, {0}, 0, 0};

// ---------------- SHARED TYPES ----------------
struct Sample {
  char    ts[32];
  bool    running;
  int8_t  act;               // preset index, ACT_CUSTOM
  int16_t breath;
  uint32_t tMs;              // since run start
  const char* phase;         // telemetry phase (string literal): inhale, exhale, idle, free...
  const char* fan;           // driven fan: "inhale", "exhale", nullptr when idle
  float   qTarget, duty, trim, rpm, rpmExp, qTwin;   // qTarget/qTwin signed; NAN = null
  int     rpmIn, rpmEx;
  int8_t  valid, fault;      // -1 = null
  float   temp, rh, pres;    // NAN = no BME280
};

struct Command {
  long  id;
  char  name[16];
  int8_t act;                // preset index, ACT_CUSTOM or ACT_FREE
  float vt, bpm;
  float duty;                // free flow only
  bool  fanEx;               // free flow: true = exhale fan
  int   breaths;
};

struct Ack {
  long  id;
  bool  ok;
  bool  running;
  int8_t act;
  float vt, bpm, qPeak;
  float duty;                // free flow
  bool  fanEx;
};

QueueHandle_t sampleQ, logQ, cmdQ, ackQ;

volatile uint32_t lastNetOkMs     = 0;
volatile uint32_t droppedSamples  = 0;
volatile uint32_t droppedAcks     = 0;
volatile bool     failsafeTripped = false;
volatile float    envTemp = NAN, envRh = NAN, envPres = NAN;   // written by logTask

char bootIso[32];
Adafruit_BME280 bme;
bool bmeOk = false;

WiFiClientSecure tls;     // netTask only
HTTPClient http;          // netTask only

// ---------------- HELPERS ----------------
void isoNowMs(char* out, size_t len) {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  struct tm t;
  gmtime_r(&tv.tv_sec, &t);
  size_t n = strftime(out, len, "%Y-%m-%dT%H:%M:%S", &t);
  snprintf(out + n, len - n, ".%03ldZ", (long)(tv.tv_usec / 1000));
}

time_t parseIsoUtc(const char* s) {
  struct tm t = {};
  int y, mo, d, h, mi, se;
  if (!s || sscanf(s, "%d-%d-%dT%d:%d:%d", &y, &mo, &d, &h, &mi, &se) != 6) return 0;
  t.tm_year = y - 1900; t.tm_mon = mo - 1; t.tm_mday = d;
  t.tm_hour = h; t.tm_min = mi; t.tm_sec = se;
  t.tm_isdst = 0;
  return mktime(&t);
}

const char* actName(int8_t a) { return a >= 0 ? ACTS[a].name : a == ACT_FREE ? "free" : "custom"; }

// Tach: period between pulses; a pulse < 1.5 ms after the last is a glitch.
void IRAM_ATTR isrIn() { uint32_t t = micros(), p = t - IN.last; if (p > 1500) { IN.per = p; IN.last = t; } }
void IRAM_ATTR isrEx() { uint32_t t = micros(), p = t - EX.last; if (p > 1500) { EX.per = p; EX.last = t; } }

float readRpm(Fan &f) {
  noInterrupts(); uint32_t p = f.per, l = f.last; interrupts();
  uint32_t since = micros() - l;
  if (p == 0 || since > 500000) return 0;
  return 60.0e6f / (since > p ? since : p);
}

float interp(float x, const float* xs, const float* ys, int n) {
  if (x <= xs[0]) return ys[0];
  for (int i = 0; i < n - 1; i++)
    if (x <= xs[i + 1]) return ys[i] + (x - xs[i]) / (xs[i + 1] - xs[i]) * (ys[i + 1] - ys[i]);
  return ys[n - 1];
}
int bandOf(float d) { int b = 0; for (int i = 1; i < N_CAL; i++) if (fabsf(d - CAL_DUTY[i]) < fabsf(d - CAL_DUTY[b])) b = i; return b; }

void drive(Fan &f, float pct) {
  pct = constrain(pct, 0, 100);
  digitalWrite(f.en, pct > 0.5f ? HIGH : LOW);
  ledcWrite(f.pwm, (uint32_t)(pct / 100.0f * ((1 << PWM_RES) - 1) + 0.5f));
}

float dutyFor(const Fan &f, float q) {
  if (q <= 0) return 0;
  if (q < f.q[0]) return CAL_DUTY[0];                 // lowest reliable duty
  return interp(q, f.q, CAL_DUTY, N_CAL);             // above the table: 100 %
}
float rpmFor(const Fan &f, float q) {
  if (q <= 0) return 0;
  if (q < f.q[0]) return f.rpm[0] * q / f.q[0];
  return interp(q, f.q, f.rpm, N_CAL);
}
float twinFlow(const Fan &f, float rpm) {
  if (rpm <= 0) return 0;
  if (rpm < f.rpm[0]) return f.q[0] * rpm / f.rpm[0];
  return interp(rpm, f.rpm, f.q, N_CAL);
}

// Free flow: what the installed table expects from a fan at a duty (scaled below 25 %).
float flowAtDuty(const Fan &f, float d) {
  if (d <= 0) return 0;
  if (d < CAL_DUTY[0]) return f.q[0] * d / CAL_DUTY[0];
  return interp(d, CAL_DUTY, f.q, N_CAL);
}
float rpmAtDuty(const Fan &f, float d) {
  if (d <= 0) return 0;
  if (d < CAL_DUTY[0]) return f.rpm[0] * d / CAL_DUTY[0];
  return interp(d, CAL_DUTY, f.rpm, N_CAL);
}

// =================================================================
//  CORE 1. CONTROL TASK  (no Serial, no network, never blocks)
// =================================================================
void controlTask(void*) {
  TickType_t lastWake = xTaskGetTickCount();
  bool     running = false;
  int8_t   act = 0;                       // demo_15 by default
  float    vt = ACTS[0].vt_L, bpm = ACTS[0].bpm;
  int      nBreaths = N_BREATHS_DEFAULT;
  uint32_t runStart = 0, step = 0;
  float    noSpin = 0, rpmExpPrev = 0;
  float    freeDuty = 0;
  bool     freeEx = false;                // free flow on the exhale fan
  bool     kick = false;                  // free flow: kick-start pending from rest
  const float dt = CTRL_PERIOD_MS / 1000.0f;

  for (;;) {
    vTaskDelayUntil(&lastWake, pdMS_TO_TICKS(CTRL_PERIOD_MS));

    // 1. Commands, then report back
    Command c;
    while (xQueueReceive(cmdQ, &c, 0) == pdTRUE) {
      bool ok = true;
      if (strcmp(c.name, "start") == 0 && c.act == ACT_FREE) {
        if (!(c.duty >= 0 && c.duty <= 100)) {
          ok = false;                     // nothing runs
        } else {
          act = ACT_FREE; freeDuty = c.duty; freeEx = c.fanEx;
          Fan &ff = freeEx ? EX : IN;
          kick = freeDuty > 0 && freeDuty < CAL_DUTY[0] && readRpm(ff) < ff.rpm[0];
          drive(freeEx ? IN : EX, 0);
          running = true;
          runStart = millis();
          noSpin = 0; rpmExpPrev = 0;
        }
      } else if (strcmp(c.name, "start") == 0) {
        float v = c.act >= 0 ? ACTS[c.act].vt_L : c.vt;
        float f = c.act >= 0 ? ACTS[c.act].bpm  : c.bpm;
        if (!(v >= VT_MIN && v <= VT_MAX) || !(f >= BPM_MIN && f <= BPM_MAX)) {
          ok = false;                     // nothing runs
        } else {
          act = c.act; vt = v; bpm = f;
          nBreaths = c.breaths >= 0 ? c.breaths : N_BREATHS_DEFAULT;
          running = true;
          runStart = millis();
          noSpin = 0; rpmExpPrev = 0;
        }
      } else if (strcmp(c.name, "stop") == 0) {
        running = false;
        drive(IN, 0); drive(EX, 0);       // immediately, not at the end of the tick
      } else {
        ok = false;
      }
      Ack a = { c.id, ok, running, act, vt, bpm, act == ACT_FREE ? 0 : PI * vt * bpm, freeDuty, freeEx };
      if (xQueueSend(ackQ, &a, 0) != pdTRUE) droppedAcks++;
    }

    // 2. Failsafe (v4 FIX 1: snapshot before millis())
    uint32_t lastOk = lastNetOkMs;
    uint32_t now    = millis();
    if (running && (now - lastOk > FAILSAFE_MS)) {
      running = false;
      failsafeTripped = true;             // net task prints it
    }

    Sample s = {};
    s.act = act;
    s.qTarget = s.trim = s.rpm = s.rpmExp = s.qTwin = NAN;
    s.valid = s.fault = -1;
    s.phase = "idle";

    // 3a. Free flow: the chosen fan at a fixed duty, the other off, until stop
    if (running && act == ACT_FREE) {
      Fan &ff = freeEx ? EX : IN;
      const float sign = freeEx ? -1 : 1;                         // + inhale, - exhale
      uint32_t tRun = now - runStart;
      float rpm = readRpm(ff);
      float duty = freeDuty;
      const char* ph = freeDuty >= 100 ? "free_sat" : "free";
      if (freeDuty <= 0) ph = "free_below";
      if (kick && tRun < KICK_MS) { duty = CAL_DUTY[0]; ph = "free_kick"; }
      else kick = false;
      noSpin = (duty > 0 && rpm < 1) ? noSpin + dt : 0;
      int fault = 0;
      if (noSpin > 2.0f) { fault = 1; ph = "free_nospin"; }
      drive(freeEx ? IN : EX, 0);
      drive(ff, duty);
      s.breath  = 0;
      s.tMs     = tRun;
      s.phase   = ph;
      s.fan     = freeEx ? "exhale" : "inhale";
      s.qTarget = sign * flowAtDuty(ff, duty);
      s.duty    = duty;
      s.rpm     = rpm;
      s.rpmExp  = rpmAtDuty(ff, duty);
      s.qTwin   = sign * twinFlow(ff, rpm);
      s.valid   = rpm >= ff.rpm[0] ? 1 : 0;
      s.fault   = fault;
    }

    // 3b. Flow breath
    else if (running) {
      const float T = 60.0f / bpm;
      const float qPeak = PI * vt * bpm;
      float t = (now - runStart) / 1000.0f;
      int breath = (int)(t / T);
      if (nBreaths > 0 && breath >= nBreaths) running = false;     // run complete
      else {
        float q  = qPeak * sinf(2 * PI * fmodf(t, T) / T);          // + inhale, - exhale
        float qL = qPeak * sinf(2 * PI * fmodf(t + LEAD_S, T) / T);
        bool inhale = q >= 0, leadIn = qL >= 0;

        Fan &actF = leadIn ? IN : EX;                               // fan being driven
        Fan &idle = leadIn ? EX : IN;
        Fan &meas = inhale ? IN : EX;                               // fan doing the current phase
        drive(idle, 0);

        float qC = fabsf(qL), qT = fabsf(q);
        float rpm    = readRpm(actF);
        float dFF    = dutyFor(actF, qC);
        float rpmCmd = rpmFor(actF, qC);
        float rpmExp = rpmFor(meas, qT);
        float rpmRate = fabsf(rpmExp - rpmExpPrev) / dt; rpmExpPrev = rpmExp;

        int fault = 0; float trim = 0;
        if (qC > actF.q[N_CAL - 1]) fault = 3;                      // beyond installed capacity
        if (dFF > 0) {
          int b = bandOf(dFF);
          if (&actF == &meas && rpmRate < STEADY_RPM_RATE)
            actF.trim[b] = constrain(actF.trim[b] + TRIM_KI * (rpmExp - rpm) * dt, -TRIM_LIMIT, TRIM_LIMIT);
          trim = actF.trim[b];
          if (fabsf(trim) >= TRIM_LIMIT) fault = 2;
          noSpin = rpm < 1 ? noSpin + dt : 0;
          if (noSpin > 2.0f) fault = 1;
        } else noSpin = 0;

        float duty = dFF > 0 ? constrain(dFF + trim + KP * (rpmCmd - rpm), 0, 100) : 0;
        drive(actF, duty);

        float rpmM = readRpm(meas);
        s.breath  = breath + 1;
        s.tMs     = now - runStart;
        s.phase   = inhale ? "inhale" : "exhale";
        s.fan     = leadIn ? "inhale" : "exhale";
        s.qTarget = q;
        s.duty    = duty;
        s.trim    = trim;
        s.rpm     = rpmM;
        s.rpmExp  = rpmExp;
        s.qTwin   = twinFlow(meas, rpmM) * (inhale ? 1 : -1);       // signed like the target
        s.valid   = rpmM >= meas.rpm[0] ? 1 : 0;
        s.fault   = fault;
      }
    }
    if (!running) {
      drive(IN, 0); drive(EX, 0);
      noSpin = 0; rpmExpPrev = 0;
      s.duty = 0;
    }
    s.running = running;

    // 4. Sample at 10 Hz. Never wait on a queue.
    if (step++ % LOG_EVERY == 0) {
      isoNowMs(s.ts, sizeof(s.ts));
      s.rpmIn = (int)readRpm(IN);
      s.rpmEx = (int)readRpm(EX);
      s.temp = envTemp; s.rh = envRh; s.pres = envPres;
      if (xQueueSend(sampleQ, &s, 0) != pdTRUE) droppedSamples++;
      if (running) xQueueSend(logQ, &s, 0);
    }
  }
}

// =================================================================
//  CORE 0. LOG TASK  (Serial CSV + BME280)
// =================================================================
// BME280, once a second. A sensor that browns out (e.g. when a fan starts) or loses its I2C
// link drops into sleep mode and keeps returning its last reading, or returns nonsense. So a
// reading outside physical limits, or a pressure identical for ENV_STUCK_READS reads in a row
// (a live sensor always varies in the last digits), is sent as null and the sensor is
// re-initialised. Not found at boot: retried every ENV_RETRY_MS.
const int      ENV_STUCK_READS = 5;
const uint32_t ENV_RETRY_MS    = 10000;

bool beginBme() { return bme.begin(0x76, &Wire) || bme.begin(0x77, &Wire); }

void readEnv() {
  static int stuck = 0;
  static float lastP = NAN;
  static uint32_t lastTry = 0;
  if (!bmeOk) {
    envTemp = envRh = envPres = NAN;
    if (millis() - lastTry < ENV_RETRY_MS) return;
    lastTry = millis();
    bmeOk = beginBme();
    if (bmeOk) Serial.println("# BME280 found");
    stuck = 0; lastP = NAN;
    return;
  }
  float t = bme.readTemperature();
  float h = bme.readHumidity();
  float p = bme.readPressure() / 100.0f;      // hPa
  bool sane = t > -20 && t < 80 && h >= 0 && h <= 100 && p > 800 && p < 1100;
  stuck = (p == lastP) ? stuck + 1 : 0;
  lastP = p;
  if (sane && stuck < ENV_STUCK_READS) {
    envTemp = t; envRh = h; envPres = p;
    return;
  }
  envTemp = envRh = envPres = NAN;              // sent as null, never a stale value
  Serial.printf("# BME280 %s (T=%.2f RH=%.1f P=%.2f), re-initialising\n", sane ? "stuck" : "out of range", t, h, p);
  bmeOk = beginBme();
  stuck = 0; lastP = NAN;
  if (!bmeOk) Serial.println("# BME280 NOT found, retrying every 10 s (check SDA 8, SCL 9, 3.3 V)");
}

void logTask(void*) {
  uint32_t lastEnv = 0;
  for (;;) {
    Sample s;
    if (xQueueReceive(logQ, &s, pdMS_TO_TICKS(200)) == pdTRUE) {
      Serial.printf("%s,%d,%lu,%s,%.2f,%.2f,%.2f,%.0f,%.0f,%.2f,%d,%d\n",
                    actName(s.act), s.breath, (unsigned long)s.tMs,
                    !strcmp(s.phase, "inhale") ? "in" : !strcmp(s.phase, "exhale") ? "ex" : s.phase,
                    s.qTarget, s.duty, s.trim, s.rpm, s.rpmExp, s.qTwin, s.valid, s.fault);
    }
    if (millis() - lastEnv >= 1000) {
      lastEnv = millis();
      readEnv();
    }
  }
}

// =================================================================
//  CORE 0. NETWORK TASK  (v4)
// =================================================================
int supabaseRequest(const char* method, const String& path, const String& body,
                    String& resp, const char* prefer = "return=minimal") {
  http.begin(tls, String(SUPABASE_URL) + "/rest/v1/" + path);
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Content-Type", "application/json");
  if (prefer) http.addHeader("Prefer", prefer);
  int code = http.sendRequest(method, body);

  if (code == 204)   resp = "";
  else if (code > 0) resp = http.getString();
  else               resp = http.errorToString(code);

  http.end();
  if (code >= 200 && code < 300) lastNetOkMs = millis();
  return code;
}

bool patchStatus(long id, const char* status) {
  char ts[32];
  isoNowMs(ts, sizeof(ts));
  String body = String("{\"status\":\"") + status + "\",\"acked_at\":\"" + ts + "\"}";
  String r;
  int code = supabaseRequest("PATCH", "commands?id=eq." + String(id), body, r);
  if (code < 200 || code >= 300) Serial.printf("# [net] cmd #%ld status '%s' -> HTTP %d %s\n",
                                               id, status, code, r.c_str());
  return code >= 200 && code < 300;
}

void putNum(JsonObject o, const char* key, float v, int decimals) {
  if (isnan(v)) { o[key] = nullptr; return; }
  float m = powf(10.0f, (float)decimals);
  o[key] = roundf(v * m) / m;
}

bool postTelemetry(Sample* batch, int n) {
  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  for (int i = 0; i < n; i++) {
    const Sample& b = batch[i];
    JsonObject o = arr.add<JsonObject>();
    o["device_id"]  = DEVICE_ID;
    o["sampled_at"] = b.ts;
    o["phase"]      = b.phase;
    putNum(o, "duty_cmd", b.duty, 1);
    o["rpm_inhale"] = b.rpmIn;
    o["rpm_exhale"] = b.rpmEx;
    putNum(o, "temp_c",       b.temp, 2);
    putNum(o, "rh_pct",       b.rh, 1);
    if (SEND_NEW_COLUMNS) {
      putNum(o, "pressure_hpa", b.pres, 2);
      if (b.fan) o["active_fan"] = b.fan; else o["active_fan"] = nullptr;
    }
    putNum(o, "q_target",     fabsf(b.qTarget), 2);   // magnitude; sign from phase
    putNum(o, "q_twin",       fabsf(b.qTwin), 2);
    putNum(o, "rpm_expected", b.rpmExp, 0);
    putNum(o, "trim",         b.trim, 2);
    if (b.valid < 0) o["twin_valid"] = nullptr; else o["twin_valid"] = b.valid == 1;
    if (b.fault < 0) o["fault"] = nullptr; else o["fault"] = b.fault;
  }
  String body, resp;
  serializeJson(doc, body);
  int code = supabaseRequest("POST", "telemetry", body, resp);
  if (code != 201) Serial.printf("# [net] %d rows -> HTTP %d queued=%d dropped=%lu %s\n",
                                 n, code, (int)uxQueueMessagesWaiting(sampleQ),
                                 (unsigned long)droppedSamples, resp.c_str());
  return code == 201;
}

int8_t presetIndex(const char* name) {
  for (int i = 0; i < N_ACT; i++) if (strcmp(name, ACTS[i].name) == 0) return i;
  return -2;
}

void pollCommands() {
  static long lastQueuedId = 0;

  String resp;
  String path = String("commands?device_id=eq.") + DEVICE_ID +
                "&status=eq.pending&id=gt." + String(lastQueuedId) +
                "&created_at=gt." + bootIso +
                "&order=id.asc&limit=5";
  int code = supabaseRequest("GET", path, "", resp, nullptr);
  if (code != 200) {
    Serial.printf("# [net] poll HTTP %d %s\n", code, resp.c_str());
    return;
  }

  JsonDocument doc;
  if (deserializeJson(doc, resp)) { Serial.println("# [net] poll bad JSON"); return; }

  for (JsonObject j : doc.as<JsonArray>()) {
    Command c = {};
    c.id = j["id"];
    strlcpy(c.name, j["command"] | "", sizeof(c.name));
    JsonVariant p = j["params"];
    c.breaths = p["breaths"] | -1;
    int8_t idx = presetIndex(p["preset"] | "");
    if (strcmp(p["mode"] | "", "free") == 0) {
      c.act  = ACT_FREE;
      c.fanEx = strcmp(p["fan"] | "inhale", "exhale") == 0;
      c.duty = p["duty"].isNull() ? -1.0f : (p["duty"] | -1.0f);   // missing -> rejected as 'error'
    } else if (idx >= 0) {
      c.act = idx;
    } else if (!p["vt"].isNull() || !p["bpm"].isNull()) {
      c.act = ACT_CUSTOM;                       // missing half -> 0 -> rejected as 'error'
      c.vt  = p["vt"]  | 0.0f;
      c.bpm = p["bpm"] | 0.0f;
    } else {
      c.act = 0;                                // default: demo_15
    }

    // v4 FIX 7. A delayed 'start' never spins the fans up; a late 'stop' still runs.
    long age = (long)(time(nullptr) - parseIsoUtc(j["created_at"] | ""));
    if (strcmp(c.name, "start") == 0 && age > COMMAND_TTL_S) {
      if (!patchStatus(c.id, "expired")) break;
      lastQueuedId = c.id;
      Serial.printf("# [net] cmd #%ld 'start' EXPIRED (%ld s old), not executed\n", c.id, age);
      continue;
    }

    if (xQueueSend(cmdQ, &c, 0) != pdTRUE) break;
    lastQueuedId = c.id;
    Serial.printf("# [net] cmd #%ld '%s' received (%ld s old)\n", c.id, c.name, age);
  }
}

void sendAcks() {
  Ack a;
  while (xQueuePeek(ackQ, &a, 0) == pdTRUE) {
    if (!patchStatus(a.id, a.ok ? "done" : "error")) return;
    xQueueReceive(ackQ, &a, 0);
    Serial.printf("# [net] cmd #%ld %s (running=%d %s Vt=%.3f L f=%.1f /min peak=%.1f L/min)\n",
                  a.id, a.ok ? "executed" : "REJECTED", a.running, actName(a.act), a.vt, a.bpm, a.qPeak);
    if (a.ok && a.running && a.act == ACT_FREE)
      Serial.printf("# free flow: %s fan at %.0f %% duty until stop\n", a.fanEx ? "exhale" : "inhale", a.duty);
    else if (a.ok && a.running) {
      if (a.qPeak > EX_Q[N_CAL - 1])
        Serial.printf("# WARNING: peak above exhale capacity (%.1f L/min), exhale peaks will clip (fault 3)\n", EX_Q[N_CAL - 1]);
      if (a.qPeak > IN_Q[N_CAL - 1])
        Serial.printf("# WARNING: peak above inhale capacity (%.1f L/min)\n", IN_Q[N_CAL - 1]);
    }
  }
}

void sendHeartbeat() {
  char ts[32];
  isoNowMs(ts, sizeof(ts));
  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["last_seen"] = ts;
  doc["firmware"]  = FW_VERSION;
  doc["wifi_rssi"] = WiFi.RSSI();
  String body, resp;
  serializeJson(doc, body);
  supabaseRequest("POST", "device_status", body, resp,
                  "resolution=merge-duplicates,return=minimal");
}

void netTask(void*) {
  static Sample batch[MAX_BATCH];
  int n = 0;
  uint32_t lastPost = 0, lastPoll = 0, lastBeat = 0, lastReconnectMs = 0;
  bool wasConnected = true;

  for (;;) {
    if (failsafeTripped) {
      failsafeTripped = false;
      Serial.println("# [control] FAILSAFE. network stale, fans stopped");
    }

    if (WiFi.status() != WL_CONNECTED) {
      if (wasConnected) { Serial.println("# [net] WiFi lost"); wasConnected = false; }
      if (millis() - lastReconnectMs > RECONNECT_MS) {
        lastReconnectMs = millis();
        Serial.println("# [net] WiFi reconnecting");
        WiFi.disconnect();
        WiFi.begin(WIFI_SSID, WIFI_PASS);
      }
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }
    if (!wasConnected) { Serial.println("# [net] WiFi back"); wasConnected = true; }

    Sample s;
    while (n < MAX_BATCH && xQueueReceive(sampleQ, &s, 0) == pdTRUE) batch[n++] = s;

    uint32_t now = millis();
    if (n > 0 && now - lastPost >= POST_PERIOD_MS) {
      lastPost = now;
      if (postTelemetry(batch, n) || n == MAX_BATCH) n = 0;
    }
    if (now - lastPoll >= POLL_PERIOD_MS) { lastPoll = now; pollCommands(); }
    sendAcks();
    if (now - lastBeat >= BEAT_PERIOD_MS) { lastBeat = now; sendHeartbeat(); }

    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// =================================================================
void setup() {
  // Both fans stopped before anything else: a floating EN or PWM pin makes a fan run.
  pinMode(EN_IN, OUTPUT_OPEN_DRAIN); digitalWrite(EN_IN, LOW);
  pinMode(EN_EX, OUTPUT_OPEN_DRAIN); digitalWrite(EN_EX, LOW);
  ledcAttach(PWM_IN, PWM_FREQ, PWM_RES);
  ledcAttach(PWM_EX, PWM_FREQ, PWM_RES);
  drive(IN, 0); drive(EX, 0);
  pinMode(TACH_IN, INPUT_PULLUP); pinMode(TACH_EX, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(TACH_IN), isrIn, FALLING);
  attachInterrupt(digitalPinToInterrupt(TACH_EX), isrEx, FALLING);

  Serial.begin(115200);
  delay(1000);
  Serial.printf("\n# %s booting\n", FW_VERSION);

  Wire.begin(I2C_SDA, I2C_SCL);
  bmeOk = beginBme();
  Serial.printf("# BME280 %s\n", bmeOk ? "found" : "NOT found (temp/rh/pressure sent as null)");

  // v4 FIX 12. Nothing runs until network + time are up (fans stay stopped meanwhile)
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    if (millis() - t0 > RECONNECT_MS) {
      Serial.println("# [boot] WiFi retry");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASS);
      t0 = millis();
    }
  }
  Serial.println("# WiFi OK");

  configTime(0, 0, "pool.ntp.org", "time.google.com");
  setenv("TZ", "UTC0", 1);                            // v4 FIX 11
  tzset();
  while (time(nullptr) < 1700000000) delay(250);
  isoNowMs(bootIso, sizeof(bootIso));
  Serial.printf("# NTP OK. boot %s\n", bootIso);

  tls.setInsecure();       // TEST ONLY: no certificate check
  http.setReuse(true);

  sampleQ = xQueueCreate(QUEUE_DEPTH, sizeof(Sample));
  logQ    = xQueueCreate(20, sizeof(Sample));
  cmdQ    = xQueueCreate(10, sizeof(Command));
  ackQ    = xQueueCreate(10, sizeof(Ack));
  lastNetOkMs = millis();  // grace period at boot

  Serial.println("act,breath,t_ms,phase,Q_target,duty,trim,rpm,rpm_exp,Q_twin,valid,fault");

  //                      function     name       stack  arg      prio handle   core
  xTaskCreatePinnedToCore(netTask,     "net",     12288, nullptr, 1,   nullptr, 0);
  xTaskCreatePinnedToCore(logTask,     "log",      4096, nullptr, 1,   nullptr, 0);
  xTaskCreatePinnedToCore(controlTask, "control",  6144, nullptr, 3,   nullptr, 1);
}

void loop() {
  vTaskDelete(NULL);
}
