// Tier C — control-flow shapes and timing calls with no corpus representation.
//
// do-while, continue, break in a loop body, a return with a value, plus
// delayMicroseconds, micros, pulseIn and shiftOut.

const int TRIG_PIN = 7;
const int DATA_PIN = 11;
const int CLOCK_PIN = 12;
const int LATCH_PIN = 8;

unsigned long lastMicros = 0;
int attempts = 0;

int settle(int pin) {
  int reading = 0;
  int tries = 0;
  do {
    reading = analogRead(pin);
    tries++;
    delayMicroseconds(50);
  } while (reading < 10 && tries < 5);
  return reading;
}

void setup() {
  Serial.begin(9600);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(DATA_PIN, OUTPUT);
  pinMode(CLOCK_PIN, OUTPUT);
  pinMode(LATCH_PIN, OUTPUT);
}

void loop() {
  lastMicros = micros();

  for (int i = 0; i < 8; i++) {
    if (i % 2 == 0) {
      continue;
    }
    if (i > 5) {
      break;
    }
    digitalWrite(LATCH_PIN, LOW);
    shiftOut(DATA_PIN, CLOCK_PIN, MSBFIRST, i);
    digitalWrite(LATCH_PIN, HIGH);
  }

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long width = pulseIn(TRIG_PIN, HIGH, 20000);

  attempts = settle(A0);

  Serial.print(micros() - lastMicros);
  Serial.print(width);
  Serial.println(attempts);
  delay(100);
}
