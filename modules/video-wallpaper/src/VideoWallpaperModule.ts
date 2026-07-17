import { NativeModule, requireNativeModule } from 'expo';
import type { WallpaperOptions } from '../../../src/types';

export type SetWallpaperResult = {
  opened: boolean;
  openedBy: 'direct' | 'liveChooser' | 'systemPicker';
  requestedTarget: WallpaperOptions['target'];
  directTargetSelection: false;
};

export type WallpaperReadiness = {
  wallpaperSupported: boolean;
  setWallpaperAllowed: boolean;
  batteryOptimizationIgnored: boolean;
};

declare class VideoWallpaperModule extends NativeModule<{}> {
  isSupported(): boolean;
  getReadiness(): WallpaperReadiness;
  openAppSettings(): Promise<void>;
  openBatterySettings(): Promise<void>;
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
