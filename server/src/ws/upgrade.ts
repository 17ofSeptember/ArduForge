/**
 * Single WebSocket upgrade router.
 *
 * Attaching more than one WebSocketServer to the same HTTP server via the
 * `server` option does NOT work: each one registers its own 'upgrade' listener
 * and destroys sockets whose path it does not recognise, so whichever runs
 * first rejects the other's connections with a 400. The supported pattern is
 * noServer:true plus one upgrade handler that dispatches by pathname.
 */
import type { Server as HttpServer } from 'node:http';
import type { WebSocketServer } from 'ws';

export function routeUpgrades(server: HttpServer, routes: Record<string, WebSocketServer>): void {
  server.on('upgrade', (request, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }

    const wss = routes[pathname];
    if (wss === undefined) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
}
