/**
 * The Open button, and what happens when the file is bad.
 *
 * The import path existed for a long time with no way to reach it: the hidden
 * file input was in the tree and importProject was written and tested, but
 * nothing ever called click() on the ref. Everything below the UI worked, which
 * is exactly why it went unnoticed — the unit tests all passed.
 *
 * So these tests drive the real control rather than the function behind it: a
 * click on the toolbar button, a real File through the input's change event,
 * and an assertion that the editor is still on screen afterwards. A corrupted
 * file must produce a specific message and leave the app running (THEME.md
 * Phase 1 item 4), never a blank page.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { App } from '@/App';
import { useGraphStore } from '@/store/graphStore';
import { useDashboard } from '@/dashboard/store';
import { useToasts } from '@/ui/toast';
import { buildProject, emptyProject, serialize } from '@/store/persistence';
import type { AnyNode, ForgeEdge } from '@/graph/model';

const nodes: AnyNode[] = [
  { id: 'n1', type: 'forge', position: { x: 0, y: 0 }, data: { defId: 'event.setup', literals: {}, config: {} } },
  {
    id: 'n2',
    type: 'forge',
    position: { x: 260, y: 0 },
    data: { defId: 'io.pinMode', literals: { pin: 11 }, config: { mode: 'INPUT_PULLUP' } },
  },
];

const edges: ForgeEdge[] = [
  {
    id: 'e1',
    source: 'n1',
    target: 'n2',
    sourceHandle: 'exec-out:then',
    targetHandle: 'exec-in',
    type: 'forge',
    data: { kind: 'exec', portType: 'exec' },
  },
];

const dashboard = {
  pages: [{ id: 'page_1', name: 'Main' }],
  widgets: [
    {
      id: 'w1',
      type: 'gauge',
      pageId: 'page_1',
      x: 0,
      y: 0,
      w: 2,
      h: 2,
      binding: { kind: 'var', name: 'speed', direction: 'both' },
      config: {},
    },
  ],
};

/**
 * jsdom ships neither of these and React Flow calls both on mount, so without
 * them rendering App throws from inside a passive effect — which surfaces as an
 * unhandled error rather than a failed assertion, and is easy to misread as the
 * component under test being broken.
 */
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;

  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
    constructor(readonly transform?: string) {}
  } as unknown as typeof DOMMatrixReadOnly;
});

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (input === null) throw new Error('no file input in the toolbar');
  return input as HTMLInputElement;
}

/** jsdom's File has text(), but not in every version; this keeps it explicit. */
function forgeFile(name: string, contents: string): File {
  const file = new File([contents], name, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(contents) });
  return file;
}

/** The toast store is module-level, so cleanup() alone leaves it full. */
function reset(): void {
  cleanup();
  useToasts.setState({ toasts: [] });
}

describe('the Open button', () => {
  afterEach(reset);

  it('is in the toolbar and opens the file picker', () => {
    render(<App />);
    const button = screen.getByTitle('Open a .forge file');

    const input = fileInput();
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    button.click();

    expect(click).toHaveBeenCalledTimes(1);
  });

  it('sits before Save and Export', () => {
    render(<App />);
    const open = screen.getByTitle('Open a .forge file');
    const save = screen.getByTitle('Save now');
    const exportButton = screen.getByTitle('Export .forge file');

    // Node.compareDocumentPosition: FOLLOWING means the argument comes after.
    expect(open.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(open.compareDocumentPosition(exportButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('restores the graph and the dashboard from an exported file', async () => {
    render(<App />);

    const exported = serialize(buildProject(emptyProject('Reopened'), nodes, edges, dashboard));
    fireEvent.change(fileInput(), { target: { files: [forgeFile('Reopened.forge', exported)] } });

    await screen.findByText('Project loaded');

    await waitFor(() => {
      const state = useGraphStore.getState();
      expect(state.nodes).toHaveLength(2);
      expect(state.edges).toHaveLength(1);
    });

    const restored = useGraphStore.getState().nodes.find((node) => node.id === 'n2');
    expect(restored?.data['defId']).toBe('io.pinMode');
    expect((restored?.data['literals'] as Record<string, unknown>)['pin']).toBe(11);

    // The dashboard travels in its own block and is the half that goes missing
    // quietly — a graph without its widgets still looks like a good import.
    expect(useDashboard.getState().widgets).toHaveLength(1);
    expect(useDashboard.getState().pages).toHaveLength(1);
  });
});

describe('a corrupted file', () => {
  afterEach(reset);

  it('reports what is wrong and leaves the editor on screen', async () => {
    render(<App />);

    // Truncated mid-object, the shape a half-written download actually has.
    const good = serialize(buildProject(emptyProject('Half'), nodes, edges, dashboard));
    const truncated = good.slice(0, Math.floor(good.length / 2));

    fireEvent.change(fileInput(), { target: { files: [forgeFile('Half.forge', truncated)] } });

    await screen.findByText('Could not open that project');
    expect(screen.getByText(/looks corrupted or was not saved completely/i)).toBeTruthy();

    // The point of the exercise: still an editor, not a blank page.
    expect(screen.getByTitle('Open a .forge file')).toBeTruthy();
    expect(document.body.textContent).not.toBe('');
  });

  it('rejects a file that is valid JSON but not a project', async () => {
    render(<App />);
    fireEvent.change(fileInput(), {
      target: { files: [forgeFile('notes.forge', JSON.stringify({ hello: 'world' }))] },
    });

    await screen.findByText('Could not open that project');
    expect(screen.getByTitle('Open a .forge file')).toBeTruthy();
  });

  it('refuses a file from a newer format version by name', async () => {
    render(<App />);
    const future = JSON.stringify({ version: 99, graph: { nodes: [], edges: [] } });
    fireEvent.change(fileInput(), { target: { files: [forgeFile('future.forge', future)] } });

    await screen.findByText('Could not open that project');
    expect(screen.getByText(/newer version of ArduForge/i)).toBeTruthy();
  });

  it('warns, but still opens, a file naming node types this build does not have', async () => {
    render(<App />);
    const doc = JSON.stringify({
      version: 1,
      graph: {
        nodes: [
          { id: 'n1', type: 'forge', position: { x: 0, y: 0 }, data: { defId: 'event.setup', literals: {}, config: {} } },
          { id: 'n2', type: 'forge', position: { x: 1, y: 1 }, data: { defId: 'quantum.entangle', literals: {}, config: {} } },
        ],
        edges: [],
      },
    });

    fireEvent.change(fileInput(), { target: { files: [forgeFile('future.forge', doc)] } });

    await screen.findByText(/Opened future.forge with warnings/i);
    expect(screen.getByText(/not in this build/i)).toBeTruthy();

    // Opened, not refused — the user's nodes are still there.
    await waitFor(() => expect(useGraphStore.getState().nodes).toHaveLength(2));
  });
});
