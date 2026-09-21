import {
  ChatBubbleLeftRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { projectService } from '../../services/projects';
import type { RootState } from '../../store';
import type { CoworkSessionSummary } from '../../types/cowork';
import { buildProjectConversationTree } from './projectConversationTree';

interface ProjectConversationSidebarProps {
  sessions: CoworkSessionSummary[];
  currentSessionId: string | null;
  onSelectSession: (session: CoworkSessionSummary) => void | Promise<void>;
  onNewConversation: (projectId: string | null) => void;
}

const ProjectConversationSidebar: React.FC<ProjectConversationSidebarProps> = ({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewConversation,
}) => {
  const { projects, loading, error } = useSelector((state: RootState) => state.project);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isCreating, setIsCreating] = useState(false);
  const [projectName, setProjectName] = useState('');

  useEffect(() => {
    void projectService.loadProjects();
  }, []);

  useEffect(() => {
    setExpandedIds(previous => {
      const next = new Set(previous);
      projects.forEach(project => next.add(project.id));
      return next;
    });
  }, [projects]);

  const tree = useMemo(
    () => buildProjectConversationTree(projects, sessions),
    [projects, sessions],
  );
  const sessionsById = useMemo(
    () => new Map(sessions.map(session => [session.id, session])),
    [sessions],
  );

  const createProject = async () => {
    const name = projectName.trim();
    if (!name) return;
    if (await projectService.createProject(name)) {
      setProjectName('');
      setIsCreating(false);
    }
  };

  const renderSession = (sessionId: string) => {
    const session = sessionsById.get(sessionId);
    if (!session) return null;
    const active = session.id === currentSessionId;
    return (
      <button
        key={session.id}
        type="button"
        onClick={() => void onSelectSession(session)}
        className={`flex h-7 w-full items-center gap-2 rounded-md pl-7 pr-2 text-left text-sm transition-colors ${
          active
            ? 'bg-black/[0.06] font-medium dark:bg-white/[0.07]'
            : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
        }`}
      >
        <ChatBubbleLeftRightIcon className="h-3.5 w-3.5 shrink-0 text-secondary" />
        <span className="min-w-0 truncate">{session.title}</span>
      </button>
    );
  };

  return (
    <section className="py-2" aria-label={i18nService.t('projectsAndConversations')}>
      <div className="mb-1 flex items-center justify-between px-1.5">
        <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-secondary">
          {i18nService.t('projectsAndConversations')}
        </h2>
        <button
          type="button"
          onClick={() => setIsCreating(value => !value)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-secondary hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]"
          aria-label={i18nService.t('createProject')}
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>

      {isCreating && (
        <form
          className="mb-2 flex gap-1 px-1.5"
          onSubmit={event => {
            event.preventDefault();
            void createProject();
          }}
        >
          <input
            autoFocus
            value={projectName}
            onChange={event => setProjectName(event.target.value)}
            placeholder={i18nService.t('projectNamePlaceholder')}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={!projectName.trim()}
            className="rounded-md bg-primary px-2 text-xs text-white disabled:opacity-50"
          >
            {i18nService.t('create')}
          </button>
        </form>
      )}

      {loading && projects.length === 0 && (
        <p className="px-2 py-2 text-xs text-secondary">{i18nService.t('loading')}</p>
      )}
      {error && <p className="px-2 py-1 text-xs text-red-500">{error}</p>}

      <div className="space-y-1">
        {tree.projects.map(group => {
          const expanded = expandedIds.has(group.projectId);
          return (
            <div key={group.projectId}>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setExpandedIds(previous => {
                    const next = new Set(previous);
                    if (expanded) next.delete(group.projectId);
                    else next.add(group.projectId);
                    return next;
                  })}
                  className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-sm font-medium hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  title={group.rootPath}
                >
                  {expanded
                    ? <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" />
                    : <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" />}
                  <FolderIcon className="h-4 w-4 shrink-0 text-secondary" />
                  <span className="min-w-0 truncate">{group.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNewConversation(group.projectId)}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]"
                  aria-label={i18nService.t('createNewChat')}
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              {expanded && group.sessionIds.map(renderSession)}
            </div>
          );
        })}

        <div>
          <div className="flex items-center gap-0.5">
            <div className="flex h-7 min-w-0 flex-1 items-center gap-2 px-1.5 text-sm font-medium">
              <ChatBubbleLeftRightIcon className="h-4 w-4 shrink-0 text-secondary" />
              <span className="truncate">{i18nService.t('temporaryConversations')}</span>
            </div>
            <button
              type="button"
              onClick={() => onNewConversation(null)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.05]"
              aria-label={i18nService.t('createNewChat')}
            >
              <PlusIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          {tree.temporarySessionIds.length > 0
            ? tree.temporarySessionIds.map(renderSession)
            : <p className="py-1 pl-7 pr-2 text-xs text-secondary">{i18nService.t('noConversations')}</p>}
        </div>
      </div>
    </section>
  );
};

export default ProjectConversationSidebar;
