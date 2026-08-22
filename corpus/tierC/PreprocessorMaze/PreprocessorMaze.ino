// Tier C — the preprocessor.
// Register: object-like #defines of a literal become a Declare Variable flagged
// emitAsDefine. Function-like macros are Raw Global. #ifdef/#if blocks are one
// Raw Global each, directives included, and are never evaluated — the importer
// cannot know the build configuration, and guessing produces a sketch that
// behaves differently on someone else's board.

#define LED_PIN 13
#define SENSOR_PIN A0
#define THRESHOLD 512
#define VERSION "1.2.0"
#define DEBUG 1

#define SQUARE(x) ((x) * (x))
#define CLAMP(v, lo, hi) ((v) < (lo) ? (lo) : ((v) > (hi) ? (hi) : (v)))

#if DEBUG
  #define LOG(msg) Serial.println(msg)
#else
  #define LOG(msg)
#endif

#ifdef __AVR_ATmega328P__
  const int maxSamples = 16;
#else
  const int maxSamples = 64;
#endif

#ifndef BAUD_RATE
  #define BAUD_RATE 9600
#endif

int sampleCount = 0;

void setup() {
  Serial.begin(BAUD_RATE);
  pinMode(LED_PIN, OUTPUT);
  LOG(F("ready"));
  LOG(VERSION);
}

void loop() {
  int reading = analogRead(SENSOR_PIN);
  int bounded = CLAMP(reading, 0, THRESHOLD);
  long energy = SQUARE((long)bounded / 8);

  if (bounded > THRESHOLD / 2) {
    digitalWrite(LED_PIN, HIGH);
  } else {
    digitalWrite(LED_PIN, LOW);
  }

  sampleCount++;
  if (sampleCount >= maxSamples) {
    sampleCount = 0;
    LOG(energy);
  }

  delay(25);
}
