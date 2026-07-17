package expo.modules.videowallpaper

import android.content.Context
import android.graphics.Matrix
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.service.wallpaper.WallpaperService
import android.view.Surface
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
      visible = true
      val frame = holder.surfaceFrame
      val width = frame.width().takeIf { it > 0 } ?: resources.displayMetrics.widthPixels
      val height = frame.height().takeIf { it > 0 } ?: resources.displayMetrics.heightPixels
      startPlayer(holder, width, height)
    }

    override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
      super.onSurfaceChanged(holder, format, width, height)
      if (width > 0 && height > 0 && (width != surfaceWidth || height != surfaceHeight)) {
        startPlayer(holder, width, height)
      }
    }

    override fun onSurfaceRedrawNeeded(holder: SurfaceHolder) {
      super.onSurfaceRedrawNeeded(holder)
      if (player == null && holder.surface.isValid) {
        startPlayer(
          holder,
          surfaceWidth.takeIf { it > 0 } ?: resources.displayMetrics.widthPixels,
          surfaceHeight.takeIf { it > 0 } ?: resources.displayMetrics.heightPixels
        )
      }
    }

    override fun onVisibilityChanged(isVisible: Boolean) {
      visible = isVisible
      val shouldPlay = shouldKeepPlaying()
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
      val frameRate = preferences.getFloat(VideoWallpaperModule.KEY_FRAME_RATE, 60f).coerceIn(30f, 240f)

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

      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
        runCatching {
          holder.surface.setFrameRate(frameRate, Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE)
        }
      }

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
            if (playbackState == Player.STATE_READY && shouldKeepPlaying()) {
              exoPlayer.playWhenReady = true
              exoPlayer.play()
            }
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
        exoPlayer.setVideoSurfaceHolder(holder)
        exoPlayer.prepare()
        exoPlayer.playWhenReady = true
        exoPlayer.play()
      }
      if (effects.isNotEmpty() && shouldKeepPlaying()) scheduleRecovery(holder, width, height, generation)
    }

    private fun shouldKeepPlaying(): Boolean {
      val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
      // HyperOS can report the live-wallpaper preview as invisible even while it is
      // displayed. Keep decoding while the screen is interactive and the Surface exists.
      return currentHolder?.surface?.isValid == true &&
        (visible || isPreview || powerManager.isInteractive)
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
