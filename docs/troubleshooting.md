# Troubleshooting

## The board is not detected

**Check the cable carries data.** Charge-only USB cables are extremely common
and enumerate nothing at all. Ask the operating system directly, before blaming
any software:

| Platform | Command | A board looks like |
|---|---|---|
| macOS | `ls /dev/cu.*` | `cu.usbmodem14201`, `cu.wchusbserial1420` |
| Linux | `ls /dev/ttyACM* /dev/ttyUSB*` | `ttyACM0` (genuine), `ttyUSB0` (CH340 clone) |
| Windows | `mode`, or Device Manager under Ports (COM & LPT) | `COM3` |

If nothing appears there, the computer cannot see the board and no software
will help.

Then check what the toolchain sees directly:

```bash
arduino-cli board list
```

If the port appears there but not in ArduForge, the backend is not running or
cannot reach `arduino-cli`. Check the Hardware tab.

If `arduino-cli` itself is not found, install it for your platform:

| Platform | Install |
|---|---|
| macOS | `brew install arduino-cli` |
| Windows | `winget install ArduinoSA.CLI` |
| Linux | your distribution package, or the official install script |

The official instructions, which stay current as these commands change, are at
<https://arduino.github.io/arduino-cli/latest/installation/>.

## Linux: "Permission denied" opening the port

On most distributions `/dev/ttyACM0` and `/dev/ttyUSB0` are owned by the
`dialout` group, and a user who is not a member gets a bare permission error
with no hint as to why. This is the most common Linux Arduino problem by a wide
margin. Confirm the owning group:

```bash
ls -l /dev/ttyACM0
```

Then add yourself to it:

```bash
sudo usermod -a -G dialout $USER
```

**You must log out and back in for this to take effect.** Opening a new terminal
is not enough, because group membership is fixed when the session starts. This
is why people add themselves to the group and report that nothing changed.

On Arch and its derivatives the group is `uucp` rather than `dialout`. Use
whatever `ls -l` reported.

## The board shows as "not recognised"

ArduForge resolves boards by USB VID/PID through a table in
[`server/src/boards/profiles.ts`](../server/src/boards/profiles.ts). Clone
makers frequently use their own vendor id, so a perfectly good Uno clone can
come up unidentified.

This is expected and visible on purpose. The UI says whether an FQBN came from
`arduino-cli` or from ArduForge's own table, so a guess is never invisible. Add
a row to that table rather than special-casing detection anywhere else.

A real example: the board this project was developed against reports VID
`0x3343` (DFRobot) with the genuine Uno PID `0x0043`, which `arduino-cli` does
not resolve on its own.

## CH340 clones

Clones using the CH340 USB-serial chip need a driver on some systems and appear
under their own name:

| Platform | Appears as | Driver |
|---|---|---|
| macOS | `/dev/cu.wchusbserial*` | Needed on older macOS. Recent versions include it. |
| Linux | `/dev/ttyUSB*` | In the kernel already. Nothing to install. |
| Windows | `COMn` | Windows Update usually supplies it. Older systems need the WCH driver. |

## macOS: `cu.` versus `tty.`, the trap

This one is macOS only. Every macOS serial device appears **twice**:

- `/dev/cu.usbmodem14201`, "callout", the one you want
- `/dev/tty.usbmodem14201`, "dial-in", which **blocks waiting for DCD assert**
  and will simply hang

Always use `cu.`. This is not a preference; opening the `tty.` device hangs the
process that opened it.

Note that `SerialPort.list()` from the `serialport` package reports the `tty.`
path. ArduForge maps it to the `cu.` twin before opening anything.

Linux `/dev/ttyACM0` and `/dev/ttyUSB0` are unrelated to this. They are real
devices with no twin, and ArduForge leaves them alone.

## "Port busy" or the port will not open

Only one process can hold a serial port. The usual culprits:

- The Arduino IDE's serial monitor is open on the same port. Close it.
- A previous ArduForge session leaked the handle. Find what holds the port:

  ```bash
  # macOS
  lsof | grep -E 'usbmodem|wchusbserial'

  # Linux
  lsof /dev/ttyACM0        # or fuser -v /dev/ttyACM0
  ```

  ```powershell
  # Windows: lsof does not exist. Look for the usual holders instead.
  Get-Process | Where-Object { $_.Name -match 'arduino|putty|node' }
  ```

  If something is listed, close it. If nothing is listed and the port still
  will not open, unplug and replug the board.

  On Linux, check this is not the permission problem in disguise. See the
  section above before hunting for a process that does not exist.

**Never run the backend under a file watcher while hardware is attached.**
`SIGTERM` arrives while the port is open and the descriptor is not reclaimed
cleanly. Use `npm run dev:server`, not `dev:server:watch`.

Windows has no `SIGTERM`. Ctrl-C there delivers `SIGINT`, which ArduForge
handles the same way, so the port is released on either. The watcher advice
still applies: it is the abrupt restart that leaks the handle, not the
particular signal.

## Upload times out

- Some clones need the reset button pressed as the upload begins.
- Close anything else holding the port first. An upload preempts ArduForge's
  own sessions automatically, but not other programs.
- Confirm the FQBN is right. An Uno bootloader will not accept a build for a
  different board.

## "AwryLink.h: No such file or directory"

The firmware travels with any sketch that exposes a variable. If you see this,
the sketch was compiled without it. Reload the page so the client picks up the
current build.

## The dashboard says "stale"

Telemetry stopped arriving for more than twice the configured interval. Usually:

- the sketch is blocked in a long `delay()` or a `while` loop, so
  `awrylink_poll()` is not being reached;
- the board reset;
- the cable was disturbed.

Frozen values are deliberately never shown as live, so a stale badge means the
numbers on screen are old.

## The dashboard connects but reports no variables

Only variables with **Expose to Dashboard** ticked are sent. Text (`String`)
variables are deliberately excluded: putting them in the fixed-size telemetry
hot path is what fragments a 2KB heap.

## An LED does not light, and nothing errors

Almost always a missing `pinMode`. On an Uno, `digitalWrite` on a pin that was
never set to `OUTPUT` only enables the internal pull-up, which glows faintly
instead of driving the LED. ArduForge warns about this in the problems panel.

## Quick Pins mode does nothing

Mode A needs **StandardFirmata** on the board. Use the Upload StandardFirmata
button first. It runs at 57600 baud, not the 115200 the rest of the project
uses, which is normal.

## A library will not install

`arduino-cli lib install` needs network access. If Verify reports a missing
library and the one-click install fails, install it by hand:

```bash
arduino-cli lib install "Adafruit NeoPixel"
```

## Running out of SRAM

The status bar shows free SRAM after each build. Below roughly 300 bytes an Uno
becomes unreliable, because the stack collides with the heap and behaviour turns
strange rather than failing cleanly. Reduce `String` use first; it is almost
always the cause.
