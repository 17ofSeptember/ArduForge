// ShiftOut — 74HC595 shift register, one byte at a time.
//
// Transcribed for the ArduForge import corpus: Arduino IDE 2.x no longer
// bundles this example, but it is still one of the most-pasted sketches for
// anyone driving more outputs than the board has pins.

int latchPin = 8;
int clockPin = 12;
int dataPin = 11;

void setup() {
  pinMode(latchPin, OUTPUT);
  pinMode(clockPin, OUTPUT);
  pinMode(dataPin, OUTPUT);
}

void loop() {
  for (int numberToDisplay = 0; numberToDisplay < 256; numberToDisplay++) {
    digitalWrite(latchPin, LOW);
    shiftOut(dataPin, clockPin, MSBFIRST, numberToDisplay);
    digitalWrite(latchPin, HIGH);
    delay(500);
  }
}
