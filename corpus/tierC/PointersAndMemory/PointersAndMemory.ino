// Tier C — pointers, references, new/delete.
// Register: all of this is expected to land in Raw nodes. What must not happen
// is the import failing, or a single line going missing.

int readings[8];
int *cursor = readings;
int total = 0;

void accumulate(int &sink, int value) {
  sink += value;
}

int *allocateBuffer(int size) {
  int *buffer = new int[size];
  for (int i = 0; i < size; i++) {
    buffer[i] = 0;
  }
  return buffer;
}

void setup() {
  Serial.begin(9600);

  int *scratch = allocateBuffer(4);
  scratch[0] = analogRead(A0);
  Serial.println(*scratch);
  delete[] scratch;

  cursor = &readings[0];
  *cursor = 42;
  accumulate(total, *cursor);
}

void loop() {
  int value = analogRead(A0);
  *cursor = value;
  cursor++;
  if (cursor >= readings + 8) {
    cursor = readings;
  }

  int *walker = readings;
  int sum = 0;
  while (walker < readings + 8) {
    sum += *walker;
    walker++;
  }

  Serial.println(sum / 8);
  delay(100);
}
