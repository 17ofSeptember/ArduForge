# Node reference

_Generated from the node registry — run `npm run docs --workspace client` after adding nodes._

ArduForge ships **149 nodes** across 10 categories.

## Contents

- [Events](#events) — 5 nodes
- [I/O](#i-o) — 10 nodes
- [Control Flow](#control-flow) — 14 nodes
- [Math](#math) — 22 nodes
- [Logic](#logic) — 16 nodes
- [Variables](#variables) — 18 nodes
- [Time](#time) — 5 nodes
- [Serial](#serial) — 10 nodes
- [Components](#components) — 46 nodes
- [Custom C++](#custom-c-) — 3 nodes

## Events

### Call Function

Runs a function you defined with Define Function.

`event.callFunction` · kind: statement · has execution input · execution outputs: then

| Setting | Default |
|---|---|
| Name | myFunction |
| Arguments |  |

### Define Function

Defines a reusable function. Call it with the Call Function node.

`event.function` · kind: entry · execution outputs: body

| Setting | Default |
|---|---|
| Name | myFunction |
| Returns | void |
| Parameters |  |

### On Interrupt

Runs the moment a pin changes, interrupting whatever else is happening.

`event.interrupt` · kind: entry · execution outputs: then

| Setting | Default |
|---|---|
| Pin | 2 |
| Trigger on | RISING |

### On Loop

Runs over and over, forever, after setup finishes.

`event.loop` · kind: entry · execution outputs: then

### On Setup

Runs once when the board powers on or resets.

`event.setup` · kind: entry · execution outputs: then

## I/O

### Analog Read

Reads an analog pin as a number from 0 to 1023.

`io.analogRead` · kind: expression

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | A0 |

| Output | Type |
|---|---|
| Value | `int` |

### Analog Reference

Chooses the voltage that analog readings are measured against.

`io.analogReference` · kind: statement · has execution input · execution outputs: then

| Setting | Default |
|---|---|
| Reference | DEFAULT |

### Analog Write (PWM)

Writes a 0-255 PWM duty cycle. Only works on PWM-capable pins.

`io.analogWrite` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 9 |
| Duty | `int` | 128 |

### Digital Read

Reads whether a pin is HIGH or LOW.

`io.digitalRead` · kind: expression

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 2 |

| Output | Type |
|---|---|
| Is High | `bool` |

### Digital Write

Drives a pin fully HIGH (5V) or LOW (0V).

`io.digitalWrite` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 13 |
| Value | `bool` | true |

### No Tone

Stops a tone that is playing on a pin.

`io.noTone` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 8 |

### Pin Mode

Configures a pin as an input or an output.

`io.pinMode` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 13 |

| Setting | Default |
|---|---|
| Mode | OUTPUT |

### Pulse In

Measures how long a pulse lasts, in microseconds. Blocking.

`io.pulseIn` · kind: expression

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 7 |
| Level | `bool` | true |
| Timeout µs | `int` | 1000000 |

| Output | Type |
|---|---|
| Length µs | `int` |

### Shift Out

Clocks a byte out one bit at a time, for shift registers.

`io.shiftOut` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Data pin | `pin` | 11 |
| Clock pin | `pin` | 12 |
| Byte | `int` | 0 |

| Setting | Default |
|---|---|
| Bit order | MSBFIRST |

### Tone

Plays a square-wave tone on a pin. Good enough for a buzzer.

`io.tone` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 8 |
| Hz | `int` | 440 |
| ms (0 = hold) | `int` | 0 |

## Control Flow

### Break

Leaves the surrounding loop immediately.

`control.break` · kind: statement · has execution input

### Continue

Skips to the next pass of the surrounding loop.

`control.continue` · kind: statement · has execution input

### Debounce

Passes a signal through only after it has been stable for a while.

`control.debounce` · kind: expression

| Input | Type | Default |
|---|---|---|
| Signal | `bool` | false |
| Settle (ms) | `int` | 50 |

| Output | Type |
|---|---|
| Stable | `bool` |

### Delay

Stops everything for a number of milliseconds. Blocking.

`control.delay` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Milliseconds | `int` | 500 |

### Delay Microseconds

Stops everything for a number of microseconds. Blocking.

`control.delayMicroseconds` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Microseconds | `int` | 100 |

### Do-While

Runs a chain once, then repeats it while a condition holds.

`control.doWhile` · kind: statement · has execution input · execution outputs: body, done

| Input | Type | Default |
|---|---|---|
| While | `bool` | true |

### Every N Milliseconds

Runs a chain on a repeating interval without blocking the rest of the program.

`control.everyMs` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Interval | `int` | 500 |

### For (count)

Repeats a chain a fixed number of times.

`control.for` · kind: statement · has execution input · execution outputs: body, done

| Input | Type | Default |
|---|---|---|
| Count | `int` | 10 |

| Output | Type |
|---|---|
| Index | `int` |

### Go To State

Moves a state machine into a different state.

`control.goToState` · kind: statement · has execution input · execution outputs: then

| Setting | Default |
|---|---|
| Machine name | mode |
| State | Idle |

### If / Else

Runs one branch or the other depending on a condition.

`control.if` · kind: statement · has execution input · execution outputs: true, false

| Input | Type | Default |
|---|---|---|
| Condition | `bool` | true |

### Return

Leaves the current function, optionally with a value.

`control.return` · kind: statement · has execution input

| Input | Type | Default |
|---|---|---|
| Value | `string` |  |

### Sequence

Runs several chains one after another, in order.

`control.sequence` · kind: statement · has execution input · execution outputs: 1, 2

| Setting | Default |
|---|---|
| Steps | 2 |

### State Machine

Runs one branch per state. Use Go To State to move between them.

`control.stateMachine` · kind: statement · has execution input · execution outputs: Idle, Running

| Setting | Default |
|---|---|
| Machine name | mode |
| States (comma separated) | Idle, Running |

### While

Repeats a chain for as long as a condition stays true.

`control.while` · kind: statement · has execution input · execution outputs: body, done

| Input | Type | Default |
|---|---|---|
| While | `bool` | true |

## Math

### Absolute

Drops the minus sign from a number.

`math.abs` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `float` | 0 |

| Output | Type |
|---|---|
| Result | `float` |

### Add

Adds two numbers together.

`math.add` · kind: expression

| Input | Type | Default |
|---|---|---|
| A | `float` | 0 |
| B | `float` | 0 |

| Output | Type |
|---|---|
| Result | `float` |

### Ceiling

Rounds up to a whole number.

`math.ceil` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `float` | 0 |

| Output | Type |
|---|---|
| Result | `int` |

### Constrain

Clamps a number so it never leaves a range.

`math.constrain` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `float` | 0 |
| Low | `float` | 0 |
| High | `float` | 255 |

| Output | Type |
|---|---|
| Clamped | `float` |

### Cosine

Cosine of an angle in radians.

`math.cos` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `float` | 0 |

| Output | Type |
|---|---|
| Result | `float` |

### Decimal

A fixed number with a decimal point.

`math.float` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `float` | 0 |

| Output | Type |
|---|---|
| Value | `float` |

### Divide

Divides the first number by the second.

`math.divide` · kind: expression

| Input | Type | Default |
|---|---|---|
| A | `float` | 0 |
| B | `float` | 0 |

| Output | Type |
|---|---|
| Result | `float` |

### Floor

Rounds down to a whole number.

`math.floor` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `float` | 0 |

| Output | Type |
|---|---|
| Result | `int` |

### Larger Of

Whichever of two numbers is larger.

`math.max` · kind: expression

| Input | Type | Default |
|---|---|---|
| A | `float` | 0 |
| B | `float` | 0 |

| Output | Type |
|---|---|
| Larger | `float` |

### Map Range

Rescales a number from one range to another. The workhorse for sensors.

`math.map` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `int` | 0 |
| From low | `int` | 0 |
| From high | `int` | 1023 |
| To low | `int` | 0 |
| To high | `int` | 255 |

| Output | Type |
|---|---|
| Mapped | `int` |

### Multiply

Multiplies two numbers.

`math.multiply` · kind: expression

| Input | Type | Default |
|---|---|---|
| A | `float` | 0 |
| B | `float` | 0 |

| Output | Type |
|---|---|
| Result | `float` |

### Number

A fixed whole number.

`math.number` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `int` | 0 |

| Output | Type |
|---|---|
| Value | `int` |

### Power

Raises a number to a power.

`math.power` · kind: expression

| Input | Type | Default |
|---|---|---|
| Base | `float` | 2 |
| Exponent | `float` | 2 |

| Output | Type |
|---|---|
| Result | `float` |

### Random

A random whole number from the low value up to (but not including) the high one.

`math.random` · kind: expression

| Input | Type | Default |
|---|---|---|
| Low | `int` | 0 |
| High | `int` | 100 |

| Output | Type |
|---|---|
| Value | `int` |

### Random Seed

Seeds the random generator so runs differ. Read a floating analog pin for noise.

`math.randomSeed` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Seed | `int` | 0 |

### Remainder

The remainder left after dividing one whole number by another.

`math.modulo` · kind: expression

| Input | Type | Default |
|---|---|---|
| A | `int` | 0 |
| B | `int` | 1 |

| Output | Type |
|---|---|
| Remainder | `int` |

### Round

Rounds to the nearest whole number.

`math.round` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `float` | 0 |

| Output | Type |
|---|---|
| Result | `int` |

### Sine

Sine of an angle in radians.

`math.sin` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `float` | 0 |

| Output | Type |
|---|---|
| Result | `float` |

### Smaller Of

Whichever of two numbers is smaller.

`math.min` · kind: expression

| Input | Type | Default |
|---|---|---|
| A | `float` | 0 |
| B | `float` | 0 |

| Output | Type |
|---|---|
| Smaller | `float` |

### Square Root

The square root of a number.

`math.sqrt` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `float` | 0 |

| Output | Type |
|---|---|
| Result | `float` |

### Subtract

Subtracts the second number from the first.

`math.subtract` · kind: expression

| Input | Type | Default |
|---|---|---|
| A | `float` | 0 |
| B | `float` | 0 |

| Output | Type |
|---|---|
| Result | `float` |

### Tangent

Tangent of an angle in radians.

`math.tan` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `float` | 0 |

| Output | Type |
|---|---|
| Result | `float` |

## Logic

### And

True only when both inputs are true.

`logic.and` · kind: expression

| Input | Type | Default |
|---|---|---|
| A | `bool` | false |
| B | `bool` | false |

| Output | Type |
|---|---|
| Result | `bool` |

### Bit Clear

Turns one bit of a number off.

`logic.bitClear` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `int` | 0 |
| Bit | `int` | 0 |

| Output | Type |
|---|---|
| Result | `int` |

### Bit Read

Reads one bit out of a number.

`logic.bitRead` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `int` | 0 |
| Bit | `int` | 0 |

| Output | Type |
|---|---|
| Bit | `int` |

### Bit Set

Turns one bit of a number on.

`logic.bitSet` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `int` | 0 |
| Bit | `int` | 0 |

| Output | Type |
|---|---|
| Result | `int` |

### Bit Write

Sets one bit of a number to a chosen value.

`logic.bitWrite` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `int` | 0 |
| Bit | `int` | 0 |
| On | `bool` | false |

| Output | Type |
|---|---|
| Result | `int` |

### Bitwise And

Combines two numbers bit by bit with AND.

`logic.bitAnd` · kind: expression

| Input | Type | Default |
|---|---|---|
| A | `int` | 0 |
| B | `int` | 0 |

| Output | Type |
|---|---|
| Result | `int` |

### Bitwise Not

Flips every bit of a number.

`logic.bitNot` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `int` | 0 |

| Output | Type |
|---|---|
| Result | `int` |

### Bitwise Or

Combines two numbers bit by bit with OR.

`logic.bitOr` · kind: expression

| Input | Type | Default |
|---|---|---|
| A | `int` | 0 |
| B | `int` | 0 |

| Output | Type |
|---|---|
| Result | `int` |

### Bitwise Xor

Combines two numbers bit by bit with XOR.

`logic.bitXor` · kind: expression

| Input | Type | Default |
|---|---|---|
| A | `int` | 0 |
| B | `int` | 0 |

| Output | Type |
|---|---|
| Result | `int` |

### Boolean

A fixed true or false value.

`logic.boolean` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `bool` | true |

| Output | Type |
|---|---|
| Value | `bool` |

### Compare

Compares two numbers and returns true or false.

`logic.compare` · kind: expression

| Input | Type | Default |
|---|---|---|
| A | `any` | 0 |
| B | `any` | 0 |

| Output | Type |
|---|---|
| Result | `bool` |

| Setting | Default |
|---|---|
| Operator | == |

### Exclusive Or

True when exactly one of the two inputs is true.

`logic.xor` · kind: expression

| Input | Type | Default |
|---|---|---|
| A | `bool` | false |
| B | `bool` | false |

| Output | Type |
|---|---|
| Result | `bool` |

### Not

Flips true to false and false to true.

`logic.not` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `bool` | false |

| Output | Type |
|---|---|
| Result | `bool` |

### Or

True when either input is true.

`logic.or` · kind: expression

| Input | Type | Default |
|---|---|---|
| A | `bool` | false |
| B | `bool` | false |

| Output | Type |
|---|---|
| Result | `bool` |

### Shift Left

Moves the bits of a number to the left.

`logic.shiftLeft` · kind: expression

| Input | Type | Default |
|---|---|---|
| A | `int` | 0 |
| B | `int` | 0 |

| Output | Type |
|---|---|
| Result | `int` |

### Shift Right

Moves the bits of a number to the right.

`logic.shiftRight` · kind: expression

| Input | Type | Default |
|---|---|---|
| A | `int` | 0 |
| B | `int` | 0 |

| Output | Type |
|---|---|
| Result | `int` |

## Variables

### Array Get

Reads one item out of an array.

`var.arrayGet` · kind: expression

| Input | Type | Default |
|---|---|---|
| Index | `int` | 0 |

| Output | Type |
|---|---|
| Value | `int` |

| Setting | Default |
|---|---|
| Name | values |
| Type | int |

### Array Length

How many slots an array has.

`var.arrayLength` · kind: expression

| Output | Type |
|---|---|
| Length | `int` |

| Setting | Default |
|---|---|
| Name | values |

### Array Set

Stores a value into one slot of an array.

`var.arraySet` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Index | `int` | 0 |
| Value | `int` | 0 |

| Setting | Default |
|---|---|
| Name | values |
| Type | int |

### Declare Array

Creates a fixed-size list of values.

`var.arrayDeclare` · kind: statement · has execution input · execution outputs: then

| Setting | Default |
|---|---|
| Name | values |
| Type | int |
| Size | 8 |

### Declare Variable

Creates a named value the whole program can read and change.

`var.declare` · kind: statement · has execution input · execution outputs: then

| Setting | Default |
|---|---|
| Name | myValue |
| Type | int |
| Starting value | 0 |
| Expose to Dashboard | false |

### Decrement

Subtracts from a variable in place.

`var.decrement` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| By | `float` | 1 |

| Setting | Default |
|---|---|
| Name | myValue |

### Find In Text

Where a piece of text appears inside another. -1 when it does not.

`text.indexOf` · kind: expression

| Input | Type | Default |
|---|---|---|
| Text | `string` |  |
| Look for | `string` |  |

| Output | Type |
|---|---|
| Position | `int` |

### Get Variable

Reads the current value of a variable.

`var.get` · kind: expression

| Output | Type |
|---|---|
| Value | `int` |

| Setting | Default |
|---|---|
| Name | myValue |
| Type | int |

### Increment

Adds to a variable in place.

`var.increment` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| By | `float` | 1 |

| Setting | Default |
|---|---|
| Name | myValue |

### Join Text

Sticks two pieces of text together.

`text.concat` · kind: expression

| Input | Type | Default |
|---|---|---|
| First | `string` |  |
| Second | `string` |  |

| Output | Type |
|---|---|
| Text | `string` |

### Number To Text

Turns a number into text so it can be printed or joined.

`text.toString` · kind: expression

| Input | Type | Default |
|---|---|---|
| Value | `float` | 0 |

| Output | Type |
|---|---|
| Text | `string` |

### Part Of Text

Takes a slice out of a piece of text.

`text.substring` · kind: expression

| Input | Type | Default |
|---|---|---|
| Text | `string` |  |
| From | `int` | 0 |
| To | `int` | 1 |

| Output | Type |
|---|---|
| Text | `string` |

### Set Variable

Stores a new value into a variable.

`var.set` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Value | `int` | 0 |

| Setting | Default |
|---|---|
| Name | myValue |
| Type | int |

### Text

A fixed piece of text.

`text.string` · kind: expression

| Input | Type | Default |
|---|---|---|
| Text | `string` | hello |

| Output | Type |
|---|---|
| Text | `string` |

### Text Equals

True when two pieces of text are exactly the same.

`text.compare` · kind: expression

| Input | Type | Default |
|---|---|---|
| First | `string` |  |
| Second | `string` |  |

| Output | Type |
|---|---|
| Same | `bool` |

### Text Length

How many characters a piece of text has.

`text.length` · kind: expression

| Input | Type | Default |
|---|---|---|
| Text | `string` |  |

| Output | Type |
|---|---|
| Length | `int` |

### Text To Decimal

Reads a decimal number out of a piece of text.

`text.toFloat` · kind: expression

| Input | Type | Default |
|---|---|---|
| Text | `string` | 0 |

| Output | Type |
|---|---|
| Value | `float` |

### Text To Number

Reads a whole number out of a piece of text.

`text.toInt` · kind: expression

| Input | Type | Default |
|---|---|---|
| Text | `string` | 0 |

| Output | Type |
|---|---|
| Value | `int` |

## Time

### Elapsed Since

How long it has been since a recorded moment, in milliseconds.

`time.elapsedSince` · kind: expression

| Input | Type | Default |
|---|---|---|
| Timestamp | `int` | 0 |

| Output | Type |
|---|---|
| Elapsed | `int` |

### Microseconds Since Start

How long the board has been running, in microseconds.

`time.micros` · kind: expression

| Output | Type |
|---|---|
| µs | `int` |

### Milliseconds Since Start

How long the board has been running, in milliseconds.

`time.millis` · kind: expression

| Output | Type |
|---|---|
| ms | `int` |

### Read Stopwatch

How many milliseconds a stopwatch has counted.

`time.stopwatchRead` · kind: expression

| Output | Type |
|---|---|
| Elapsed | `int` |

| Setting | Default |
|---|---|
| Name | timer |

### Stopwatch

Starts, stops, and reads a running timer.

`time.stopwatch` · kind: statement · has execution input · execution outputs: then

| Setting | Default |
|---|---|
| Action | start |
| Name | timer |

## Serial

### Print Labelled Value

Prints "label: value", which is much easier to read in the monitor.

`serial.printValue` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Label | `string` | value |
| Value | `string` |  |

### Serial Available

How many bytes have arrived and are waiting to be read.

`serial.available` · kind: expression

| Output | Type |
|---|---|
| Bytes | `int` |

### Serial Begin

Starts the serial link. Put this in setup, before any printing.

`serial.begin` · kind: statement · has execution input · execution outputs: then

| Setting | Default |
|---|---|
| Baud | 115200 |

### Serial Flush

Waits until everything queued has finished sending.

`serial.flush` · kind: statement · has execution input · execution outputs: then

### Serial Parse Decimal

Reads the next decimal number from the incoming text.

`serial.parseFloat` · kind: expression

| Output | Type |
|---|---|
| Value | `float` |

### Serial Parse Number

Reads the next whole number from the incoming text.

`serial.parseInt` · kind: expression

| Output | Type |
|---|---|
| Value | `int` |

### Serial Print

Prints a value without moving to a new line.

`serial.print` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Value | `string` |  |

### Serial Println

Prints a value and moves to the next line.

`serial.println` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Value | `string` | hello |

### Serial Read

Reads one waiting byte. Returns -1 when nothing is waiting.

`serial.read` · kind: expression

| Output | Type |
|---|---|
| Byte | `int` |

### Serial Read Line

Reads incoming text up to a terminator character.

`serial.readStringUntil` · kind: expression

| Input | Type | Default |
|---|---|---|
| Ends with | `string` | \n |

| Output | Type |
|---|---|
| Text | `string` |

## Components

### Button Is Held

True once a button has been held down for long enough.

`button.isHeld` · kind: expression

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 2 |
| Hold ms | `int` | 800 |

| Output | Type |
|---|---|
| Held | `bool` |

### Button Is Pressed

True while a button is held down. Wired with the internal pull-up.

`button.isPressed` · kind: expression

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 2 |

| Output | Type |
|---|---|
| Pressed | `bool` |

### Button On Press

True for a single pass when a button goes down. Debounced internally.

`button.onPress` · kind: expression

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 2 |
| Debounce ms | `int` | 25 |

| Output | Type |
|---|---|
| Just pressed | `bool` |

### Button On Release

True for a single pass when a button comes back up.

`button.onRelease` · kind: expression

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 2 |
| Debounce ms | `int` | 25 |

| Output | Type |
|---|---|
| Just released | `bool` |

### Buzzer Beep

Plays a short beep.

`buzzer.beep` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 8 |
| Hz | `int` | 880 |
| Length ms | `int` | 120 |

### Buzzer Play Note

Plays a named musical note.

`buzzer.playNote` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 8 |
| Length ms | `int` | 200 |

| Setting | Default |
|---|---|
| Note | 440 |

### Buzzer Stop

Silences the buzzer.

`buzzer.stop` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 8 |

### DHT Humidity

Reads relative humidity as a percentage from a DHT11 or DHT22.

`dht.readHumidity` · kind: expression

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 4 |

| Output | Type |
|---|---|
| % | `float` |

| Setting | Default |
|---|---|
| Sensor | DHT22 |

**Library:** DHT sensor library

### DHT Temperature

Reads temperature in Celsius from a DHT11 or DHT22.

`dht.readTemperature` · kind: expression

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 4 |

| Output | Type |
|---|---|
| °C | `float` |

| Setting | Default |
|---|---|
| Sensor | DHT22 |

**Library:** DHT sensor library

### IR Read Code

Reads a code from an infrared remote. 0 when nothing arrived.

`ir.readCode` · kind: expression

| Output | Type |
|---|---|
| Code | `int` |

| Setting | Default |
|---|---|
| Receiver pin | 2 |

**Library:** IRremote

### LCD Backlight

Turns the display backlight on or off.

`lcd.backlight` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| On | `bool` | true |

**Library:** LiquidCrystal I2C

### LCD Clear

Wipes the display.

`lcd.clear` · kind: statement · has execution input · execution outputs: then

**Library:** LiquidCrystal I2C

### LCD Init

Starts a 16x2 I2C character display. Put this in setup.

`lcd.init` · kind: statement · has execution input · execution outputs: then

**Library:** LiquidCrystal I2C

### LCD Print At

Prints text at a chosen row and column of the display.

`lcd.printAt` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Column | `int` | 0 |
| Row | `int` | 0 |
| Text | `string` | Hello |

**Library:** LiquidCrystal I2C

### LED Fade To

Sets an LED brightness from 0 to 255. Needs a PWM pin.

`led.fadeTo` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 9 |
| Brightness | `int` | 128 |

### LED Off

Turns an LED off.

`led.off` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 13 |

### LED On

Turns an LED fully on.

`led.on` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 13 |

### LED Toggle

Flips an LED between on and off.

`led.toggle` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 13 |

### Motor Drive

Drives one channel of an L298N motor driver forward or backward.

`motor.setSpeed` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Enable (PWM) | `pin` | 5 |
| IN1 | `pin` | 6 |
| IN2 | `pin` | 7 |
| Speed -255..255 | `int` | 200 |

### Motor Stop

Stops a motor, either coasting or braking.

`motor.stop` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Enable (PWM) | `pin` | 5 |
| IN1 | `pin` | 6 |
| IN2 | `pin` | 7 |

| Setting | Default |
|---|---|
| Brake (short the motor) | false |

### NeoPixel Brightness

Sets overall strip brightness from 0 to 255.

`neopixel.brightness` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Brightness | `int` | 64 |

**Library:** Adafruit NeoPixel

### NeoPixel Init

Starts an addressable LED strip. Put this in setup.

`neopixel.init` · kind: statement · has execution input · execution outputs: then

| Setting | Default |
|---|---|
| Pixel count | 8 |
| Data pin | 6 |

**Library:** Adafruit NeoPixel

### NeoPixel Set All

Sets every pixel to the same colour.

`neopixel.setAll` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Red | `int` | 255 |
| Green | `int` | 0 |
| Blue | `int` | 0 |

**Library:** Adafruit NeoPixel

### NeoPixel Set Colour

Sets one pixel to a red/green/blue colour. Call Show to display it.

`neopixel.setPixel` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Pixel | `int` | 0 |
| Red | `int` | 255 |
| Green | `int` | 0 |
| Blue | `int` | 0 |

**Library:** Adafruit NeoPixel

### NeoPixel Show

Pushes the colours you set out to the strip.

`neopixel.show` · kind: statement · has execution input · execution outputs: then

**Library:** Adafruit NeoPixel

### Potentiometer Mapped

Reads a potentiometer and rescales it to a range you choose.

`pot.readMapped` · kind: expression

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | A0 |
| To low | `int` | 0 |
| To high | `int` | 180 |

| Output | Type |
|---|---|
| Value | `int` |

### Potentiometer Raw

Reads a potentiometer as a number from 0 to 1023.

`pot.readRaw` · kind: expression

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | A0 |

| Output | Type |
|---|---|
| Value | `int` |

### Potentiometer Smoothed

Reads a potentiometer through a smoothing filter, so the value stops jittering.

`pot.readSmoothed` · kind: expression

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | A0 |
| Smoothing | `float` | 0.2 |

| Output | Type |
|---|---|
| Value | `int` |

### Relay Set

Switches a relay on or off.

`relay.set` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 5 |
| On | `bool` | true |

| Setting | Default |
|---|---|
| Active LOW module | true |

### RTC Read Date

Reads the current date from a DS3231 clock as text.

`rtc.readDate` · kind: expression

| Output | Type |
|---|---|
| yyyy-mm-dd | `string` |

**Library:** RTClib

### RTC Read Time

Reads the current time from a DS3231 clock as text.

`rtc.readTime` · kind: expression

| Output | Type |
|---|---|
| hh:mm:ss | `string` |

**Library:** RTClib

### SD Card Init

Starts an SD card module. Put this in setup.

`sd.init` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Chip select | `pin` | 10 |

**Library:** SD

### SD Write Line

Appends a line of text to a file on the SD card.

`sd.writeLine` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| File | `string` | log.txt |
| Text | `string` |  |

**Library:** SD

### Servo Attach

Connects a servo to a pin. Put this in setup.

`servo.attach` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Pin | `pin` | 9 |

| Setting | Default |
|---|---|
| Servo name | servo |

**Library:** Servo

### Servo Detach

Releases a servo so it stops holding its position.

`servo.detach` · kind: statement · has execution input · execution outputs: then

| Setting | Default |
|---|---|
| Servo name | servo |

**Library:** Servo

### Servo Read

The angle a servo was last told to go to.

`servo.read` · kind: expression

| Output | Type |
|---|---|
| Angle | `int` |

| Setting | Default |
|---|---|
| Servo name | servo |

**Library:** Servo

### Servo Write Angle

Moves a servo to an angle between 0 and 180 degrees.

`servo.write` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Angle | `int` | 90 |

| Setting | Default |
|---|---|
| Servo name | servo |

**Library:** Servo

### Servo Write Microseconds

Drives a servo with a raw pulse width, for finer control than degrees.

`servo.writeMicroseconds` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Pulse µs | `int` | 1500 |

| Setting | Default |
|---|---|
| Servo name | servo |

**Library:** Servo

### Shift Register Write

Writes eight outputs at once through a 74HC595.

`shift595.writeByte` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Data (DS) | `pin` | 11 |
| Clock (SH) | `pin` | 12 |
| Latch (ST) | `pin` | 8 |
| Byte | `int` | 0 |

### Software Serial Available

How many bytes are waiting on the software serial port.

`softserial.available` · kind: expression

| Output | Type |
|---|---|
| Bytes | `int` |

**Library:** SoftwareSerial

### Software Serial Begin

Starts a second serial port on ordinary pins.

`softserial.begin` · kind: statement · has execution input · execution outputs: then

| Setting | Default |
|---|---|
| RX pin | 10 |
| TX pin | 11 |
| Baud | 9600 |

**Library:** SoftwareSerial

### Software Serial Print

Sends text out of the software serial port.

`softserial.print` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Text | `string` |  |

**Library:** SoftwareSerial

### Software Serial Read

Reads one waiting byte from the software serial port.

`softserial.read` · kind: expression

| Output | Type |
|---|---|
| Byte | `int` |

**Library:** SoftwareSerial

### Stepper Set Speed

Sets how fast a stepper turns, in revolutions per minute.

`stepper.setSpeed` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| RPM | `int` | 60 |

| Setting | Default |
|---|---|
| Steps per revolution | 200 |

**Library:** Stepper

### Stepper Step

Turns a stepper by a number of steps. Negative goes the other way.

`stepper.step` · kind: statement · has execution input · execution outputs: then

| Input | Type | Default |
|---|---|---|
| Steps | `int` | 100 |

| Setting | Default |
|---|---|
| Steps per revolution | 200 |

**Library:** Stepper

### Ultrasonic Distance

Measures distance with an HC-SR04. No library needed.

`ultrasonic.readDistance` · kind: expression

| Input | Type | Default |
|---|---|---|
| Trigger pin | `pin` | 7 |
| Echo pin | `pin` | 6 |

| Output | Type |
|---|---|
| Distance | `float` |

| Setting | Default |
|---|---|
| Units | cm |

## Custom C++

### Raw Expression

A C++ expression you write yourself, with a type you choose.

`custom.expression` · kind: expression

| Output | Type |
|---|---|
| Value | `int` |

| Setting | Default |
|---|---|
| C++ | 0 |
| Type | int |

### Raw Global

Top-level C++: functions, structs, #defines. Emitted above setup().

`custom.global` · kind: entry

| Setting | Default |
|---|---|
| C++ | #define MY_CONSTANT 42 |

### Raw Statement

Inserts C++ statements exactly as written, inside the current chain.

`custom.statement` · kind: statement · has execution input · execution outputs: then

| Setting | Default |
|---|---|
| C++ | // your code here |
