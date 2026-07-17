export type WallpaperSource = 'steam' | 'local';

export type ScaleMode = 'cover' | 'contain' | 'stretch' | 'custom';

export type WallpaperTarget = 'home' | 'lock' | 'both';

export type ServerSettings = {
  serverUrl: string;
  accessKey: string;
};

export type WallpaperItem = {
  id: string;
  workshopId?: string;
  title: string;
  source: WallpaperSource;
  videoUri: string;
  previewUri?: string;
  fileSize?: number;
  addedAt: string;
};

export type RemoteJob = {
  id: string;
  status: 'queued' | 'downloading' | 'ready' | 'failed' | string;
  progress: number;
  message?: string | null;
  title?: string | null;
  fileName?: string | null;
  downloadUrl?: string | null;
  previewUrl?: string | null;
};

export type WallpaperOptions = {
  uri: string;
  scaleMode: ScaleMode;
  zoom: number;
  offsetX: number;
  offsetY: number;
  target: WallpaperTarget;
};
