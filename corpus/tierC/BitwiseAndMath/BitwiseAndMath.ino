// Tier C — the bitwise and math families.
//
// Added after a corpus-coverage audit found 86 of 151 nodes unexercised
// end-to-end. A bitwise codegen bug shipped and reached arduino-cli because no
// corpus sketch produced a Bitwise And node; the gate was sound, the corpus was
// not.

const int SENSOR_PIN = A0;
byte flags = 0b0011;
int mask = 0x1A;
long total = 0;
float angle = 0.0;

void setup() {
  Serial.begin(9600);
  randomSeed(analogRead(A1));
}

void loop() {
  int raw = analogRead(SENSOR_PIN);

  // Bitwise family.
  int high = raw & 0xFF00;
  int low = raw | 0x000F;
  int flipped = raw ^ mask;
  int inverted = ~raw;
  int up = raw << 2;
  int down = raw >> 3;
  byte bit = bitRead(flags, 1);
  bitSet(flags, 2);
  bitClear(flags, 0);
  bitWrite(flags, 3, bit);

  // Remainder and the 16-bit overflow case a long is needed for.
  int remainder = raw % 7;
  total = (long)raw * raw;

  // Math functions.
  float root = sqrt((float)raw);
  float powered = pow(2.0, 3.0);
  int rounded = round(root);
  int floored = floor(root);
  int ceiled = ceil(root);
  angle = sin(root) + cos(root) + tan(root);

  int smallest = min(raw, 512);
  int largest = max(raw, 128);
  int magnitude = abs(raw - 512);
  int bounded = constrain(raw, 0, 1023);
  int scaled = map(raw, 0, 1023, 0, 255);
  int dice = random(1, 7);

  Serial.print(high);
  Serial.print(low);
  Serial.print(flipped);
  Serial.print(inverted);
  Serial.print(up);
  Serial.print(down);
  Serial.print(remainder);
  Serial.print(total);
  Serial.print(powered);
  Serial.print(rounded);
  Serial.print(floored);
  Serial.print(ceiled);
  Serial.print(angle);
  Serial.print(smallest);
  Serial.print(largest);
  Serial.print(magnitude);
  Serial.print(bounded);
  Serial.print(scaled);
  Serial.println(dice);
  delay(200);
}
