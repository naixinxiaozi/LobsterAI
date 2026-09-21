import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';

import {
  type CreateProjectInput,
  ProjectIpcChannel,
} from '../../../shared/projects/constants';
import type { ProjectStore } from '../../projects/projectStore';

interface ProjectHandlerDeps {
  getProjectStore: () => ProjectStore;
}

const selectedProjectRoots = new Set<string>();

const resolveProjectRoot = (input: string): string => {
  const resolved = fs.realpathSync.native(path.resolve(input));
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error('Selected project root is not a directory.');
  }
  if (path.parse(resolved).root === resolved) {
    throw new Error('A drive or filesystem root cannot be used as a project.');
  }
  return resolved;
};

export function registerProjectHandlers({ getProjectStore }: ProjectHandlerDeps): void {
  ipcMain.handle(ProjectIpcChannel.List, () => {
    try {
      return { success: true, projects: getProjectStore().listProjects() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list projects.',
      };
    }
  });

  ipcMain.handle(ProjectIpcChannel.SelectRoot, async event => {
    try {
      const owner = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] };
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths[0]) {
        return { success: false, canceled: true };
      }
      const rootPath = resolveProjectRoot(result.filePaths[0]);
      selectedProjectRoots.add(rootPath);
      return { success: true, path: rootPath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to select a project root.',
      };
    }
  });

  ipcMain.handle(ProjectIpcChannel.Create, (_event, input: CreateProjectInput) => {
    try {
      const rootPath = resolveProjectRoot(input?.rootPath ?? '');
      if (!selectedProjectRoots.delete(rootPath)) {
        throw new Error('Select the project folder before creating the project.');
      }
      const project = getProjectStore().createProject({
        name: input?.name ?? '',
        rootPath,
      });
      return { success: true, project };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create the project.',
      };
    }
  });

  ipcMain.handle(
    ProjectIpcChannel.UpdateMemory,
    (_event, input: { projectId: string; content: string }) => {
      try {
        getProjectStore().updateMemory(input?.projectId ?? '', input?.content ?? '');
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update project memory.',
        };
      }
    },
  );
}
