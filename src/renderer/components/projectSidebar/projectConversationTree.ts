export interface ProjectTreeProject {
  id: string;
  name: string;
  rootPath: string;
  memory?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ProjectTreeSession {
  id: string;
  title?: string;
  projectId?: string | null;
  updatedAt: number;
}

export interface ProjectConversationGroup {
  projectId: string;
  name: string;
  rootPath: string;
  sessionIds: string[];
}

export interface ProjectConversationTree {
  projects: ProjectConversationGroup[];
  temporarySessionIds: string[];
}

export const buildProjectConversationTree = (
  projects: readonly ProjectTreeProject[],
  sessions: readonly ProjectTreeSession[],
): ProjectConversationTree => {
  const sessionsByProjectId = new Map(projects.map(project => [project.id, [] as ProjectTreeSession[]]));
  const temporarySessions: ProjectTreeSession[] = [];

  for (const session of sessions) {
    const projectSessions = session.projectId
      ? sessionsByProjectId.get(session.projectId)
      : undefined;
    if (projectSessions) {
      projectSessions.push(session);
    } else {
      temporarySessions.push(session);
    }
  }

  const newestFirst = (left: ProjectTreeSession, right: ProjectTreeSession) =>
    right.updatedAt - left.updatedAt;

  return {
    projects: projects.map(project => ({
      projectId: project.id,
      name: project.name,
      rootPath: project.rootPath,
      sessionIds: (sessionsByProjectId.get(project.id) ?? [])
        .sort(newestFirst)
        .map(session => session.id),
    })),
    temporarySessionIds: temporarySessions.sort(newestFirst).map(session => session.id),
  };
};
