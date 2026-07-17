import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import type { ServerSettings, WallpaperItem } from './types';
import { DEFAULT_ACCESS_KEY, DEFAULT_SERVER_URL } from './defaultConfig';

const SERVER_URL_KEY = 'shabi-server-url';
const ACCESS_KEY_KEY = 'shabi-access-key';
const WALLPAPER_FRAME_RATE_KEY = 'shabi-wallpaper-frame-rate';
const rootDirectory = new Directory(Paths.document, 'shabi-wallpapers');
const videoDirectory = new Directory(rootDirectory, 'videos');
const previewDirectory = new Directory(rootDirectory, 'previews');
const libraryFile = new File(rootDirectory, 'library.json');

export function ensureLibraryDirectories() {
  if (!rootDirectory.exists) rootDirectory.create({ intermediates: true, idempotent: true });
  if (!videoDirectory.exists) videoDirectory.create({ intermediates: true, idempotent: true });
  if (!previewDirectory.exists) previewDirectory.create({ intermediates: true, idempotent: true });
}

export async function loadServerSettings(): Promise<ServerSettings> {
  const [serverUrl, accessKey] = await Promise.all([
    SecureStore.getItemAsync(SERVER_URL_KEY),
    SecureStore.getItemAsync(ACCESS_KEY_KEY),
  ]);
  const settings = {
    serverUrl: serverUrl?.trim() || DEFAULT_SERVER_URL,
    accessKey: accessKey?.trim() || DEFAULT_ACCESS_KEY,
  };
  if (!serverUrl?.trim() || !accessKey?.trim()) await saveServerSettings(settings);
  return settings;
}

export async function saveServerSettings(settings: ServerSettings) {
  await Promise.all([
    SecureStore.setItemAsync(SERVER_URL_KEY, settings.serverUrl.trim().replace(/\/+$/, '')),
    SecureStore.setItemAsync(ACCESS_KEY_KEY, settings.accessKey.trim()),
  ]);
}

export async function loadWallpaperFrameRate(): Promise<number | null> {
  const stored = await SecureStore.getItemAsync(WALLPAPER_FRAME_RATE_KEY);
  if (!stored) return null;
  const value = Number(stored);
  return Number.isFinite(value) ? value : null;
}

export async function saveWallpaperFrameRate(frameRate: number) {
  await SecureStore.setItemAsync(WALLPAPER_FRAME_RATE_KEY, String(Math.round(frameRate)));
}

export async function loadLibrary(): Promise<WallpaperItem[]> {
  ensureLibraryDirectories();
  if (!libraryFile.exists) return [];
  try {
    const parsed = JSON.parse(await libraryFile.text()) as WallpaperItem[];
    if (!Array.isArray(parsed)) return [];
    const existing = parsed.filter((item) => item?.videoUri && new File(item.videoUri).exists);
    if (existing.length !== parsed.length) await saveLibrary(existing);
    return existing.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  } catch {
    return [];
  }
}

export async function saveLibrary(items: WallpaperItem[]) {
  ensureLibraryDirectories();
  if (!libraryFile.exists) libraryFile.create({ intermediates: true });
  libraryFile.write(JSON.stringify(items, null, 2));
}

export function videoDestination(id: string) {
  ensureLibraryDirectories();
  return new File(videoDirectory, `${id}.mp4`);
}

export function previewDestination(id: string) {
  ensureLibraryDirectories();
  return new File(previewDirectory, `${id}.jpg`);
}

export async function importLocalVideo() {
  ensureLibraryDirectories();
  const result = await File.pickFileAsync({ mimeTypes: ['video/mp4', 'video/*'] });
  if (result.canceled) return null;
  const id = `local-${Date.now()}`;
  const destination = videoDestination(id);
  await result.result.copy(destination, { overwrite: true });
  return {
    id,
    title: result.result.name.replace(/\.[^.]+$/, '') || '本地视频',
    source: 'local' as const,
    videoUri: destination.uri,
    fileSize: destination.size,
    addedAt: new Date().toISOString(),
  } satisfies WallpaperItem;
}

export function deleteWallpaperFiles(item: WallpaperItem) {
  const video = new File(item.videoUri);
  if (video.exists) video.delete();
  if (item.previewUri) {
    const preview = new File(item.previewUri);
    if (preview.exists) preview.delete();
  }
}
