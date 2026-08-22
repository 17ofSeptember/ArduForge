import { createApp } from '@/app.js';
import { buildStore } from '@/build/store.js';
import { createSerialSocket } from '@/ws/serialSocket.js';
import { createBuildSocket } from '@/ws/buildEvents.js';
import { createLinkSocket } from '@/ws/linkSocket.js';
import { createFirmataSocket } from '@/ws/firmataSocket.js';
import { routeUpgrades } from '@/ws/upgrade.js';
import { serialManager, MOCK_ENABLED } from '@/serial/manager.js';
import { MOCK_PORT_PATH } from '@/serial/mockDriver.js';
import { installShutdownHandlers, onShutdown } from '@/lifecycle.js';

const PORT = Number.parseInt(process.env['ARDUFORGE_PORT'] ?? '5174', 10);

installShutdownHandlers();

const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`[arduforge] server listening on http://localhost:${PORT}`);
  if (MOCK_ENABLED) {
    console.log(`[arduforge] mock board enabled at ${MOCK_PORT_PATH}`);
  }
});

const serialWss = createSerialSocket();
const buildWss = createBuildSocket();
const linkWss = createLinkSocket();
const firmataWss = createFirmataSocket();
routeUpgrades(server, {
  '/ws/serial': serialWss,
  '/ws/build': buildWss,
  '/ws/link': linkWss,
  '/ws/firmata': firmataWss,
});

// Ports first, then sockets, then the HTTP server (§3.3).
onShutdown(() => serialManager.closeAll());
onShutdown(() => buildStore.clear());
onShutdown(
  () =>
    new Promise<void>((resolve) => {
      const servers = [serialWss, buildWss, linkWss, firmataWss];
      for (const wss of servers) {
        for (const client of wss.clients) client.terminate();
      }
      let remaining = servers.length;
      const done = () => {
        remaining -= 1;
        if (remaining === 0) resolve();
      };
      for (const wss of servers) wss.close(done);
    }),
);
onShutdown(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
);
