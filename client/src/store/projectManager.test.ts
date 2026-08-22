/**
 * AUDIT Pass 1 item 4 — the *other* project load path.
 *
 * The file-import path in App.tsx runs every document through migrate(). The
 * IndexedDB path did not: openProject() handed a stored record straight to
 * loadProject(). Records outlive the build that wrote them, so this is the
 * path most likely to meet an old or future format, and it was the one with
 * no validation at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ProjectRecord } from '@/store/idb';

const records = new Map<string, ProjectRecord>();

vi.mock('@/store/idb', () => ({
  projectStore: {
    list: () => Promise.resolve([...records.values()]),
    get: (id: string) => Promise.resolve(records.get(id) ?? null),
    put: (record: ProjectRecord) => {
      records.set(record.id, record);
      return Promise.resolve();
    },
    remove: (id: string) => {
      records.delete(id);
      return Promise.resolve();
    },
  },
  metaStore: {
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(),
  },
  markSessionOpen: () => Promise.resolve(false),
  markSessionClosed: () => Promise.resolve(),
}));

const { useProjects } = await import('@/store/projectManager');
const { useGraphStore } = await import('@/store/graphStore');

/** A record whose stored project is not a shape this build can open. */
function storeRecord(id: string, project: unknown): void {
  records.set(id, { id, name: id, updatedAt: new Date().toISOString(), project } as ProjectRecord);
}

const validProject = {
  version: 1,
  meta: { name: 'Good', createdAt: 'x', updatedAt: 'x' },
  board: { fqbn: 'arduino:avr:uno' },
  graph: {
    nodes: [
      { id: 'n1', type: 'forge', position: { x: 0, y: 0 }, data: { defId: 'event.setup', literals: {}, config: {} } },
    ],
    edges: [],
  },
  dashboard: { pages: [], widgets: [] },
  settings: {},
};

describe('opening a project stored in IndexedDB', () => {
  beforeEach(() => {
    records.clear();
    useGraphStore.getState().newProject();
  });

  it('opens a well-formed record', async () => {
    storeRecord('ok', validProject);
    await useProjects.getState().openProject('ok');
    expect(useGraphStore.getState().nodes).toHaveLength(1);
    expect(useProjects.getState().currentId).toBe('ok');
  });

  it('refuses a record written by a newer format version', async () => {
    storeRecord('future', { ...validProject, version: 99 });
    await useProjects.getState().openProject('future');
    // The editor must keep whatever was open, not adopt an unreadable document.
    expect(useGraphStore.getState().nodes).toHaveLength(0);
    expect(useProjects.getState().currentId).not.toBe('future');
  });

  it('refuses a record with no readable graph instead of blanking the canvas', async () => {
    storeRecord('nograph', { version: 1, meta: validProject.meta });
    await useProjects.getState().openProject('nograph');
    expect(useProjects.getState().currentId).not.toBe('nograph');
  });

  it('does not crash on a record whose meta block is malformed', async () => {
    storeRecord('badmeta', { ...validProject, meta: null });
    await expect(useProjects.getState().openProject('badmeta')).resolves.toBeUndefined();
    // It is repairable, so it opens — with a usable name rather than a throw.
    expect(typeof useGraphStore.getState().project.meta.name).toBe('string');
  });

  it('drops edges pointing at nodes the stored record does not contain', async () => {
    storeRecord('dangling', {
      ...validProject,
      graph: {
        nodes: validProject.graph.nodes,
        edges: [
          { id: 'e1', source: 'n1', target: 'MISSING', data: { kind: 'exec', portType: 'exec' } },
        ],
      },
    });
    await useProjects.getState().openProject('dangling');
    expect(useGraphStore.getState().edges).toHaveLength(0);
  });

  it('does not crash on a record that is not an object at all', async () => {
    storeRecord('junk', 'not a project');
    await expect(useProjects.getState().openProject('junk')).resolves.toBeUndefined();
  });
});
