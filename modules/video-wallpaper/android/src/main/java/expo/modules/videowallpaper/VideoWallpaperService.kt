package expo.modules.videowallpaper

import android.content.Context
import android.graphics.Matrix
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.service.wallpaper.WallpaperService
import android.view.SurfaceHolder
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.MatrixTransformation
import androidx.media3.effect.Presentation
import androidx.media3.exoplayer.ExoPlayer

@UnstableApi
class VideoWallpaperService : WallpaperService() {
  override fun onCreateEngine(): Engine = VideoEngine()

  inner class VideoEngine : Engine() {
    private var player: ExoPlayer? = null
    private var visible = false
    private var surfaceWidth = 0
    private var surfaceHeight = 0

    override fun onSurfaceCreated(holder: SurfaceHolder) {
      super.onSurfaceCreated(holder)
      val frame = holder.surfaceFrame
      startPlayer(
        holder,
        frame.width().takeIf { it > 0 } ?: resources.displayMetrics.widthPixels,
        frame.height().takeIf { it > 0 } ?: resources.displayMetrics.heightPixels
      )
    }

    override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
      super.onSurfaceChanged(holder, format, width, height)
      if (width > 0 && height > 0 && (width != surfaceWidth || height != surfaceHeight)) {
        startPlayer(holder, width, height)
      }
    }

    override fun onVisibilityChanged(isVisible: Boolean) {
      visible = isVisible
      player?.playWhenReady = isVisible
      if (!isVisible) player?.pause()
    }

    override fun onSurfaceDestroyed(holder: SurfaceHolder) {
      releasePlayer()
      super.onSurfaceDestroyed(holder)
    }

    override fun onDestroy() {
      releasePlayer()
      super.onDestroy()
    }

    private fun startPlayer(holder: SurfaceHolder, width: Int, height: Int, allowEffects: Boolean = true) {
      val preferences = getSharedPreferences(VideoWallpaperModule.PREFERENCES_NAME, Context.MODE_PRIVATE)
      val uri = preferences.getString(VideoWallpaperModule.KEY_VIDEO_URI, null) ?: return
      val scaleMode = preferences.getString(VideoWallpaperModule.KEY_SCALE_MODE, "cover") ?: "cover"
      val zoom = preferences.getFloat(VideoWallpaperModule.KEY_ZOOM, 1f).coerceIn(1f, 3f)
      val offsetX = preferences.getFloat(VideoWallpaperModule.KEY_OFFSET_X, 0f).coerceIn(-1f, 1f)
      val offsetY = preferences.getFloat(VideoWallpaperModule.KEY_OFFSET_Y, 0f).coerceIn(-1f, 1f)

      releasePlayer()
      surfaceWidth = width
      surfaceHeight = height
      val aspectRatio = width.toFloat() / height.toFloat()
      val effects = if (allowEffects) createEffects(scaleMode, aspectRatio, zoom, offsetX, offsetY) else emptyList()

      player = ExoPlayer.Builder(applicationContext).build().also { exoPlayer ->
        exoPlayer.setMediaItem(MediaItem.fromUri(Uri.parse(uri)))
        exoPlayer.repeatMode = Player.REPEAT_MODE_ONE
        exoPlayer.volume = 0f
        exoPlayer.videoScalingMode = if (scaleMode == "contain") {
          C.VIDEO_SCALING_MODE_SCALE_TO_FIT
        } else {
          C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING
        }
        if (effects.isNotEmpty()) {
          exoPlayer.setVideoEffects(effects)
          exoPlayer.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
              if (!holder.surface.isValid) return
              Handler(Looper.getMainLooper()).post {
                if (holder.surface.isValid) startPlayer(holder, width, height, false)
              }
            }
          })
        }
        exoPlayer.setVideoSurface(holder.surface)
        exoPlayer.prepare()
        exoPlayer.playWhenReady = visible
      }
    }

    private fun createEffects(
      scaleMode: String,
      aspectRatio: Float,
      zoom: Float,
      offsetX: Float,
      offsetY: Float
    ): List<Effect> {
      if (scaleMode == "cover" || scaleMode == "contain") return emptyList()
      val layout = when (scaleMode) {
        "stretch" -> Presentation.LAYOUT_STRETCH_TO_FIT
        else -> Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP
      }
      val effects = mutableListOf<Effect>(Presentation.createForAspectRatio(aspectRatio, layout))
      if (scaleMode == "custom") {
        effects += object : MatrixTransformation {
          override fun getMatrix(presentationTimeUs: Long): Matrix = Matrix().apply {
            setScale(zoom, zoom)
            postTranslate(offsetX * (zoom - 1f), offsetY * (zoom - 1f))
          }
        }
      }
      return effects
    }

    private fun releasePlayer() {
      player?.clearVideoSurface()
      player?.release()
      player = null
    }
  }
}
