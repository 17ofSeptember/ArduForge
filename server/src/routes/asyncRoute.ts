/**
 * Express 4 does not understand a handler that returns a promise. If one
 * rejects, nothing catches it: the request hangs until the client gives up and
 * the process takes an unhandled rejection. Wrapping every async handler turns
 * a rejection into a normal error passed to next(), which the JSON error
 * handler in app.ts then answers.
 *
 * Kept out of app.ts so the routers can import it without a cycle.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export function asyncRoute(
  handler: (req: Request, res: Response) => Promise<unknown>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}
