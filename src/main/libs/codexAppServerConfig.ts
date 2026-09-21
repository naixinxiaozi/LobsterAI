export const CodexWebSearchMode = {
  Cached: 'cached',
  Live: 'live',
} as const;

export type CodexWebSearchMode = typeof CodexWebSearchMode[keyof typeof CodexWebSearchMode];

export interface CodexHomeConfigOptions {
  webSearch?: CodexWebSearchMode;
}

export const buildCodexHomeConfig = ({
  webSearch = CodexWebSearchMode.Cached,
}: CodexHomeConfigOptions = {}): string => `web_search = "${webSearch}"\n`;
