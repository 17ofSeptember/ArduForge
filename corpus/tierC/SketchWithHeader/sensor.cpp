#include "sensor.h"

Sensor::Sensor(uint8_t pin) : _pin(pin), _last(0) {}

void Sensor::begin() {
  pinMode(_pin, INPUT);
}

int Sensor::read() {
  _last = (_last + analogRead(_pin)) / 2;
  return _last;
}
