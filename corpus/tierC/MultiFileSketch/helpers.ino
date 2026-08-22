// Second tab. Arduino appends this after MultiFileSketch.ino.

const char *MODE_NAMES[] = {"off", "slow", "fast"};

const char *describeMode(int value) {
  if (value < 0 || value > 2) return "unknown";
  return MODE_NAMES[value];
}

int nextMode(int value) {
  return (value + 1) % 3;
}

void applyMode(int value) {
  switch (value) {
    case 0:
      digitalWrite(LED_BUILTIN, LOW);
      break;
    case 1:
      analogWrite(LED_BUILTIN, 64);
      break;
    case 2:
      analogWrite(LED_BUILTIN, 255);
      break;
    default:
      digitalWrite(LED_BUILTIN, LOW);
      break;
  }
}
