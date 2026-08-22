// Tier C — reading from Serial.
//
// The serial *input* nodes had no corpus representation at all; every existing
// sketch only prints.

String command = "";
int value = 0;
float ratio = 0.0;

void setup() {
  Serial.begin(9600);
  Serial.flush();
}

void loop() {
  if (Serial.available() > 0) {
    int first = Serial.read();

    if (first == 'n') {
      value = Serial.parseInt();
      Serial.print("int ");
      Serial.println(value);
    } else if (first == 'f') {
      ratio = Serial.parseFloat();
      Serial.print("float ");
      Serial.println(ratio);
    } else {
      command = Serial.readStringUntil('\n');
      Serial.print("text ");
      Serial.println(command);
    }
    Serial.flush();
  }
}
