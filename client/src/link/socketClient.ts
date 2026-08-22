/**
 * Shared WebSocket singleton factory (BUILD_PLAN.md §3.4).
 *
 * Every rule in §3.4 lives here exactly once, so /ws/serial and /ws/build cannot
 * drift apart:
 *  - the client is a module-level singleton with a refcount, outside React;
 *  - dropping to zero refs starts a grace timer rather than closing, so
 *    StrictMode's subscribe → unsubscribe → subscribe keeps the connection;
 *  - callers get reconnect with backoff, and HMR disposal is wired by the module
 *    that creates the client.
 */

export type SocketPhase = 'connecting' | 'connected' | 'disconnected';

const IDLE_GRACE_MS = 1_000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8_000;
const MAX_PENDING = 64;

export interface SocketClient<Incoming, Outgoing> {
  subscribe(onMessage: (message: Incoming) => void, onPhase?: (phase: SocketPhase) => void): () => void;
  send(message: Outgoing): void;
  getPhase(): SocketPhase;
  destroy(): void;
}

export function createSocketClient<Incoming, Outgoing>(path: string): SocketClient<Incoming, Outgoing> {
  let socket: WebSocket | null = null;
  let refs = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let destroyed = false;
  let phase: SocketPhase = 'disconnected';
  let pending: Outgoing[] = [];

  const messageListeners = new Set<(message: Incoming) => void>();
  const phaseListeners = new Set<(phase: SocketPhase) => void>();

  const url = () => {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${window.location.host}${path}`;
  };

  const setPhase = (next: SocketPhase) => {
    if (phase === next) return;
    phase = next;
    for (const listener of phaseListeners) listener(next);
  };

  const scheduleReconnect = () => {
    if (destroyed || refs === 0 || reconnectTimer !== null) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (refs > 0) connect();
    }, delay);
  };

  function connect(): void {
    if (destroyed || socket !== null) return;
    setPhase('connecting');
    const next = new WebSocket(url());
    socket = next;

    next.addEventListener('open', () => {
      reconnectAttempt = 0;
      setPhase('connected');
      const queued = pending;
      pending = [];
      for (const message of queued) next.send(JSON.stringify(message));
    });

    next.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      let parsed: Incoming;
      try {
        parsed = JSON.parse(event.data) as Incoming;
      } catch {
        return;
      }
      for (const listener of messageListeners) listener(parsed);
    });

    next.addEventListener('close', () => {
      if (socket === next) socket = null;
      setPhase('disconnected');
      scheduleReconnect();
    });

    // 'error' is always followed by 'close'; reconnection is handled there.
    next.addEventListener('error', () => undefined);
  }

  const closeSocket = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const current = socket;
    socket = null;
    pending = [];
    if (current !== null && current.readyState <= WebSocket.OPEN) current.close();
    setPhase('disconnected');
  };

  const scheduleIdleClose = () => {
    if (idleTimer !== null) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      // A StrictMode remount will have re-subscribed by now; only close if not.
      if (refs === 0) closeSocket();
    }, IDLE_GRACE_MS);
  };

  return {
    getPhase: () => phase,

    subscribe(onMessage, onPhase) {
      refs += 1;
      messageListeners.add(onMessage);
      if (onPhase !== undefined) {
        phaseListeners.add(onPhase);
        onPhase(phase);
      }
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      connect();

      let released = false;
      return () => {
        if (released) return;
        released = true;
        refs -= 1;
        messageListeners.delete(onMessage);
        if (onPhase !== undefined) phaseListeners.delete(onPhase);
        if (refs === 0) scheduleIdleClose();
      };
    },

    send(message) {
      if (socket !== null && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
        return;
      }
      // Bounded: a stuck socket must not grow this forever.
      if (pending.length < MAX_PENDING) pending.push(message);
      connect();
    },

    destroy() {
      destroyed = true;
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = null;
      closeSocket();
      messageListeners.clear();
      phaseListeners.clear();
      refs = 0;
    },
  };
}
