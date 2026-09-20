export const DEFAULT_SELF_HOSTED_SERVER_BASE_URL = 'http://127.0.0.1:8787';

export function resolveSelfHostedServerBaseUrl(override: string | undefined): string {
  const value = override?.trim();
  if (!value) return DEFAULT_SELF_HOSTED_SERVER_BASE_URL;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Self-hosted server URL must be an absolute HTTP(S) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Self-hosted server URL must use HTTP(S)');
  }
  if (url.username || url.password) {
    throw new Error('Self-hosted server URL must not contain credentials');
  }
  if (url.search || url.hash) {
    throw new Error('Self-hosted server URL must not contain a query or fragment');
  }
  return value.replace(/\/+$/, '');
}
