// =====================================================================
// ESP4902 – fan wiring check. One fan, fixed duty, rpm printed twice a second.
// Nothing else: no runs, no WiFi, no Python. Use it when a fan won't spin.
//
// Serial Monitor at 115200, line ending "Newline". Type a duty 0..100 and press Enter
// (e.g. 50). Starts at 0 % (fan off). Type 0 to stop.
//
// What to expect (15 V, free delivery): 50 % -> ~8,500-9,000 rpm, clearly audible.
//   rpm > 0 and audible  : wiring and code fine.
//   audible but rpm = 0  : PWM and power fine; tach wire / pull-up / TACH_PIN wrong.
//   silent and rpm = 0   : PWM signal, ground or 15 V supply problem.
// =====================================================================

const int PWM_PIN  = 18;    // >>> the pin the fan's PWM wire (grey) is on
const int TACH_PIN = 5;     // >>> the pin the fan's tach wire (white) is on

const uint32_t PWM_FREQ = 25000;
const uint8_t  PWM_BITS = 10;
const uint32_t TACH_GLITCH_US = 800;

volatile uint32_t edges = 0, lastUs = 0;
void IRAM_ATTR onTach() {
  uint32_t now = micros();
  if (now - lastUs >= TACH_GLITCH_US) { lastUs = now; edges = edges + 1; }
}

float duty = 0;

void setDuty(float pct) {
  duty = constrain(pct, 0.0f, 100.0f);
  uint32_t raw = (uint32_t)(duty / 100.0f * ((1u << PWM_BITS) - 1) + 0.5f);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(PWM_PIN, raw);
#else
  ledcWrite(0, raw);
#endif
}

void setup() {
  Serial.begin(115200);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(PWM_PIN, PWM_FREQ, PWM_BITS);
#else
  ledcSetup(0, PWM_FREQ, PWM_BITS); ledcAttachPin(PWM_PIN, 0);
#endif
  setDuty(0);
  pinMode(TACH_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(TACH_PIN), onTach, FALLING);
  delay(300);
  Serial.printf("# fan_check: PWM on GPIO %d, tach on GPIO %d. Type a duty 0-100 and press Enter.\n", PWM_PIN, TACH_PIN);
}

void loop() {
  static String in;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (in.length()) { setDuty(in.toFloat()); Serial.printf("# duty set to %.0f %%\n", duty); }
      in = "";
    } else in += c;
  }
  static uint32_t last = 0, lastEdges = 0;
  uint32_t now = millis();
  if (now - last >= 500) {
    noInterrupts(); uint32_t e = edges; interrupts();
    float rpm = (e - lastEdges) * 60000.0f / (now - last);   // 1 pulse per rev
    Serial.printf("duty %5.1f %%   rpm %6.0f   tach pin reads %s\n", duty, rpm, digitalRead(TACH_PIN) ? "HIGH" : "LOW");
    lastEdges = e; last = now;
  }
}
