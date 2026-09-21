import { expect, test } from 'vitest';

import { buildProjectConversationTree } from './projectConversationTree';

test('groups conversations by project and keeps unassigned conversations temporary', () => {
  const tree = buildProjectConversationTree(
    [
      {
        id: 'p1',
        name: 'Finance',
        rootPath: 'E:/finance',
        memory: '',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    [
      { id: 's1', title: 'Budget', projectId: 'p1', updatedAt: 3 },
      { id: 's2', title: 'Quick question', projectId: null, updatedAt: 2 },
    ],
  );

  expect(tree).toEqual({
    projects: [
      {
        projectId: 'p1',
        name: 'Finance',
        rootPath: 'E:/finance',
        sessionIds: ['s1'],
      },
    ],
    temporarySessionIds: ['s2'],
  });
});

test('treats conversations with a missing project as temporary without inheriting a root', () => {
  const tree = buildProjectConversationTree([], [
    { id: 'orphan', title: 'Orphaned', projectId: 'missing', updatedAt: 1 },
  ]);

  expect(tree.projects).toEqual([]);
  expect(tree.temporarySessionIds).toEqual(['orphan']);
});
