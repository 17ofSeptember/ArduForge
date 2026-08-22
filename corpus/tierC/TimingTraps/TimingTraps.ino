// Tier C — timing patterns, including the two the importer must NOT clean up.
//
// Register / §4.2:
//   - `millis() - last >= interval` is the safe form and lifts to Every N ms.
//   - `millis() >= last + interval` is rollover-unsafe. It must import as-is
//     and raise a warning. Lifting it into a node that emits the safe form
//     would fix a 49.7-day bug without telling anyone, which is a behaviour
//     change disguised as a favour.
//   - analogRead(A0) called twice in one expression is a candidate
//     SEMANTIC-DIVERGENCE: codegen's hoisting rule may collapse it, and the
//     original was the buggy one.

unsigned long previousMillis = 0;
unsigned long unsafeLast = 0;
unsigned long accumulator = 0;

const long interval = 500;
int ledState = LOW;

void setup() {
  Serial.begin(9600);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  unsigned long currentMillis = millis();

  // Safe: the canonical BlinkWithoutDelay shape.
  if (currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis;
    ledState = (ledState == LOW) ? HIGH : LOW;
    digitalWrite(LED_BUILTIN, ledState);
  }

  // Rollover-unsafe. Import as written, warn, do not repair.
  if (millis() >= unsafeLast + 1000) {
    unsafeLast = millis();
    Serial.println("tick");
  }

  // Drift-free variant: accumulate instead of resampling.
  if (millis() - accumulator >= 250) {
    accumulator += 250;
    Serial.println(analogRead(A0));
  }

  // Two impure reads in one expression. Do not deduplicate.
  int jitter = analogRead(A0) - analogRead(A0);
  if (jitter > 8) {
    Serial.print("jitter ");
    Serial.println(jitter);
  }
}
