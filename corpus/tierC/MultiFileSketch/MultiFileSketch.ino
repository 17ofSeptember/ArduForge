// Tier C — a sketch split across two .ino files.
// Register: concatenated per Arduino's rules (folder-matching file first, then
// the rest alphabetically), with frames labelled by source file. Note that
// setup() calls describeMode() before it is defined anywhere in the concatenated
// buffer — that only works because Arduino auto-generates prototypes, which is
// why the importer has to replicate that step rather than assume C++ ordering.

int mode = 0;
unsigned long lastSwitch = 0;

void setup() {
  Serial.begin(9600);
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.println(describeMode(mode));
  applyMode(mode);
}

void loop() {
  if (millis() - lastSwitch >= 2000) {
    lastSwitch = millis();
    mode = nextMode(mode);
    Serial.println(describeMode(mode));
    applyMode(mode);
  }
}
