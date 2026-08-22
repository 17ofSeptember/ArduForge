// See BUILD_PLAN.md §3.3 — auto-restart leaks device handles.
// SIGTERM arrives while the serial port is open and the OS descriptor is not
// reclaimed cleanly. This script exists purely to make that impossible to forget.
const RED = '\x1b[41m\x1b[97m';
const YEL = '\x1b[33m';
const OFF = '\x1b[0m';

console.log('');
console.log(`${RED}  UNSAFE WITH HARDWARE ATTACHED                      ${OFF}`);
console.log('');
console.log(`${YEL}  tsx watch restarts this process on every file save.${OFF}`);
console.log(`${YEL}  If a serial port is open when that happens, the OS${OFF}`);
console.log(`${YEL}  descriptor leaks and the port becomes unopenable${OFF}`);
console.log(`${YEL}  until you replug the board.${OFF}`);
console.log('');
console.log(`${YEL}  Use 'npm run dev:server' for any hardware session.${OFF}`);
console.log('');
