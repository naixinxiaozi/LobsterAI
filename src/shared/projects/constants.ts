export const ProjectIpcChannel = {
  List: 'projects:list',
  Create: 'projects:create',
  UpdateMemory: 'projects:updateMemory',
  SelectRoot: 'projects:selectRoot',
} as const;

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  memory: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateProjectInput {
  name: string;
  rootPath: string;
}

export type ProjectListResult =
  | { success: true; projects: Project[] }
  | { success: false; error: string };

export type ProjectCreateResult =
  | { success: true; project: Project }
  | { success: false; error: string };

export type ProjectUpdateMemoryResult =
  | { success: true }
  | { success: false; error: string };

export type ProjectSelectRootResult =
  | { success: true; path: string }
  | { success: false; canceled?: boolean; error?: string };
