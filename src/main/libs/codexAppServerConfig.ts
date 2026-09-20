export const CODEX_DEEPSEEK_API_KEY_ENV = 'LOBSTERAI_DEEPSEEK_API_KEY';
export const DEFAULT_CODEX_MODEL = 'deepseek-flash';

export interface CodexHomeConfigOptions {
  model?: string;
}

export const readDotEnvValue = (contents: string, key: string): string | undefined => {
  const line = contents.split(/\r?\n/).find(candidate =>
    new RegExp(`^\\s*(?:export\\s+)?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`).test(candidate));
  if (!line) return undefined;
  const value = line.slice(line.indexOf('=') + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value.split(' #', 1)[0].trim();
};

export const buildCodexHomeConfig = ({ model = DEFAULT_CODEX_MODEL }: CodexHomeConfigOptions = {}): string => `model = "${model}"\nmodel_provider = "deepseek"\npreferred_auth_method = "apikey"\nforced_login_method = "api"\nmodel_reasoning_effort = "high"\nweb_search = "disabled"\n\n[model_providers.deepseek]\nname = "deepseek"\nbase_url = "https://api.deepseek.com/"\nwire_api = "responses"\nenv_key = "${CODEX_DEEPSEEK_API_KEY_ENV}"\n`;
