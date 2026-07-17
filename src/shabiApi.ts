import type { RemoteJob, ServerSettings } from './types';

const API_KEY_HEADER = 'X-Shabi-Key';

export function normalizeServerUrl(value: string) {
  const text = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(text)) {
    throw new Error('服务器地址必须以 http:// 或 https:// 开头。');
  }
  return text;
}

export function extractWorkshopId(value: string) {
  const text = value.trim();
  if (/^\d{6,20}$/.test(text)) return text;
  const match = text.match(/(?:[?&]id=|\/filedetails\/)(\d{6,20})/i);
  return match?.[1] ?? null;
}

export function apiHeaders(settings: ServerSettings) {
  return {
    [API_KEY_HEADER]: settings.accessKey.trim(),
  };
}

async function readError(response: Response) {
  try {
    const data = (await response.json()) as { error?: string; message?: string };
    return data.error || data.message || `服务器返回 ${response.status}`;
  } catch {
    return `服务器返回 ${response.status}`;
  }
}

async function request<T>(settings: ServerSettings, path: string, init?: RequestInit): Promise<T> {
  const baseUrl = normalizeServerUrl(settings.serverUrl);
  if (!settings.accessKey.trim()) throw new Error('请先填写访问密钥。');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...apiHeaders(settings),
        ...init?.headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('连接服务器超时，请检查地址和网络。');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function testServer(settings: ServerSettings) {
  const result = await request<{ status: string; service: string }>(settings, '/api/status');
  if (result.status !== 'ok') throw new Error('服务器返回了无法识别的状态。');
  return result;
}

export function createJob(settings: ServerSettings, urlOrId: string) {
  return request<RemoteJob>(settings, '/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ UrlOrId: urlOrId }),
  });
}

export function getJob(settings: ServerSettings, workshopId: string) {
  return request<RemoteJob>(settings, `/api/jobs/${encodeURIComponent(workshopId)}`);
}

export function fileUrl(settings: ServerSettings, workshopId: string) {
  return `${normalizeServerUrl(settings.serverUrl)}/api/files/${encodeURIComponent(workshopId)}`;
}

export function previewUrl(settings: ServerSettings, workshopId: string) {
  return `${normalizeServerUrl(settings.serverUrl)}/api/previews/${encodeURIComponent(workshopId)}`;
}
