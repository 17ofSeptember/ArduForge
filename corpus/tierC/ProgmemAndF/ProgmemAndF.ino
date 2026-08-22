// Tier C — PROGMEM and F().
// Register: preserved verbatim, never rewritten. Rewriting F("x") to "x" would
// compile and would quietly cost the user 40 bytes of RAM per string, which is
// exactly the kind of "helpful" change the importer must never make.

const char banner[] PROGMEM = "ArduForge import corpus";
const int scale[] PROGMEM = {1, 2, 4, 8, 16, 32, 64, 128};

char buffer[32];

void setup() {
  Serial.begin(9600);
  Serial.println(F("Booting..."));

  strcpy_P(buffer, banner);
  Serial.println(buffer);

  for (byte i = 0; i < 8; i++) {
    Serial.print(F("scale "));
    Serial.print(i);
    Serial.print(F(" = "));
    Serial.println(pgm_read_word(&scale[i]));
  }
}

void loop() {
  int value = analogRead(A0);
  Serial.print(F("reading: "));
  Serial.println(value);
  delay(1000);
}
