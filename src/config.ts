export interface SiteConfig {
  romBaseUrl: string;
}

let pending: Promise<SiteConfig> | null = null;

export function loadSiteConfig(): Promise<SiteConfig> {
  if (!pending) pending = readSiteConfig();
  return pending;
}

export function resolveRomUrl(rom: string, bundled: boolean, romBaseUrl: string): string {
  if (/^https?:\/\//i.test(rom)) return rom;
  const path = rom.replace(/^\/+/, '');
  if (bundled || !romBaseUrl) return siteUrl(path);
  return `${romBaseUrl}/${path}`;
}

export function biosUrls(name: string, romBaseUrl: string): string[] {
  const local = siteUrl(`bios/${name}`);
  if (!romBaseUrl) return [local];
  return [local, `${romBaseUrl}/bios/${name}`];
}

async function readSiteConfig(): Promise<SiteConfig> {
  const fromEnv = cleanBase(import.meta.env.VITE_ROM_BASE_URL);
  let fromFile = '';
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-cache' });
    if (response.ok) {
      const body = await response.json() as { romBaseUrl?: unknown };
      if (typeof body.romBaseUrl === 'string') fromFile = cleanBase(body.romBaseUrl);
    }
  } catch {
    fromFile = '';
  }
  return { romBaseUrl: fromEnv || fromFile };
}

function siteUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, window.location.href).href;
}

export function cleanBase(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.href.replace(/\/+$/, '');
  } catch {
    return '';
  }
}
