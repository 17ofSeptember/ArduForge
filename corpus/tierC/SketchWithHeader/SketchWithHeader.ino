// Tier C — a sketch with a .h/.cpp pair beside it.
// Register: out of scope for v1. Detect, warn clearly, import the .ino only.
// The companions still have to travel with the sketch for it to compile, which
// is why the harness passes them through to arduino-cli even though the
// importer will not read them.

#include "sensor.h"

Sensor probe(A0);
unsigned long lastRead = 0;

void setup() {
  Serial.begin(9600);
  probe.begin();
}

void loop() {
  if (millis() - lastRead >= 500) {
    lastRead = millis();
    int value = probe.read();
    Serial.print("sensor: ");
    Serial.println(value);
  }
}
