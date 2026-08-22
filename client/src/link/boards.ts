import type { BoardCandidate } from '@/link/health';

export interface BoardsResponse {
  readonly boards: readonly BoardCandidate[];
  readonly portStatus: readonly {
    readonly port: string;
    readonly holder: string | null;
    readonly mode: string | null;
    readonly queued: number;
  }[];
  readonly error?: string;
}

export async function fetchBoards(signal: AbortSignal): Promise<BoardsResponse> {
  const response = await fetch('/api/boards', { signal });
  if (!response.ok && response.status !== 503) {
    throw new Error(`Backend returned ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as BoardsResponse;
}
