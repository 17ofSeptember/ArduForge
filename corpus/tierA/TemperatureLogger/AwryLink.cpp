#include "AwryLink.h"

// ── module state ─────────────────────────────────────────────────────────────

static const AwryVar *g_table = nullptr;
static uint8_t g_count = 0;
static const char *g_hash = "0";

static char g_rx[AWRYLINK_MAX_LINE];
static uint8_t g_rxLen = 0;
// Set when a line overruns the buffer, so the rest of that line is discarded
// instead of being parsed as a bogus command.
static bool g_rxOverflow = false;

static unsigned long g_interval = 0;  // 0 = telemetry stopped
static unsigned long g_lastTelemetry = 0;
// Where the next telemetry frame resumes, so a table too large for one line
// still reports every variable across successive frames.
static uint8_t g_cursor = 0;

// ── value formatting ─────────────────────────────────────────────────────────

/**
 * Writes a variable's value as text. AVR's snprintf has no %f, so floats go
 * through dtostrf. Returns the number of characters written.
 */
static uint8_t formatValue(const AwryVar &var, char *out, uint8_t cap) {
  if (cap == 0) return 0;
  switch (var.type) {
    case AWRY_INT:
      return (uint8_t)snprintf(out, cap, "%d", *(int *)var.ptr);
    case AWRY_LONG:
      return (uint8_t)snprintf(out, cap, "%ld", *(long *)var.ptr);
    case AWRY_BOOL:
      return (uint8_t)snprintf(out, cap, "%d", (*(bool *)var.ptr) ? 1 : 0);
    case AWRY_FLOAT: {
      char tmp[16];
      dtostrf(*(float *)var.ptr, 0, 3, tmp);
      return (uint8_t)snprintf(out, cap, "%s", tmp);
    }
  }
  return 0;
}

static void applyValue(const AwryVar &var, const char *text) {
  switch (var.type) {
    case AWRY_INT:
      *(int *)var.ptr = atoi(text);
      break;
    case AWRY_LONG:
      *(long *)var.ptr = atol(text);
      break;
    case AWRY_FLOAT:
      *(float *)var.ptr = (float)atof(text);
      break;
    case AWRY_BOOL:
      *(bool *)var.ptr = (text[0] == '1' || text[0] == 't' || text[0] == 'T');
      break;
  }
}

static int findVar(const char *name) {
  for (uint8_t i = 0; i < g_count; i++) {
    if (strcmp(g_table[i].name, name) == 0) return (int)i;
  }
  return -1;
}

static void sendError(const char *code, const char *detail) {
  Serial.print(F("E|"));
  Serial.print(code);
  Serial.print(',');
  Serial.println(detail);
}

// ── command handling ─────────────────────────────────────────────────────────

/** Splits "<a>,<b>" in place. Returns the second field, or nullptr. */
static char *splitComma(char *text) {
  char *comma = strchr(text, ',');
  if (comma == nullptr) return nullptr;
  *comma = '\0';
  return comma + 1;
}

static void handleLine(char *line) {
  if (line[0] != '!') return;  // not addressed to the link

  const char command = line[1];
  char *arg = line + 2;

  switch (command) {
    case 'H': {  // handshake
      Serial.print(F("H|awrylink,1,uno,"));
      Serial.println(g_hash);
      break;
    }

    case 'P': {  // ping
      Serial.print(F("P|"));
      Serial.println(millis());
      break;
    }

    case 'T': {  // start telemetry
      unsigned long requested = (unsigned long)atol(arg);
      if (requested < AWRYLINK_MIN_INTERVAL_MS) requested = AWRYLINK_MIN_INTERVAL_MS;
      g_interval = requested;
      g_lastTelemetry = millis();
      g_cursor = 0;
      break;
    }

    case 'X':  // stop telemetry
      g_interval = 0;
      break;

    case 'S': {  // set variable: !S<name>=<value>
      char *equals = strchr(arg, '=');
      if (equals == nullptr) {
        sendError("BADSET", arg);
        break;
      }
      *equals = '\0';
      const int index = findVar(arg);
      if (index < 0) {
        sendError("NOVAR", arg);
        break;
      }
      if (!g_table[index].writable) {
        sendError("READONLY", arg);
        break;
      }
      applyValue(g_table[index], equals + 1);
      break;
    }

    case 'G': {  // get one variable
      const int index = findVar(arg);
      if (index < 0) {
        sendError("NOVAR", arg);
        break;
      }
      char value[24];
      formatValue(g_table[index], value, sizeof(value));
      Serial.print(F("T|"));
      Serial.print(millis());
      Serial.print(',');
      Serial.print(g_table[index].name);
      Serial.print('=');
      Serial.println(value);
      break;
    }

    case 'D': {  // digitalWrite
      char *value = splitComma(arg);
      if (value == nullptr) break;
      digitalWrite((uint8_t)atoi(arg), atoi(value) ? HIGH : LOW);
      break;
    }

    case 'A': {  // analogWrite
      char *value = splitComma(arg);
      if (value == nullptr) break;
      analogWrite((uint8_t)atoi(arg), constrain(atoi(value), 0, 255));
      break;
    }

    case 'M': {  // pinMode
      char *value = splitComma(arg);
      if (value == nullptr) break;
      const uint8_t pin = (uint8_t)atoi(arg);
      switch (atoi(value)) {
        case 0: pinMode(pin, INPUT); break;
        case 1: pinMode(pin, OUTPUT); break;
        default: pinMode(pin, INPUT_PULLUP); break;
      }
      break;
    }

    case 'R': {  // digitalRead
      const uint8_t pin = (uint8_t)atoi(arg);
      Serial.print(F("R|"));
      Serial.print(pin);
      Serial.print(',');
      Serial.println(digitalRead(pin) == HIGH ? 1 : 0);
      break;
    }

    case 'N': {  // analogRead
      const uint8_t pin = (uint8_t)atoi(arg);
      Serial.print(F("N|"));
      Serial.print(pin);
      Serial.print(',');
      Serial.println(analogRead(pin));
      break;
    }

    default:
      sendError("BADCMD", arg);
      break;
  }
}

// ── telemetry ────────────────────────────────────────────────────────────────

static void sendTelemetry() {
  if (g_count == 0) return;

  char frame[AWRYLINK_MAX_LINE];
  int used = snprintf(frame, sizeof(frame), "T|%lu", millis());
  if (used < 0) return;

  const uint8_t startedAt = g_cursor;
  uint8_t emitted = 0;

  for (uint8_t step = 0; step < g_count; step++) {
    const uint8_t index = (uint8_t)((startedAt + step) % g_count);
    const AwryVar &var = g_table[index];

    char value[24];
    formatValue(var, value, sizeof(value));

    // +2 for the comma and '=' , +1 for the terminator.
    const int needed = (int)strlen(var.name) + (int)strlen(value) + 3;
    if (used + needed >= (int)sizeof(frame)) {
      // Frame is full. Resume here next time rather than dropping the rest.
      g_cursor = index;
      break;
    }

    used += snprintf(frame + used, sizeof(frame) - used, ",%s=%s", var.name, value);
    emitted++;
    g_cursor = (uint8_t)((index + 1) % g_count);
  }

  if (emitted == g_count) g_cursor = 0;
  Serial.println(frame);
}

// ── public API ───────────────────────────────────────────────────────────────

void awrylink_begin(const AwryVar *table, uint8_t count, const char *sketchHash) {
  g_table = table;
  g_count = count;
  if (sketchHash != nullptr) g_hash = sketchHash;
  g_rxLen = 0;
  g_rxOverflow = false;
  g_interval = 0;
}

void awrylink_poll() {
  // Drain whatever has arrived. Never blocks: only bytes already buffered by
  // the UART are consumed.
  while (Serial.available() > 0) {
    const char c = (char)Serial.read();

    if (c == '\n' || c == '\r') {
      if (g_rxOverflow) {
        // The line was too long to be meaningful; discard it and recover.
        sendError("LONGLINE", "");
        g_rxOverflow = false;
      } else if (g_rxLen > 0) {
        g_rx[g_rxLen] = '\0';
        handleLine(g_rx);
      }
      g_rxLen = 0;
      continue;
    }

    if (g_rxLen >= sizeof(g_rx) - 1) {
      g_rxOverflow = true;
      continue;
    }
    g_rx[g_rxLen++] = c;
  }

  if (g_interval == 0) return;
  const unsigned long now = millis();
  // Unsigned subtraction, so this stays correct across millis() rollover.
  if (now - g_lastTelemetry < g_interval) return;
  g_lastTelemetry = now;
  sendTelemetry();
}

void awrylink_log(const char *text) {
  Serial.print(F("L|"));
  Serial.println(text);
}
