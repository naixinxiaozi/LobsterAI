/**
 * 集中管理所有业务 API 端点。
 * 后续新增的业务接口也应在此文件中配置。
 */

import { configService } from './config';

const DEFAULT_SELF_HOSTED_BASE_URL = 'http://127.0.0.1:8787';

const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/, '');

export const getSelfHostedBaseUrl = (): string => {
  const configured = normalizeBaseUrl(import.meta.env.VITE_LOBSTER_SERVER_BASE_URL || '');
  return configured || DEFAULT_SELF_HOSTED_BASE_URL;
};

export const isTestModeEnabled = () => {
  return configService.getConfig().app?.testMode === true;
};

// 自动更新
export const getUpdateCheckUrl = () =>
  isTestModeEnabled()
    ? `${getSelfHostedBaseUrl()}/api/update/test`
    : `${getSelfHostedBaseUrl()}/api/update/prod`;

// 手动检查更新
export const getManualUpdateCheckUrl = () =>
  isTestModeEnabled()
    ? `${getSelfHostedBaseUrl()}/api/update/test-manual`
    : `${getSelfHostedBaseUrl()}/api/update/prod-manual`;

export const getFallbackDownloadUrl = () =>
  isTestModeEnabled()
    ? `${getSelfHostedBaseUrl()}/download-list`
    : `${getSelfHostedBaseUrl()}/download-list`;

// Skill 商店
export const getSkillStoreUrl = () =>
  isTestModeEnabled()
    ? `${getSelfHostedBaseUrl()}/api/skills/store/test`
    : `${getSelfHostedBaseUrl()}/api/skills/store/prod`;

// Kit 商店
export const getKitStoreUrl = () =>
  isTestModeEnabled()
    ? `${getSelfHostedBaseUrl()}/api/kits/store/test`
    : `${getSelfHostedBaseUrl()}/api/kits/store/prod`;

// 登录地址
export const getLoginOvermindUrl = () =>
  isTestModeEnabled() ? `${getSelfHostedBaseUrl()}/login` : `${getSelfHostedBaseUrl()}/login`;

// Portal 页面
const getPortalBase = () => `${getSelfHostedBaseUrl()}/portal`;

export const PortalPricingKeyfrom = {
  HtmlShare: 'html_share',
  SiteDeployment: 'site_deployment',
} as const;

export type PortalPricingKeyfrom = (typeof PortalPricingKeyfrom)[keyof typeof PortalPricingKeyfrom];

export interface PortalPricingUrlOptions {
  traceId?: string;
}

export const getPortalLoginUrl = () => `${getSelfHostedBaseUrl()}/login`;
export const getPortalPricingUrl = (
  keyfrom?: PortalPricingKeyfrom,
  options: PortalPricingUrlOptions = {},
) => {
  const query = new URLSearchParams();
  if (keyfrom) query.set('keyfrom', keyfrom);
  if (options.traceId) query.set('trace_id', options.traceId);
  const queryString = query.toString();
  const suffix = queryString ? `?${queryString}` : '';
  return `${getPortalBase()}/pricing${suffix}`;
};
export const getPortalProfileUrl = () => `${getPortalBase()}/profile`;
export const getPortalCreditsDetailUrl = () => `${getPortalBase()}/profile/detail`;
export const getPortalRechargeUrl = () => `${getPortalBase()}/`;
export const getPortalInvitationUrl = () => `${getPortalBase()}/invitation`;
export const getPortalCreditsResetActivityUrl = (campaignCode?: string) =>
  `${getPortalBase()}/profile?activity=credits_reset${campaignCode ? `&campaignCode=${encodeURIComponent(campaignCode)}` : ''}`;

export const getEnterpriseMemberProfileUrl = (enterpriseId: number) =>
  `${getPortalBase()}/enterprise/profile/${encodeURIComponent(String(enterpriseId))}`;

const getEnterpriseConsoleBaseUrl = (enterpriseId: number) =>
  `${getPortalBase()}/enterprise/console/${encodeURIComponent(String(enterpriseId))}`;

export const getEnterpriseOverviewUrl = (enterpriseId: number) =>
  `${getEnterpriseConsoleBaseUrl(enterpriseId)}/overview`;

export const getEnterpriseUsageUrl = (enterpriseId: number) =>
  `${getEnterpriseConsoleBaseUrl(enterpriseId)}/usage`;

export const getEnterpriseBillingUrl = (enterpriseId: number) =>
  `${getEnterpriseConsoleBaseUrl(enterpriseId)}/billing`;

export const getEnterpriseRechargeUrl = (enterpriseId: number) =>
  `${getEnterpriseConsoleBaseUrl(enterpriseId)}/recharge`;
