import { NativeModule, requireNativeModule } from 'expo';
import type { WallpaperOptions } from '../../../src/types';

export type SetWallpaperResult = {
  opened: boolean;
  requestedTarget: WallpaperOptions['target'];
  directTargetSelection: false;
};

declare class VideoWallpaperModule extends NativeModule<{}> {
  isSupported(): boolean;
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
