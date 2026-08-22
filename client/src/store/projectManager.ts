/**
 * Project lifecycle: autosave, crash recovery, and the project list.
 * BUILD_PLAN.md §Phase 7.
 */
import { create } from 'zustand';
import { currentProject, useGraphStore } from '@/store/graphStore';
import { useDashboard } from '@/dashboard/store';
import { emptyProject, migrateWithReport, type ForgeProject } from '@/store/persistence';
import { toast } from '@/ui/toast';
import {
  markSessionClosed,
  markSessionOpen,
  metaStore,
  projectStore,
  type ProjectRecord,
} from '@/store/idb';
import { exampleById, examples } from '@/examples';

const AUTOSAVE_MS = 5_000;
const LAST_OPEN_KEY = 'last-open-id';

function makeId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Validate a project read back out of IndexedDB. Returns null when the record
 * cannot be opened at all, having told the user why — the editor keeps whatever
 * document is currently loaded rather than blanking the canvas.
 */
function readStoredProject(stored: unknown, name: string): ForgeProject | null {
  try {
    const { project, warnings } = migrateWithReport(stored);
    if (warnings.length > 0) {
      toast.warning(`Opened "${name}" with repairs`, warnings.join(' '));
    }
    return project;
  } catch (error: unknown) {
    toast.error(
      `Could not open "${name}"`,
      error instanceof Error ? error.message : 'The saved project is not readable.',
    );
    return null;
  }
}

interface ProjectManagerState {
  currentId: string | null;
  records: readonly ProjectRecord[];
  /** Set when the previous session ended without unloading cleanly. */
  recoveryAvailable: boolean;
  lastSavedAt: number | null;

  refresh(): Promise<void>;
  saveNow(): Promise<void>;
  newProject(name?: string): Promise<void>;
  openProject(id: string): Promise<void>;
  duplicateProject(id: string): Promise<void>;
  renameProject(id: string, name: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
  openExample(exampleId: string): Promise<void>;
  dismissRecovery(): void;
  acceptRecovery(): Promise<void>;
}

export const useProjects = create<ProjectManagerState>((set, get) => ({
  currentId: null,
  records: [],
  recoveryAvailable: false,
  lastSavedAt: null,

  async refresh() {
    set({ records: await projectStore.list() });
  },

  async saveNow() {
    const id = get().currentId ?? makeId();
    const project = currentProject();
    await projectStore.put({
      id,
      name: project.meta.name,
      updatedAt: project.meta.updatedAt,
      project,
    });
    await metaStore.set(LAST_OPEN_KEY, id);
    set({ currentId: id, lastSavedAt: Date.now() });
    await get().refresh();
  },

  async newProject(name = 'Untitled') {
    const project: ForgeProject = { ...emptyProject(name) };
    useGraphStore.getState().loadProject(project);
    useDashboard.getState().load({ pages: [], widgets: [] });
    set({ currentId: makeId() });
    await get().saveNow();
  },

  async openProject(id) {
    const record = await projectStore.get(id);
    if (record === null) return;

    // A stored record outlives the build that wrote it, so it gets the same
    // validation as a file dragged in from disk. Skipping it here was how a
    // record from another format version reached the editor unchecked.
    const opened = readStoredProject(record.project, record.name);
    if (opened === null) return;

    useGraphStore.getState().loadProject(opened);
    set({ currentId: id });
    await metaStore.set(LAST_OPEN_KEY, id);
  },

  async duplicateProject(id) {
    const record = await projectStore.get(id);
    if (record === null) return;

    // Validate before copying, so a duplicate is never a second unreadable
    // record that fails only when someone tries to open it.
    const source = readStoredProject(record.project, record.name);
    if (source === null) return;

    const copy: ProjectRecord = {
      id: makeId(),
      name: `${record.name} copy`,
      updatedAt: new Date().toISOString(),
      project: {
        ...source,
        meta: { ...source.meta, name: `${record.name} copy` },
      },
    };
    await projectStore.put(copy);
    await get().refresh();
  },

  async renameProject(id, name) {
    const record = await projectStore.get(id);
    if (record === null) return;
    await projectStore.put({
      ...record,
      name,
      project: { ...record.project, meta: { ...record.project.meta, name } },
    });
    // Keep the open document's name in step with the renamed record.
    if (get().currentId === id) {
      const state = useGraphStore.getState();
      useGraphStore.setState({ project: { ...state.project, meta: { ...state.project.meta, name } } });
    }
    await get().refresh();
  },

  async deleteProject(id) {
    await projectStore.remove(id);
    if (get().currentId === id) set({ currentId: null });
    await get().refresh();
  },

  async openExample(exampleId) {
    const example = exampleById(exampleId);
    if (example === null) return;

    const { nodes, edges } = example.build();
    const dashboard = example.dashboard?.() ?? { pages: [], widgets: [] };
    const project: ForgeProject = {
      ...emptyProject(example.name),
      graph: { nodes, edges },
      dashboard,
    };

    useGraphStore.getState().loadProject(project);
    set({ currentId: makeId() });
    await get().saveNow();
  },

  dismissRecovery: () => set({ recoveryAvailable: false }),

  async acceptRecovery() {
    // The autosave in localStorage is the crash copy; the graph store already
    // restored it on mount, so accepting simply keeps it and persists it.
    set({ recoveryAvailable: false });
    await get().saveNow();
  },
}));

/**
 * Starts autosave and crash detection. Returns a teardown for StrictMode.
 */
export function startProjectAutosave(): () => void {
  let disposed = false;

  void (async () => {
    const crashed = await markSessionOpen();
    if (!disposed && crashed) useProjects.setState({ recoveryAvailable: true });

    const lastOpen = await metaStore.get<string>(LAST_OPEN_KEY);
    if (!disposed && lastOpen !== null) useProjects.setState({ currentId: lastOpen });
    if (!disposed) await useProjects.getState().refresh();
  })();

  const timer = setInterval(() => {
    void useProjects.getState().saveNow();
  }, AUTOSAVE_MS);

  // Saving on blur means a tab switch is a save point, not a gamble.
  const onBlur = () => void useProjects.getState().saveNow();
  const onUnload = () => {
    void useProjects.getState().saveNow();
    void markSessionClosed();
  };

  window.addEventListener('blur', onBlur);
  window.addEventListener('beforeunload', onUnload);

  return () => {
    disposed = true;
    clearInterval(timer);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('beforeunload', onUnload);
  };
}

export { examples };
