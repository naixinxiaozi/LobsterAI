import { app } from 'electron';

import { HtmlSharePublicRoute } from '../../shared/htmlShare/constants';
import type { SqliteStore } from '../sqliteStore';
import { resolveSelfHostedServerBaseUrl } from './selfHostedServerBaseUrl';

let cachedTestMode: boolean | null = null;
let loggedDevelopmentServerBaseUrl: string | null = null;

/**
 * Read testMode from store and cache it.
 * Call once at startup and again whenever app_config changes.
 */
export function refreshEndpointsTestMode(store: SqliteStore): void {
  const appConfig = store.get<any>('app_config');
  cachedTestMode = appConfig?.app?.testMode === true;
}

/**
 * Whether the app is in test mode.
 * Uses cached value after init; falls back to !app.isPackaged before init.
 */
export const isTestModeEnabled = (): boolean => {
  return cachedTestMode ?? !app.isPackaged;
};

/**
 * Server API base URL — uses the configured self-hosted service.
 * Used for auth exchange/refresh, models, proxy, etc.
 */
export const getServerApiBaseUrl = (): string => {
  const defaultBaseUrl = 'http://127.0.0.1:8787';
  const serverBaseUrl =
    resolveSelfHostedServerBaseUrl(process.env.LOBSTER_SERVER_BASE_URL) || defaultBaseUrl;
  if (serverBaseUrl !== defaultBaseUrl && loggedDevelopmentServerBaseUrl !== serverBaseUrl) {
    console.warn(
      `[Endpoints] routing all Lobster server traffic to development origin ${serverBaseUrl}`,
    );
    loggedDevelopmentServerBaseUrl = serverBaseUrl;
  }
  return serverBaseUrl;
};

export const getHtmlSharePublicBaseUrl = (): string => {
  return `${getServerApiBaseUrl()}${HtmlSharePublicRoute.Root}`;
};

export const getUpdateCheckUrl = (): string =>
  `${getServerApiBaseUrl()}/api/update/${isTestModeEnabled() ? 'test' : 'prod'}`;

export const getManualUpdateCheckUrl = (): string =>
  `${getServerApiBaseUrl()}/api/update/${isTestModeEnabled() ? 'test-manual' : 'prod-manual'}`;

export const getFallbackDownloadUrl = (): string => `${getServerApiBaseUrl()}/download-list`;

export const getSkillStoreUrl = (): string =>
  `${getServerApiBaseUrl()}/api/skills/store/${isTestModeEnabled() ? 'test' : 'prod'}`;

// Portal 页面
const getPortalBase = (): string => `${getServerApiBaseUrl()}/portal`;

export const getPortalTasksUrl = (): string => `${getPortalBase()}/profile/detail?tab=tasks`;

export const getKitStoreUrl = (): string =>
  `${getServerApiBaseUrl()}/api/kits/store/${isTestModeEnabled() ? 'test' : 'prod'}`;
