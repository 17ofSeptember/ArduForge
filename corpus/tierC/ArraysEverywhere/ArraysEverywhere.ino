// Tier C — arrays: declaration, subscript, sizeof, and a 2D array.
// Register: array nodes where the set covers it, Raw otherwise. The 2D array is
// explicitly Raw.

int ledPins[] = {2, 3, 4, 5, 6};
const int pinCount = sizeof(ledPins) / sizeof(ledPins[0]);

byte pattern[3][4] = {
  {1, 0, 1, 0},
  {0, 1, 0, 1},
  {1, 1, 0, 0}
};

int samples[10];
int index = 0;

void setup() {
  Serial.begin(9600);
  for (int i = 0; i < pinCount; i++) {
    pinMode(ledPins[i], OUTPUT);
  }
  for (int i = 0; i < 10; i++) {
    samples[i] = 0;
  }
}

void loop() {
  samples[index] = analogRead(A0);
  index = (index + 1) % 10;

  long total = 0;
  for (int i = 0; i < 10; i++) {
    total += samples[i];
  }
  int average = total / 10;

  for (int row = 0; row < 3; row++) {
    for (int col = 0; col < 4; col++) {
      if (pattern[row][col] == 1 && col < pinCount) {
        digitalWrite(ledPins[col], average > 512 ? HIGH : LOW);
      }
    }
  }

  Serial.print("avg ");
  Serial.println(average);
  delay(50);
}
