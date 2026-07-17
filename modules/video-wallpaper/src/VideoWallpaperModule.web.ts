import { registerWebModule, NativeModule } from 'expo';

// VideoWallpaperModule is not available on the web platform.
class VideoWallpaperModule extends NativeModule<{}> {}

export default registerWebModule(VideoWallpaperModule, 'VideoWallpaperModule');
