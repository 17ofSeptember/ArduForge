// Tier C — struct, class, enum, typedef, template.
// Register: every one of these is a Raw Global. The interesting part is that
// setup() and loop() around them must still lower to native nodes.

typedef unsigned int millis_t;

enum Mode { IDLE, RUNNING, FAULT };

struct Reading {
  int raw;
  float scaled;
};

class Sensor {
  public:
    Sensor(int pin) : _pin(pin) {}
    int read() { return analogRead(_pin); }
  private:
    int _pin;
};

template <typename T>
T clampTo(T value, T low, T high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

Sensor light(A0);
Mode mode = IDLE;
Reading last = {0, 0.0};

void setup() {
  Serial.begin(9600);
  pinMode(13, OUTPUT);
  mode = RUNNING;
}

void loop() {
  last.raw = light.read();
  last.scaled = last.raw * (5.0 / 1023.0);

  int bounded = clampTo<int>(last.raw, 100, 900);

  if (mode == RUNNING) {
    digitalWrite(13, bounded > 500 ? HIGH : LOW);
  } else if (mode == FAULT) {
    digitalWrite(13, LOW);
  }

  Serial.println(last.scaled);
  delay(200);
}
