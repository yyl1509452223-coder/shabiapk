import { NativeModule, requireNativeModule } from 'expo';
import type { WallpaperOptions } from '../../../src/types';

export type SetWallpaperResult = {
  opened: boolean;
  openedBy: 'direct' | 'liveChooser' | 'systemPicker';
  requestedTarget: WallpaperOptions['target'];
  directTargetSelection: false;
};

export type WallpaperReadiness = {
  manufacturer: string;
  model: string;
  lockScreenDisplayRequired: boolean;
  lockScreenDisplayAllowed: boolean;
  overlayAllowed: boolean;
  wallpaperServiceReady: boolean;
  allRequiredReady: boolean;
};

declare class VideoWallpaperModule extends NativeModule<{}> {
  isSupported(): boolean;
  getReadiness(): WallpaperReadiness;
  openAppSettings(): Promise<void>;
  openPermissionSettings(kind: 'lockScreen' | 'overlay' | 'wallpaper'): Promise<void>;
  prepareVideoWallpaper(uri: string, fallbackPreviewUri: string | null): Promise<boolean>;
  setVideoWallpaper(
    uri: string,
    scaleMode: WallpaperOptions['scaleMode'],
    zoom: number,
    offsetX: number,
    offsetY: number,
    target: WallpaperOptions['target'],
  ): Promise<SetWallpaperResult>;
}

export default requireNativeModule<VideoWallpaperModule>('VideoWallpaper');
