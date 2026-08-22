// Tier C — function overloads, default arguments, static locals, recursion.
// Register: overloads and default arguments are Raw Global; static locals are a
// Declare Variable with static scope; recursion is a plain Function Define — a
// call cycle in the call graph is not a cycle in the exec graph.

int blend(int a, int b) {
  return (a + b) / 2;
}

float blend(float a, float b) {
  return (a + b) / 2.0;
}

int ramp(int value, int step = 5) {
  return value + step;
}

int factorial(int n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

int nextTick() {
  static int counter = 0;
  static unsigned long lastCall = 0;
  counter++;
  lastCall = millis();
  return counter;
}

void setup() {
  Serial.begin(9600);
  Serial.println(blend(10, 20));
  // The f suffix is load-bearing: bare 1.5 is a double, and double -> int and
  // double -> float are equally ranked conversions, so the call is ambiguous.
  Serial.println(blend(1.5f, 2.5f));
  Serial.println(ramp(100));
  Serial.println(ramp(100, 25));
  Serial.println(factorial(5));
}

void loop() {
  int tick = nextTick();
  if (tick % 10 == 0) {
    Serial.print("tick ");
    Serial.println(tick);
  }
  delay(100);
}
