export const CodexWebSearchMode = {
  Cached: 'cached',
  Live: 'live',
} as const;

export type CodexWebSearchMode = typeof CodexWebSearchMode[keyof typeof CodexWebSearchMode];

export interface CodexHomeConfigOptions {
  webSearch?: CodexWebSearchMode;
}

export const renderCodexWebSearchConfig = (mode: CodexWebSearchMode): string =>
  `web_search = "${mode}"\n`;

export const buildCodexHomeConfig = ({
  webSearch = CodexWebSearchMode.Cached,
}: CodexHomeConfigOptions = {}): string => renderCodexWebSearchConfig(webSearch);
