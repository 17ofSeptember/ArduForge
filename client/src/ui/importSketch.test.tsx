/**
 * The sketch import feature, driven through the UI (IMPORT.md §Phase 6).
 *
 * The importer has been correct for several phases and completely unreachable:
 * `importSketch` had no caller outside its own tests. These tests drive the real
 * controls — the toolbar button, a real File through the input, the paste
 * dialog — because that is the layer that was missing, and the layer where a
 * regression would not show up in any unit test.
 *
 * The confirmation step gets its own coverage: §Phase 6 requires that the open
 * project is never replaced without one, and a preview that silently commits is
 * worse than no preview at all.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { App } from '@/App';
import { useGraphStore } from '@/store/graphStore';
import { useToasts } from '@/ui/toast';

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

function reset(): void {
  cleanup();
  useToasts.setState({ toasts: [] });
}

const BLINK = [
  'const int ledPin = 13;',
  'unsigned long last = 0;',
  '',
  'void setup() {',
  '  pinMode(ledPin, OUTPUT);',
  '}',
  '',
  'void loop() {',
  '  if (millis() - last >= 500) {',
  '    last = millis();',
  '    digitalWrite(ledPin, HIGH);',
  '  }',
  '}',
  '',
].join('\n');

function sketchFile(name: string, contents: string): File {
  const file = new File([contents], name, { type: 'text/plain' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(contents) });
  return file;
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (input === null) throw new Error('no file input');
  return input as HTMLInputElement;
}

describe('a .ino reaches the sketch importer', () => {
  afterEach(reset);

  it('accepts .ino on the same control that opens a project', () => {
    render(<App />);
    expect(fileInput().getAttribute('accept')).toContain('.ino');
  });

  it('shows a preview instead of importing straight away', async () => {
    render(<App />);
    const before = useGraphStore.getState().nodes.length;

    fireEvent.change(fileInput(), { target: { files: [sketchFile('Blink.ino', BLINK)] } });

    await screen.findByText(/Import Blink/i);
    // Nothing may reach the canvas before the user confirms.
    expect(useGraphStore.getState().nodes).toHaveLength(before);
  });

  it('reports statements, coverage and the lifted pattern', async () => {
    render(<App />);
    fireEvent.change(fileInput(), { target: { files: [sketchFile('Blink.ino', BLINK)] } });

    await screen.findByText(/Import Blink/i);
    await screen.findByText(/statements/i);
    // "Custom C++" appears in both the count line and the section heading.
    expect(screen.getAllByText(/Custom C\+\+/i).length).toBeGreaterThan(0);
    // §4.2's lift, surfaced where the user can see it.
    expect(screen.getByText(/Every 500ms/)).toBeTruthy();
  });

  it('commits only when confirmed, into a new project', async () => {
    render(<App />);
    fireEvent.change(fileInput(), { target: { files: [sketchFile('Blink.ino', BLINK)] } });

    await screen.findByText(/Import Blink/i);
    fireEvent.click(screen.getByText('Import into a new project'));

    await waitFor(() => expect(useGraphStore.getState().nodes.length).toBeGreaterThan(0));
    expect(useGraphStore.getState().nodes.some((node) => node.data['defId'] === 'control.everyMs')).toBe(true);
  });

  it('lays the graph out rather than dumping it at the origin', async () => {
    render(<App />);
    fireEvent.change(fileInput(), { target: { files: [sketchFile('Blink.ino', BLINK)] } });
    await screen.findByText(/Import Blink/i);
    fireEvent.click(screen.getByText('Import into a new project'));

    await waitFor(() => expect(useGraphStore.getState().nodes.length).toBeGreaterThan(1));
    const positions = useGraphStore.getState().nodes.map((node) => `${node.position.x},${node.position.y}`);
    // Distinct positions, and not all at (0,0).
    expect(new Set(positions).size).toBe(positions.length);
    expect(positions.every((position) => position === '0,0')).toBe(false);
  });

  it('cancelling leaves the project untouched', async () => {
    render(<App />);
    const before = useGraphStore.getState().nodes.length;

    fireEvent.change(fileInput(), { target: { files: [sketchFile('Blink.ino', BLINK)] } });
    await screen.findByText(/Import Blink/i);
    fireEvent.click(screen.getByText('Cancel'));

    await waitFor(() => expect(screen.queryByText(/Import Blink/i)).toBeNull());
    expect(useGraphStore.getState().nodes).toHaveLength(before);
  });
});

describe('the paste path', () => {
  afterEach(reset);

  it('opens a dialog and routes through the same preview', async () => {
    render(<App />);
    fireEvent.click(screen.getByTitle('Paste Arduino code'));

    const area = await screen.findByPlaceholderText(/void setup/);
    fireEvent.change(area, { target: { value: BLINK } });
    fireEvent.click(screen.getByText('Preview import'));

    // Same dialog, same report — one flow, three entry points.
    await screen.findByText(/statements/i);
    expect(screen.getByText('Import into a new project')).toBeTruthy();
  });
});

describe('a .forge still opens as a project', () => {
  afterEach(reset);

  it('routes by content, not just by extension', async () => {
    render(<App />);
    const project = JSON.stringify({ version: 1, graph: { nodes: [], edges: [] } });

    fireEvent.change(fileInput(), { target: { files: [sketchFile('Thing.forge', project)] } });

    // The project path, not the sketch preview.
    await screen.findByText('Project loaded');
    expect(screen.queryByText('Import into a new project')).toBeNull();
  });
});

describe('an unparseable sketch still imports', () => {
  afterEach(reset);

  it('falls back to one Custom C++ block and says so', async () => {
    render(<App />);
    // An unterminated string: the pre-flight routes this to whole-file fallback.
    const broken = 'void setup(){ Serial.println("oops ); }\nvoid loop(){}\n';

    fireEvent.change(fileInput(), { target: { files: [sketchFile('Broken.ino', broken)] } });

    await waitFor(() => expect(screen.getAllByText(/could not be parsed/i).length).toBeGreaterThan(0));
    expect(screen.getByText('Import into a new project')).toBeTruthy();
  });
});

describe('the report lists Custom C++ nodes', () => {
  afterEach(reset);

  it('shows a marker per Raw node, inert until the import is confirmed', async () => {
    render(<App />);
    const raw = 'void setup(){}\nvoid loop(){ Wire.beginTransmission(0x27); }\n';
    fireEvent.change(fileInput(), { target: { files: [sketchFile('Raw.ino', raw)] } });
    await screen.findByText(/Import Raw/i);

    const chip = await screen.findByText('#1');
    // Disabled on purpose: the node is not on the canvas until confirmed, and a
    // button that silently does nothing is worse than one that says why.
    expect(chip.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/selectable on the canvas once the import is confirmed/i)).toBeTruthy();
  });

  it('selectOnly does select a node once one exists', async () => {
    render(<App />);
    fireEvent.change(fileInput(), { target: { files: [sketchFile('Blink.ino', BLINK)] } });
    await screen.findByText(/Import Blink/i);
    fireEvent.click(screen.getByText('Import into a new project'));
    await waitFor(() => expect(useGraphStore.getState().nodes.length).toBeGreaterThan(0));

    const target = useGraphStore.getState().nodes[0];
    if (target === undefined) throw new Error('no nodes');
    useGraphStore.getState().selectOnly(target.id);

    expect(useGraphStore.getState().nodes.filter((node) => node.selected === true)).toHaveLength(1);
  });
});

describe('layout determinism', () => {
  it('places the same sketch identically twice', async () => {
    const { buildPreview } = await import('@/import/importFlow');
    const first = await buildPreview([{ name: 'B.ino', content: BLINK }], 'B');
    const second = await buildPreview([{ name: 'B.ino', content: BLINK }], 'B');

    // §Non-negotiables 4. Without this the canvas jumps on every re-import.
    expect(first.nodes.map((node) => node.position)).toEqual(second.nodes.map((node) => node.position));
  });
});
