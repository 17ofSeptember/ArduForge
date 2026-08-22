// Tier C — the String family.
//
// String on AVR is real but expensive, and none of these nodes appeared in the
// corpus. Included so a codegen change to text handling cannot pass unnoticed.

String label = "sensor";
String message = "";
int parsed = 0;
float parsedFloat = 0.0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int raw = analogRead(A0);

  message = label + String(":") + String(raw);
  int length = message.length();
  String head = message.substring(0, 6);
  int colon = message.indexOf(':');

  parsed = message.substring(colon + 1).toInt();
  parsedFloat = String("1.5").toFloat();

  if (head.compareTo(label) == 0) {
    Serial.println(message);
  }

  Serial.print(length);
  Serial.print(parsed);
  Serial.println(parsedFloat);
  delay(500);
}
