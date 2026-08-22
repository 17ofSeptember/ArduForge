/**
 * Express app composition, separated from the listener so tests exercise the
 * real middleware stack rather than a lookalike assembled in a fixture.
 */
import express, { type ErrorRequestHandler, type Express } from 'express';
import cors from 'cors';
import { healthRouter } from '@/routes/health.js';
import { boardsRouter } from '@/routes/boards.js';
import { buildRouter } from '@/routes/build.js';
import { librariesRouter } from '@/routes/libraries.js';
import { firmataRouter } from '@/routes/firmata.js';

/**
 * Ceiling for a whole request. The per-file cap in the compile schema is 1MB
 * and a sketch may carry 32 of them, but a real graph never approaches that;
 * 4MB is generous for legitimate traffic and still bounds the parse.
 */
export const BODY_LIMIT = '4mb';

/**
 * Body-parser failures never reach a route, so they never reach zod. Without
 * this handler Express falls through to its default, which answers with an
 * HTML page containing the stack trace — absolute paths from the machine the
 * server is running on included — and every client here calls res.json() on
 * the reply, so an HTML body turns a clear 400 into an opaque parse error.
 * Both halves of that are fixed by answering in the shape the API always uses.
 */
const jsonErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const status = typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : typeof (error as { statusCode?: unknown }).statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500;

  const type = (error as { type?: unknown }).type;
  let message: string;
  if (type === 'entity.too.large') {
    message = `Request body is larger than the ${BODY_LIMIT} limit.`;
  } else if (type === 'entity.parse.failed') {
    message = 'Request body is not valid JSON.';
  } else if (status < 500) {
    message = 'Request could not be read.';
  } else {
    // Deliberately generic: an unexpected server fault must not describe its
    // own internals to the caller. The detail goes to the operator's console.
    message = 'The server hit an unexpected error.';
    console.error('[arduforge] unhandled request error:', error);
  }

  res.status(status).json({ ok: false, error: message });
};

export function createApp(): Express {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: BODY_LIMIT }));

  app.use('/api', healthRouter);
  app.use('/api', boardsRouter);
  app.use('/api', buildRouter);
  app.use('/api', librariesRouter);
  app.use('/api', firmataRouter);

  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: 'Not found' });
  });

  // Must be last: Express selects error handlers by arity, in mount order.
  app.use(jsonErrorHandler);

  return app;
}
