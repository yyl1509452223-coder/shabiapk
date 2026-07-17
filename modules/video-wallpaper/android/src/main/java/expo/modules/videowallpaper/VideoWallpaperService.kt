package expo.modules.videowallpaper

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Color
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
    private var playbackGeneration = 0
    private var firstFrameRendered = false
    private var recoveryRunnable: Runnable? = null
    private var currentHolder: SurfaceHolder? = null
    private var currentEffectsEnabled = false
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onSurfaceCreated(holder: SurfaceHolder) {
      super.onSurfaceCreated(holder)
      val frame = holder.surfaceFrame
      val width = frame.width().takeIf { it > 0 } ?: resources.displayMetrics.widthPixels
      val height = frame.height().takeIf { it > 0 } ?: resources.displayMetrics.heightPixels
      drawCachedFirstFrame(holder, width, height)
      startPlayer(
        holder,
        width,
        height
      )
    }

    override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
      super.onSurfaceChanged(holder, format, width, height)
      if (width > 0 && height > 0 && (width != surfaceWidth || height != surfaceHeight)) {
        drawCachedFirstFrame(holder, width, height)
        startPlayer(holder, width, height)
      }
    }

    override fun onSurfaceRedrawNeeded(holder: SurfaceHolder) {
      super.onSurfaceRedrawNeeded(holder)
      if (!firstFrameRendered) {
        drawCachedFirstFrame(holder, surfaceWidth, surfaceHeight)
      }
    }

    override fun onVisibilityChanged(isVisible: Boolean) {
      visible = isVisible
      val shouldPlay = isVisible || isPreview
      player?.playWhenReady = shouldPlay
      if (shouldPlay) {
        player?.play()
        val holder = currentHolder
        if (!firstFrameRendered && currentEffectsEnabled && holder?.surface?.isValid == true) {
          scheduleRecovery(holder, surfaceWidth, surfaceHeight, playbackGeneration)
        }
      } else {
        cancelRecovery()
        player?.pause()
      }
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
      playbackGeneration += 1
      surfaceWidth = width
      surfaceHeight = height
      val aspectRatio = width.toFloat() / height.toFloat()
      val effects = if (allowEffects) createEffects(scaleMode, aspectRatio, zoom, offsetX, offsetY) else emptyList()
      val generation = playbackGeneration
      firstFrameRendered = false
      currentHolder = holder
      currentEffectsEnabled = effects.isNotEmpty()

      player = ExoPlayer.Builder(applicationContext).build().also { exoPlayer ->
        exoPlayer.setMediaItem(MediaItem.fromUri(Uri.parse(uri)))
        exoPlayer.repeatMode = Player.REPEAT_MODE_ONE
        exoPlayer.volume = 0f
        exoPlayer.videoScalingMode = if (scaleMode == "contain") {
          C.VIDEO_SCALING_MODE_SCALE_TO_FIT
        } else {
          C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING
        }
        if (effects.isNotEmpty()) exoPlayer.setVideoEffects(effects)
        exoPlayer.addListener(object : Player.Listener {
          override fun onRenderedFirstFrame() {
            if (generation != playbackGeneration) return
            firstFrameRendered = true
            cancelRecovery()
          }

          override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_READY && (visible || isPreview)) exoPlayer.play()
          }

          override fun onPlayerError(error: PlaybackException) {
            if (!allowEffects || generation != playbackGeneration || !holder.surface.isValid) return
            mainHandler.post {
              if (generation == playbackGeneration && holder.surface.isValid) {
                startPlayer(holder, width, height, false)
              }
            }
          }
        })
        exoPlayer.setVideoSurface(holder.surface)
        drawCachedFirstFrame(holder, width, height)
        exoPlayer.prepare()
        exoPlayer.playWhenReady = visible || isPreview
      }
      if (effects.isNotEmpty() && (visible || isPreview)) scheduleRecovery(holder, width, height, generation)
    }

    private fun drawCachedFirstFrame(holder: SurfaceHolder, width: Int, height: Int) {
      if (width <= 0 || height <= 0 || !holder.surface.isValid) return
      val preferences = getSharedPreferences(VideoWallpaperModule.PREFERENCES_NAME, Context.MODE_PRIVATE)
      val framePath = preferences.getString(VideoWallpaperModule.KEY_PREVIEW_FRAME_PATH, null) ?: return
      val bitmap = BitmapFactory.decodeFile(framePath) ?: return
      val scaleMode = preferences.getString(VideoWallpaperModule.KEY_SCALE_MODE, "cover") ?: "cover"
      val zoom = preferences.getFloat(VideoWallpaperModule.KEY_ZOOM, 1f).coerceIn(1f, 3f)
      val offsetX = preferences.getFloat(VideoWallpaperModule.KEY_OFFSET_X, 0f).coerceIn(-1f, 1f)
      val offsetY = preferences.getFloat(VideoWallpaperModule.KEY_OFFSET_Y, 0f).coerceIn(-1f, 1f)
      var canvas: android.graphics.Canvas? = null
      try {
        val lockedCanvas = holder.lockCanvas()
        canvas = lockedCanvas
        lockedCanvas.drawColor(Color.BLACK)
        val matrix = Matrix()
        if (scaleMode == "stretch") {
          matrix.setScale(width.toFloat() / bitmap.width, height.toFloat() / bitmap.height)
        } else {
          val widthScale = width.toFloat() / bitmap.width.toFloat()
          val heightScale = height.toFloat() / bitmap.height.toFloat()
          var scale = if (scaleMode == "contain") {
            minOf(widthScale, heightScale)
          } else {
            maxOf(widthScale, heightScale)
          }
          if (scaleMode == "custom") scale *= zoom
          val scaledWidth = bitmap.width * scale
          val scaledHeight = bitmap.height * scale
          val overflowX = (scaledWidth - width).coerceAtLeast(0f)
          val overflowY = (scaledHeight - height).coerceAtLeast(0f)
          val left = (width - scaledWidth) / 2f + offsetX * overflowX / 2f
          val top = (height - scaledHeight) / 2f + offsetY * overflowY / 2f
          matrix.setScale(scale, scale)
          matrix.postTranslate(left, top)
        }
        lockedCanvas.drawBitmap(bitmap, matrix, null)
      } catch (_: Exception) {
        // The video decoder will still render even if a vendor surface rejects canvas drawing.
      } finally {
        if (canvas != null) {
          try {
            holder.unlockCanvasAndPost(canvas)
          } catch (_: Exception) {
            // Surface may have been replaced by the system preview while drawing.
          }
        }
        bitmap.recycle()
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
      cancelRecovery()
      player?.clearVideoSurface()
      player?.release()
      player = null
      currentHolder = null
      currentEffectsEnabled = false
    }

    private fun scheduleRecovery(holder: SurfaceHolder, width: Int, height: Int, generation: Int) {
      cancelRecovery()
      recoveryRunnable = Runnable {
        if (!firstFrameRendered && generation == playbackGeneration && holder.surface.isValid) {
          startPlayer(holder, width, height, false)
        }
      }.also { mainHandler.postDelayed(it, FIRST_FRAME_TIMEOUT_MS) }
    }

    private fun cancelRecovery() {
      recoveryRunnable?.let(mainHandler::removeCallbacks)
      recoveryRunnable = null
    }
  }

  companion object {
    private const val FIRST_FRAME_TIMEOUT_MS = 1800L
  }
}
