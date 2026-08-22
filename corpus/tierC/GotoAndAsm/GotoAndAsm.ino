// Tier C — goto, labels, and inline assembly.
// Register: goto and labels are Raw; inline asm is a Raw Global and is never
// touched. There is no graph shape that represents a jump into the middle of a
// chain, and inventing one would be a lie about the source.

int attempts = 0;

void nopDelay() {
  asm volatile(
    "nop\n\t"
    "nop\n\t"
    "nop\n\t"
  );
}

void setup() {
  Serial.begin(9600);
  pinMode(13, OUTPUT);
}

void loop() {
  attempts = 0;

retry:
  attempts++;
  int reading = analogRead(A0);

  if (reading < 100 && attempts < 5) {
    delay(10);
    goto retry;
  }

  if (attempts >= 5) {
    goto giveUp;
  }

  digitalWrite(13, HIGH);
  nopDelay();
  digitalWrite(13, LOW);
  Serial.println(reading);
  return;

giveUp:
  Serial.println("no signal");
  delay(500);
}
