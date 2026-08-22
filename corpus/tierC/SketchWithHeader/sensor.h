#ifndef SENSOR_H
#define SENSOR_H

#include <Arduino.h>

class Sensor {
  public:
    Sensor(uint8_t pin);
    void begin();
    int read();

  private:
    uint8_t _pin;
    int _last;
};

#endif
