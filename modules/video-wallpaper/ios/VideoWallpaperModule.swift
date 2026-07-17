import ExpoModulesCore

public class VideoWallpaperModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VideoWallpaper")

    Function("isSupported") {
      false
    }

    AsyncFunction("setVideoWallpaper") { (_: String, _: String, _: Double, _: Double, _: Double, _: String) in
      throw NSError(
        domain: "VideoWallpaper",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "iPhone 不允许第三方 App 自动设置连续视频壁纸"]
      )
    }
  }
}
