import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Project } from '@shared/projects/constants';

interface ProjectState {
  projects: Project[];
  selectedProjectId: string | null;
  loading: boolean;
  error: string | null;
}

const initialState: ProjectState = {
  projects: [],
  selectedProjectId: null,
  loading: false,
  error: null,
};

const projectSlice = createSlice({
  name: 'project',
  initialState,
  reducers: {
    setProjects(state, action: PayloadAction<Project[]>) {
      state.projects = action.payload;
    },
    addProject(state, action: PayloadAction<Project>) {
      state.projects.unshift(action.payload);
    },
    updateProjectMemory(
      state,
      action: PayloadAction<{ projectId: string; content: string }>,
    ) {
      const project = state.projects.find(item => item.id === action.payload.projectId);
      if (project) {
        project.memory = action.payload.content;
        project.updatedAt = Date.now();
      }
    },
    selectProject(state, action: PayloadAction<string | null>) {
      state.selectedProjectId = action.payload;
    },
    setProjectLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    setProjectError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
  },
});

export const {
  addProject,
  selectProject,
  setProjectError,
  setProjectLoading,
  setProjects,
  updateProjectMemory,
} = projectSlice.actions;

export default projectSlice.reducer;
