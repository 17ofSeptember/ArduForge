/**
 * `ws` hands a message to a listener as `Buffer | ArrayBuffer | Buffer[]`, and
 * only the first of those survives a bare `.toString()`:
 *
 *   [Buffer('{"t":"pi'), Buffer('ng"}')].toString()  ->  '{"t":"pi,ng"}'
 *   new ArrayBuffer(2).toString()                    ->  '[object ArrayBuffer]'
 *
 * Array.prototype.toString joins with a comma, so a fragmented frame comes
 * back subtly *corrupted* rather than obviously broken — it still parses as
 * JSON sometimes, just with the wrong value. Every socket normalises here
 * instead of calling toString() on the union directly.
 *
 * With ws's default nodebuffer binaryType a whole message arrives as one
 * Buffer, so this is latent today; it becomes reachable the moment binaryType
 * changes or a fragmented frame is delivered unconcatenated.
 */
import type { RawData } from 'ws';

export function rawDataToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}
