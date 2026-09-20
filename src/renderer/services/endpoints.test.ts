import { afterEach, expect, test, vi } from 'vitest';

import { configService } from './config';
import {
  getEnterpriseBillingUrl,
  getEnterpriseMemberProfileUrl,
  getEnterpriseOverviewUrl,
  getEnterpriseRechargeUrl,
  getEnterpriseUsageUrl,
  getPortalCreditsDetailUrl,
  getPortalCreditsResetActivityUrl,
  getPortalInvitationUrl,
  getPortalPricingUrl,
  getPortalProfileUrl,
  getPortalRechargeUrl,
  getSelfHostedBaseUrl,
  PortalPricingKeyfrom,
} from './endpoints';

const mockTestMode = (testMode: boolean) => {
  vi.spyOn(configService, 'getConfig').mockReturnValue({
    app: { testMode },
  } as ReturnType<typeof configService.getConfig>);
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test('portal account urls use the self-hosted base when test mode is disabled', () => {
  mockTestMode(false);

  expect(getPortalProfileUrl()).toBe('http://127.0.0.1:8787/portal/profile');
  expect(getPortalCreditsDetailUrl()).toBe('http://127.0.0.1:8787/portal/profile/detail');
  expect(getPortalRechargeUrl()).toBe('http://127.0.0.1:8787/portal/');
  expect(getPortalInvitationUrl()).toBe('http://127.0.0.1:8787/portal/invitation');
  expect(getPortalCreditsResetActivityUrl()).toBe(
    'http://127.0.0.1:8787/portal/profile?activity=credits_reset',
  );
  expect(getPortalCreditsResetActivityUrl('credits_final_reward_2026_07')).toBe(
    'http://127.0.0.1:8787/portal/profile?activity=credits_reset&campaignCode=credits_final_reward_2026_07',
  );
});

test('portal account urls use the same self-hosted base in test mode', () => {
  mockTestMode(true);

  expect(getPortalProfileUrl()).toBe('http://127.0.0.1:8787/portal/profile');
  expect(getPortalCreditsDetailUrl()).toBe('http://127.0.0.1:8787/portal/profile/detail');
  expect(getPortalRechargeUrl()).toBe('http://127.0.0.1:8787/portal/');
  expect(getPortalInvitationUrl()).toBe('http://127.0.0.1:8787/portal/invitation');
  expect(getPortalCreditsResetActivityUrl()).toBe(
    'http://127.0.0.1:8787/portal/profile?activity=credits_reset',
  );
});

test('portal pricing url can include html share keyfrom', () => {
  mockTestMode(false);

  expect(getPortalPricingUrl(PortalPricingKeyfrom.HtmlShare)).toBe(
    'http://127.0.0.1:8787/portal/pricing?keyfrom=html_share',
  );
});

test('portal pricing url can carry a publishing attribution trace', () => {
  mockTestMode(false);

  expect(getPortalPricingUrl(PortalPricingKeyfrom.SiteDeployment, { traceId: 'attempt-123' })).toBe(
    'http://127.0.0.1:8787/portal/pricing?keyfrom=site_deployment&trace_id=attempt-123',
  );
});

test('enterprise console urls use the selected enterprise context', () => {
  mockTestMode(false);

  expect(getEnterpriseMemberProfileUrl(1001)).toBe(
    'http://127.0.0.1:8787/portal/enterprise/profile/1001',
  );
  expect(getEnterpriseOverviewUrl(1001)).toBe(
    'http://127.0.0.1:8787/portal/enterprise/console/1001/overview',
  );
  expect(getEnterpriseUsageUrl(1001)).toBe(
    'http://127.0.0.1:8787/portal/enterprise/console/1001/usage',
  );
  expect(getEnterpriseBillingUrl(1001)).toBe(
    'http://127.0.0.1:8787/portal/enterprise/console/1001/billing',
  );
  expect(getEnterpriseRechargeUrl(1001)).toBe(
    'http://127.0.0.1:8787/portal/enterprise/console/1001/recharge',
  );
});

test('normalizes an explicit self-hosted build URL', () => {
  vi.stubEnv('VITE_LOBSTER_SERVER_BASE_URL', ' https://auth.example.test/lobster/ ');

  expect(getSelfHostedBaseUrl()).toBe('https://auth.example.test/lobster');
  expect(getPortalProfileUrl()).toBe('https://auth.example.test/lobster/portal/profile');
});
