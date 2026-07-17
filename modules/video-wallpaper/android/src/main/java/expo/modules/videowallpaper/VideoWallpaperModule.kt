package expo.modules.videowallpaper

import android.Manifest
import android.app.AppOpsManager
import android.app.WallpaperManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max

class VideoWallpaperModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("VideoWallpaper")

    Function("isSupported") {
      val manager = WallpaperManager.getInstance(context)
      manager.isWallpaperSupported && manager.isSetWallpaperAllowed
    }

    Function("getReadiness") {
      val manager = WallpaperManager.getInstance(context)
      val lockScreenRequired = isXiaomiFamily()
      val lockScreenAllowed = !lockScreenRequired || isXiaomiLockScreenDisplayAllowed()
      val overlayAllowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)
      val wallpaperServiceReady = manager.isWallpaperSupported &&
        manager.isSetWallpaperAllowed &&
        isWallpaperServiceEnabled()
      mapOf(
        "manufacturer" to Build.MANUFACTURER.orEmpty(),
        "model" to Build.MODEL.orEmpty(),
        "lockScreenDisplayRequired" to lockScreenRequired,
        "lockScreenDisplayAllowed" to lockScreenAllowed,
        "overlayAllowed" to overlayAllowed,
        "wallpaperServiceReady" to wallpaperServiceReady,
        "allRequiredReady" to (lockScreenAllowed && overlayAllowed && wallpaperServiceReady)
      )
    }

    AsyncFunction("openAppSettings") {
      appContext.throwingActivity.startActivity(appDetailsIntent())
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("openPermissionSettings") { kind: String ->
      val activity = appContext.throwingActivity
      val intents = when (kind) {
        "overlay" -> listOf(
          Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}")),
          appDetailsIntent()
        )
        "lockScreen", "wallpaper" -> vendorPermissionIntents() + appDetailsIntent()
        else -> listOf(appDetailsIntent())
      }
      startFirstAvailable(activity, intents)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("prepareVideoWallpaper") { uri: String, fallbackPreviewUri: String? ->
      prepareFirstFrame(uri, fallbackPreviewUri)
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
      val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      val editor = preferences.edit()
        .putString(KEY_VIDEO_URI, uri)
        .putString(KEY_SCALE_MODE, safeMode)
        .putFloat(KEY_ZOOM, zoom.toFloat().coerceIn(1f, 3f))
        .putFloat(KEY_OFFSET_X, offsetX.toFloat().coerceIn(-1f, 1f))
        .putFloat(KEY_OFFSET_Y, offsetY.toFloat().coerceIn(-1f, 1f))
        .putString(KEY_TARGET, safeTarget)
      if (preferences.getString(KEY_PREPARED_VIDEO_URI, null) != uri) {
        editor.remove(KEY_PREPARED_VIDEO_URI).remove(KEY_PREVIEW_FRAME_PATH)
      }
      editor.commit()

      val component = ComponentName(context, VideoWallpaperService::class.java)
      val directPreviewIntent = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER).apply {
        putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      val chooserIntent = Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER).apply {
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      val systemPickerIntent = Intent(Intent.ACTION_SET_WALLPAPER).apply {
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      val activity = appContext.throwingActivity

      var openedBy = "direct"
      try {
        activity.startActivity(directPreviewIntent)
      } catch (_: ActivityNotFoundException) {
        try {
          activity.startActivity(chooserIntent)
          openedBy = "liveChooser"
        } catch (_: ActivityNotFoundException) {
          try {
            activity.startActivity(systemPickerIntent)
            openedBy = "systemPicker"
          } catch (fallbackError: Exception) {
            throw ActivityNotFoundException("系统无法打开壁纸设置，请从系统设置进入动态壁纸列表").apply {
              initCause(fallbackError)
            }
          }
        }
      }

      mapOf(
        "opened" to true,
        "openedBy" to openedBy,
        "requestedTarget" to safeTarget,
        "directTargetSelection" to false
      )
    }.runOnQueue(Queues.MAIN)
  }

  private fun appDetailsIntent() = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
    data = Uri.fromParts("package", context.packageName, null)
  }

  private fun vendorPermissionIntents(): List<Intent> {
    if (!isXiaomiFamily()) return emptyList()
    return listOf(
      Intent("miui.intent.action.APP_PERM_EDITOR").apply {
        setClassName(
          "com.miui.securitycenter",
          "com.miui.permcenter.permissions.PermissionsEditorActivity"
        )
        putExtra("extra_pkgname", context.packageName)
        putExtra("packageName", context.packageName)
      },
      Intent("miui.intent.action.APP_PERM_EDITOR").apply {
        putExtra("extra_pkgname", context.packageName)
        putExtra("packageName", context.packageName)
      }
    )
  }

  private fun startFirstAvailable(activity: android.app.Activity, intents: List<Intent>) {
    var lastError: Exception? = null
    for (intent in intents) {
      try {
        activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP))
        return
      } catch (error: Exception) {
        lastError = error
      }
    }
    throw ActivityNotFoundException("系统无法打开应用权限设置").apply { initCause(lastError) }
  }

  private fun isXiaomiFamily(): Boolean {
    val vendor = "${Build.MANUFACTURER} ${Build.BRAND}".lowercase()
    return vendor.contains("xiaomi") || vendor.contains("redmi") || vendor.contains("poco")
  }

  @Suppress("DEPRECATION")
  private fun isXiaomiLockScreenDisplayAllowed(): Boolean = try {
    val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val checkOpNoThrow = appOps.javaClass.getMethod(
      "checkOpNoThrow",
      Int::class.javaPrimitiveType,
      Int::class.javaPrimitiveType,
      String::class.java
    )
    (checkOpNoThrow.invoke(
      appOps,
      MIUI_OP_SHOW_WHEN_LOCKED,
      Process.myUid(),
      context.packageName
    ) as? Int) == AppOpsManager.MODE_ALLOWED
  } catch (_: Exception) {
    false
  }

  @Suppress("DEPRECATION")
  private fun isWallpaperServiceEnabled(): Boolean = try {
    val component = ComponentName(context, VideoWallpaperService::class.java)
    val componentState = context.packageManager.getComponentEnabledSetting(component)
    val serviceInfo = context.packageManager.getServiceInfo(component, PackageManager.GET_META_DATA)
    componentState != PackageManager.COMPONENT_ENABLED_STATE_DISABLED &&
      componentState != PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER &&
      componentState != PackageManager.COMPONENT_ENABLED_STATE_DISABLED_UNTIL_USED &&
      serviceInfo.enabled &&
      serviceInfo.permission == Manifest.permission.BIND_WALLPAPER
  } catch (_: Exception) {
    false
  }

  @Synchronized
  private fun prepareFirstFrame(uri: String, fallbackPreviewUri: String?): Boolean {
    val parsedUri = Uri.parse(uri)
    val path = parsedUri.path ?: return false
    val video = File(path)
    if (parsedUri.scheme != "file" || !video.exists()) return false

    val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    val target = File(context.filesDir, PREVIEW_FRAME_FILE)
    if (preferences.getString(KEY_PREPARED_VIDEO_URI, null) == uri && target.exists()) return true

    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(path)
      val frame = retriever.getFrameAtTime(250_000L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
        ?: throw IllegalStateException("无法提取视频首帧")
      val largestSide = max(frame.width, frame.height)
      val output = if (largestSide > PREVIEW_MAX_SIDE) {
        val ratio = PREVIEW_MAX_SIDE.toFloat() / largestSide.toFloat()
        Bitmap.createScaledBitmap(
          frame,
          (frame.width * ratio).toInt().coerceAtLeast(1),
          (frame.height * ratio).toInt().coerceAtLeast(1),
          true
        )
      } else {
        frame
      }
      FileOutputStream(target).use { stream -> output.compress(Bitmap.CompressFormat.JPEG, 90, stream) }
      if (output !== frame) frame.recycle()
      output.recycle()
      preferences.edit()
        .putString(KEY_PREPARED_VIDEO_URI, uri)
        .putString(KEY_PREVIEW_FRAME_PATH, target.absolutePath)
        .apply()
      true
    } catch (_: Exception) {
      val fallbackPath = fallbackPreviewUri?.let { Uri.parse(it) }?.path
      val fallback = fallbackPath?.let(::File)
      val fallbackCopied = fallback?.takeIf { it.exists() }?.let {
        runCatching { it.copyTo(target, overwrite = true) }.isSuccess
      } == true
      if (fallbackCopied) {
        preferences.edit()
          .putString(KEY_PREPARED_VIDEO_URI, uri)
          .putString(KEY_PREVIEW_FRAME_PATH, target.absolutePath)
          .apply()
        true
      } else {
        target.delete()
        preferences.edit()
          .remove(KEY_PREPARED_VIDEO_URI)
          .remove(KEY_PREVIEW_FRAME_PATH)
          .apply()
        false
      }
    } finally {
      retriever.release()
    }
  }

  companion object {
    const val PREFERENCES_NAME = "shabi_video_wallpaper"
    const val KEY_VIDEO_URI = "video_uri"
    const val KEY_SCALE_MODE = "scale_mode"
    const val KEY_ZOOM = "zoom"
    const val KEY_OFFSET_X = "offset_x"
    const val KEY_OFFSET_Y = "offset_y"
    const val KEY_TARGET = "target"
    const val KEY_PREPARED_VIDEO_URI = "prepared_video_uri"
    const val KEY_PREVIEW_FRAME_PATH = "preview_frame_path"
    private const val PREVIEW_FRAME_FILE = "video_wallpaper_first_frame.jpg"
    private const val PREVIEW_MAX_SIDE = 1440
    private const val MIUI_OP_SHOW_WHEN_LOCKED = 10020
    private val SCALE_MODES = setOf("cover", "contain", "stretch", "custom")
    private val TARGETS = setOf("home", "lock", "both")
  }
}
