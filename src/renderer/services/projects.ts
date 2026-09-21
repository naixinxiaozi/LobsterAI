import { store } from '../store';
import {
  addProject,
  selectProject,
  setProjectError,
  setProjectLoading,
  setProjects,
  updateProjectMemory as updateProjectMemoryAction,
} from '../store/slices/projectSlice';

class ProjectService {
  async loadProjects(): Promise<void> {
    store.dispatch(setProjectLoading(true));
    store.dispatch(setProjectError(null));
    try {
      const result = await window.electron.projects.list();
      if (!result.success) throw new Error(result.error);
      store.dispatch(setProjects(result.projects));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load projects.';
      store.dispatch(setProjectError(message));
      console.error('[Projects] failed to load projects:', error);
    } finally {
      store.dispatch(setProjectLoading(false));
    }
  }

  async createProject(name: string): Promise<boolean> {
    store.dispatch(setProjectError(null));
    const selectedRoot = await window.electron.projects.selectRoot();
    if (!selectedRoot.success) {
      if (selectedRoot.error) store.dispatch(setProjectError(selectedRoot.error));
      return false;
    }
    const result = await window.electron.projects.create({ name, rootPath: selectedRoot.path });
    if (!result.success) {
      store.dispatch(setProjectError(result.error));
      return false;
    }
    store.dispatch(addProject(result.project));
    store.dispatch(selectProject(result.project.id));
    return true;
  }

  async updateMemory(projectId: string, content: string): Promise<boolean> {
    const result = await window.electron.projects.updateMemory(projectId, content);
    if (!result.success) {
      store.dispatch(setProjectError(result.error));
      return false;
    }
    store.dispatch(updateProjectMemoryAction({ projectId, content }));
    return true;
  }

  selectProject(projectId: string | null): void {
    store.dispatch(selectProject(projectId));
  }
}

export const projectService = new ProjectService();
