package expo.modules.videowallpaper

import android.app.WallpaperManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class VideoWallpaperModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("VideoWallpaper")

    Function("isSupported") {
      val manager = WallpaperManager.getInstance(context)
      manager.isWallpaperSupported && manager.isSetWallpaperAllowed
    }

    AsyncFunction("setVideoWallpaper") {
        uri: String,
        scaleMode: String,
        zoom: Double,
        offsetX: Double,
        offsetY: Double,
        target: String ->
      val parsedUri = Uri.parse(uri)
      if (parsedUri.scheme != "file" || parsedUri.path.isNullOrBlank()) {
        throw IllegalArgumentException("动态壁纸必须先下载到手机")
      }
      if (!File(parsedUri.path!!).exists()) {
        throw IllegalArgumentException("视频文件不存在，请重新下载")
      }

      val safeMode = scaleMode.takeIf { it in SCALE_MODES } ?: "cover"
      val safeTarget = target.takeIf { it in TARGETS } ?: "home"
      context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_VIDEO_URI, uri)
        .putString(KEY_SCALE_MODE, safeMode)
        .putFloat(KEY_ZOOM, zoom.toFloat().coerceIn(1f, 3f))
        .putFloat(KEY_OFFSET_X, offsetX.toFloat().coerceIn(-1f, 1f))
        .putFloat(KEY_OFFSET_Y, offsetY.toFloat().coerceIn(-1f, 1f))
        .putString(KEY_TARGET, safeTarget)
        .apply()

      val component = ComponentName(context, VideoWallpaperService::class.java)
      val directPreviewIntent = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER).apply {
        putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component)
      }
      val chooserIntent = Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER)
      val activity = appContext.throwingActivity
      val packageManager = activity.packageManager

      // Some Android skins silently ignore the direct component preview. Opening the
      // system live-wallpaper chooser from the foreground activity is more reliable.
      val launchIntent = when {
        chooserIntent.resolveActivity(packageManager) != null -> chooserIntent
        directPreviewIntent.resolveActivity(packageManager) != null -> directPreviewIntent
        else -> throw ActivityNotFoundException("系统没有可用的动态壁纸选择器")
      }
      activity.startActivity(launchIntent)

      mapOf(
        "opened" to true,
        "requestedTarget" to safeTarget,
        "directTargetSelection" to false
      )
    }.runOnQueue(Queues.MAIN)
  }

  companion object {
    const val PREFERENCES_NAME = "shabi_video_wallpaper"
    const val KEY_VIDEO_URI = "video_uri"
    const val KEY_SCALE_MODE = "scale_mode"
    const val KEY_ZOOM = "zoom"
    const val KEY_OFFSET_X = "offset_x"
    const val KEY_OFFSET_Y = "offset_y"
    const val KEY_TARGET = "target"
    private val SCALE_MODES = setOf("cover", "contain", "stretch", "custom")
    private val TARGETS = setOf("home", "lock", "both")
  }
}
