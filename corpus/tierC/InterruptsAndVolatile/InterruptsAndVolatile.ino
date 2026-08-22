// Tier C — volatile, attachInterrupt, and an ISR.
// Register: On Interrupt node plus Raw for the body if unmappable. `volatile`
// must survive: dropping it lets the optimizer cache the counter in a register
// and the sketch silently stops counting.

volatile unsigned long pulseCount = 0;
volatile bool flagged = false;

const byte interruptPin = 2;
unsigned long lastReport = 0;

void countPulse() {
  pulseCount++;
  flagged = true;
}

void setup() {
  Serial.begin(9600);
  pinMode(interruptPin, INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT);
  attachInterrupt(digitalPinToInterrupt(interruptPin), countPulse, FALLING);
}

void loop() {
  if (flagged) {
    noInterrupts();
    unsigned long snapshot = pulseCount;
    flagged = false;
    interrupts();

    digitalWrite(LED_BUILTIN, snapshot % 2 == 0 ? HIGH : LOW);
  }

  if (millis() - lastReport >= 1000) {
    lastReport = millis();
    Serial.print("pulses: ");
    Serial.println(pulseCount);
  }
}
