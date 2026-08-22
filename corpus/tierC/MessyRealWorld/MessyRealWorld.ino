// Tier C — what a real forum sketch actually looks like.
//
// Nothing exotic here; it is just written the way people write. Inconsistent
// bracing, a switch that is nearly a state machine but assigns to its own
// selector from two places, magic numbers, dead code, a commented-out line
// someone will want back, and precedence-sensitive expressions with no
// parentheses. This is the tier's real target: the importer must produce a
// valid, compiling graph and lose nothing, however ugly the input.

#include <Arduino.h>

int   sensorPin=A0;
int ledPin  =   9;
int buttonPin = 2;
int state = 0;
int lastButton=HIGH;
long lastDebounceTime = 0;
long debounceDelay=50;
float smoothed = 0.0;
int   raw;

void setup(){
  Serial.begin(115200);
  pinMode(ledPin,OUTPUT); pinMode(buttonPin,INPUT_PULLUP);
  // Serial.println("debug on");
  smoothed=analogRead(sensorPin);
}

void loop()
{
  int reading = digitalRead(buttonPin);
  if(reading!=lastButton){ lastDebounceTime=millis(); }
  if((millis()-lastDebounceTime)>debounceDelay){
    if(reading==LOW&&lastButton==HIGH){
      state=state+1;
      if(state>2)state=0;
    }
  }
  lastButton=reading;

  raw=analogRead(sensorPin);
  smoothed = smoothed*0.9 + raw*0.1;

  int level = raw >> 2 & 0xFF;
  int biased = raw + 3 * 2 - 1;
  int shifted = raw << 1 + 2;

  switch(state){
    case 0:
      analogWrite(ledPin,0);
      break;
    case 1:
      analogWrite(ledPin,level);
      break;
    case 2: {
      analogWrite(ledPin, 255-level);
      if(smoothed>900){ state=0; }
      break;
    }
    default:
      state=0;
  }

  if(millis()%1000<10){
    Serial.print(raw);Serial.print(",");Serial.print(smoothed);
    Serial.print(",");Serial.print(biased);Serial.print(",");Serial.println(shifted);
  }
}
