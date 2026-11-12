package app.onyx.core

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.graphics.drawable.StateListDrawable
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONObject

/** Lecteur vidéo natif (ExoPlayer) : MKV, HEVC, HDR, AC3… selon la TV. */
@OptIn(UnstableApi::class)
class PlayerActivity : Activity() {

    companion object {
        @Volatile var current: PlayerActivity? = null
        /** Reçoit les événements du lecteur (nom, JSON) : branché par l'app TV ou téléphone. */
        @Volatile var events: ((String, String) -> Unit)? = null
        val main = Handler(Looper.getMainLooper())
    }

    private var player: ExoPlayer? = null
    private lateinit var view: PlayerView
    private lateinit var titleBar: LinearLayout
    private lateinit var titleText: TextView
    private lateinit var subText: TextView
    private lateinit var osd: TextView
    private var ended = false
    private var error: String? = null
    private var reported = false
    private var pendingSeek = 0L
    private var videoId = ""
    private var menu: JSONObject? = null
    private var deviceLang = "fr"
    private var pendingVo = false
    private var selector: DefaultTrackSelector? = null
    private lateinit var menuBtn: TextView
    private val failTimeout = Runnable { finish() }
    private val ticker = object : Runnable {
        override fun run() { report(false); main.postDelayed(this, 2000) }
    }
    private val applySeek = Runnable {
        player?.let { p -> p.seekTo((p.currentPosition + pendingSeek).coerceIn(0, maxOf(0, p.duration - 1000))) }
        pendingSeek = 0
    }
    private val hideOsd = Runnable { osd.animate().alpha(0f).setDuration(250).start() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_FULLSCREEN)
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION)
        buildUi()
        load(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        reported = false; ended = false; error = null
        main.removeCallbacks(failTimeout)
        load(intent)
    }

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt()

    @SuppressLint("SetTextI18n")
    private fun buildUi() {
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        view = PlayerView(this).apply {
            setShowSubtitleButton(true)
            setShowNextButton(false)
            setShowPreviousButton(false)
            setShowShuffleButton(false)
            controllerShowTimeoutMs = 4000
            setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS)
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            keepScreenOn = true
            setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { v ->
                if (v == View.VISIBLE) { titleBar.visibility = View.VISIBLE; titleBar.animate().alpha(1f).setDuration(250).start() }
                else titleBar.animate().alpha(0f).setDuration(250).withEndAction { titleBar.visibility = View.GONE }.start()
            })
        }
        root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        titleBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.TOP
            setPadding(dp(32f), dp(24f), dp(32f), dp(40f))
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0xCC000000.toInt(), 0x00000000))
            alpha = 0f
            visibility = View.GONE
        }
        val texts = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        titleText = TextView(this).apply { setTextColor(Color.WHITE); textSize = 22f; typeface = Typeface.DEFAULT_BOLD; maxLines = 1 }
        subText = TextView(this).apply { setTextColor(0xFFB0B0B8.toInt()); textSize = 15f; maxLines = 1 }
        texts.addView(titleText); texts.addView(subText)
        titleBar.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        menuBtn = TextView(this).apply {
            text = "⚙  Langue & qualité"
            textSize = 15f; typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(16f), dp(10f), dp(16f), dp(10f))
            isFocusable = true; isClickable = true
            val r = dp(22f).toFloat()
            background = StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_focused), GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = r })
                addState(intArrayOf(android.R.attr.state_pressed), GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = r })
                addState(intArrayOf(), GradientDrawable().apply { setColor(0x66000000); cornerRadius = r; setStroke(dp(1f), 0x55FFFFFF) })
            }
            setTextColor(android.content.res.ColorStateList(arrayOf(intArrayOf(android.R.attr.state_focused), intArrayOf(android.R.attr.state_pressed), intArrayOf()),
                intArrayOf(Color.BLACK, Color.BLACK, Color.WHITE)))
            setOnClickListener { openMenu() }
        }
        titleBar.addView(menuBtn, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(titleBar, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))

        osd = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 18f; typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(16f), dp(8f), dp(16f), dp(8f))
            background = GradientDrawable().apply { setColor(0xAA000000.toInt()); cornerRadius = dp(10f).toFloat() }
            alpha = 0f
        }
        root.addView(osd, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply {
            topMargin = dp(28f); rightMargin = dp(40f)
        })
        setContentView(root)
    }

    private fun load(intent: Intent) {
        val o = try { JSONObject(intent.getStringExtra("json") ?: "{}") } catch (_: Exception) { JSONObject() }
        val url = o.optString("url")
        if (url.isEmpty()) { finish(); return }
        videoId = o.optString("videoId")
        menu = o.optJSONObject("menu")
        deviceLang = o.optString("deviceLang", "fr")
        menuBtn.visibility = if (menu != null) View.VISIBLE else View.GONE
        titleText.text = o.optString("title")
        subText.text = o.optString("subtitle")
        subText.visibility = if (subText.text.isNullOrEmpty()) View.GONE else View.VISIBLE

        player?.release()
        val headers = HashMap<String, String>()
        o.optJSONObject("headers")?.let { h -> h.keys().forEach { k -> headers[k] = h.optString(k) } }
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent(headers.remove("User-Agent") ?: "Mozilla/5.0 (Linux; Android) Onyx")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(20000).setReadTimeoutMs(30000)
            .setDefaultRequestProperties(headers)
        val sourceFactory = DefaultMediaSourceFactory(DefaultDataSource.Factory(this, http))

        val audioLang = o.optString("audioLang", deviceLang)
        val subLang = o.optString("subLang", "off")
        val selector = DefaultTrackSelector(this)
        this.selector = selector
        val params = selector.buildUponParameters()
        pendingVo = audioLang == "vo"
        if (audioLang != "vo") params.setPreferredAudioLanguage(audioLang)
        if (subLang != "off" && o.optBoolean("subtitlesAuto", true)) params.setPreferredTextLanguage(subLang)
        selector.setParameters(params)

        val renderers = DefaultRenderersFactory(this).setEnableDecoderFallback(true)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)

        val p = ExoPlayer.Builder(this, renderers)
            .setMediaSourceFactory(sourceFactory)
            .setTrackSelector(selector)
            .setSeekBackIncrementMs(10000).setSeekForwardIncrementMs(10000)
            .build()
        player = p
        view.player = p

        val subs = ArrayList<MediaItem.SubtitleConfiguration>()
        o.optJSONArray("subtitles")?.let { arr ->
            for (i in 0 until arr.length()) {
                val s = arr.optJSONObject(i) ?: continue
                val su = s.optString("url")
                if (su.isEmpty()) continue
                val lower = su.lowercase()
                val mime = when {
                    lower.contains(".vtt") -> MimeTypes.TEXT_VTT
                    lower.contains(".ass") || lower.contains(".ssa") -> MimeTypes.TEXT_SSA
                    else -> MimeTypes.APPLICATION_SUBRIP
                }
                subs.add(MediaItem.SubtitleConfiguration.Builder(Uri.parse(su)).setMimeType(mime)
                    .setLanguage(normLang(s.optString("lang"))).setLabel(s.optString("label")).build())
            }
        }
        val item = MediaItem.Builder().setUri(url).apply {
            if (url.contains(".m3u8")) setMimeType(MimeTypes.APPLICATION_M3U8)
            if (url.contains(".mpd")) setMimeType(MimeTypes.APPLICATION_MPD)
            setSubtitleConfigurations(subs)
        }.build()

        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) { ended = true; finish() }
            }
            override fun onTracksChanged(tracks: Tracks) {
                if (pendingVo && !tracks.isEmpty) { pendingVo = false; selectAudio("vo", false) }
            }
            override fun onPlayerError(e: PlaybackException) {
                error = when (e.errorCode) {
                    PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS, PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> "source indisponible"
                    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "connexion impossible"
                    PlaybackException.ERROR_CODE_DECODER_INIT_FAILED, PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
                    PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES -> "format vidéo non supporté par la TV"
                    PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED -> "format de fichier non supporté"
                    else -> e.errorCodeName
                }
                val cb = events
                if (cb == null) { finish(); return }
                // l'interface va essayer automatiquement une autre source (même position)
                showOsd("Source indisponible, recherche d'une autre…", 6000)
                cb("onyx-player", JSONObject().put("videoId", videoId).put("failed", true).put("error", error)
                    .put("position", player?.currentPosition ?: 0).toString())
                main.removeCallbacks(failTimeout)
                main.postDelayed(failTimeout, 15000)
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) { report(false) }
        })
        val start = o.optLong("startAt", 0)
        p.setMediaItem(item, if (start > 0) start else C.TIME_UNSET)
        p.prepare()
        p.playWhenReady = true
        view.showController()
        main.removeCallbacks(ticker)
        main.postDelayed(ticker, 2000)
    }

    private fun normLang(l: String?): String = when (val x = (l ?: "").lowercase()) {
        "fre", "fra", "french", "fr-fr", "fr-ca" -> "fr"
        "eng", "english", "en-us", "en-gb" -> "en"
        "spa", "spanish", "es-es", "es-419" -> "es"
        "ger", "deu", "german" -> "de"
        "ita", "italian" -> "it"
        "por", "pob", "pt-br", "portuguese" -> "pt"
        "ara", "arabic" -> "ar"
        else -> x.substringBefore('-')
    }

    /* ---------- Menu « Langue & qualité » ---------- */
    private fun labelOf(key: String, code: String): String {
        val arr = menu?.optJSONArray(key) ?: return code
        for (i in 0 until arr.length()) { val o = arr.optJSONObject(i); if (o?.optString("code") == code) return o.optString("label") }
        return code
    }

    private fun currentOf(key: String) = menu?.optJSONObject("current")?.optString(key) ?: ""

    fun openMenu() {
        val m = menu ?: return
        val keys = arrayOf("audio", "subs", "quality")
        val names = arrayOf("Audio", "Sous-titres", "Qualité")
        val items = keys.indices.map { names[it] + " :  " + labelOf(keys[it], currentOf(keys[it])) }.toTypedArray()
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Langue & qualité" + (m.optString("info").let { if (it.isNotEmpty()) "\n" + it else "" }))
            .setItems(items) { _, which -> openChoice(keys[which], names[which]) }
            .setNegativeButton("Fermer", null)
            .show()
    }

    private fun openChoice(key: String, name: String) {
        val arr = menu?.optJSONArray(key) ?: return
        val codes = (0 until arr.length()).map { arr.getJSONObject(it).optString("code") }
        val labels = (0 until arr.length()).map { arr.getJSONObject(it).optString("label") }.toTypedArray()
        val cur = codes.indexOf(currentOf(key))
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle(name)
            .setSingleChoiceItems(labels, cur) { d, which -> d.dismiss(); apply(key, codes[which]) }
            .setNegativeButton("Annuler", null)
            .show()
    }

    private fun setCurrent(key: String, code: String) {
        val m = menu ?: return
        val c = m.optJSONObject("current") ?: JSONObject().also { m.put("current", it) }
        c.put(key, code)
    }

    private fun emitSwitch(key: String, code: String, inFile: Boolean) {
        val p = player ?: return
        events?.invoke("onyx-player", JSONObject().put("videoId", videoId).put("switch", JSONObject().put(key, code))
            .put("inFile", inFile).put("position", p.currentPosition).put("duration", maxOf(0, p.duration)).put("paused", !p.isPlaying).toString())
    }

    private fun apply(key: String, code: String) {
        val label = labelOf(key, code)
        setCurrent(key, code)
        when (key) {
            "subs" -> { applySubs(code, true); emitSwitch(key, code, true) }
            "audio" -> {
                if (selectAudio(code, true)) {
                    // VO → sous-titres dans la langue de l'appareil ; langue de l'appareil → sans sous-titres
                    if (code == "vo" && currentOf("subs") == "off") { setCurrent("subs", deviceLang); applySubs(deviceLang, false) }
                    else if (code == deviceLang) { setCurrent("subs", "off"); applySubs("off", false) }
                    emitSwitch(key, code, true)
                } else {
                    showOsd("Recherche d'une version $label…", 4000)
                    emitSwitch(key, code, false)
                }
            }
            "quality" -> { showOsd("Recherche d'une version $label…", 4000); emitSwitch(key, code, false) }
        }
    }

    private fun applySubs(code: String, notify: Boolean) {
        val sel = selector ?: return
        val b = sel.buildUponParameters().clearOverridesOfType(C.TRACK_TYPE_TEXT)
        if (code == "off") b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).setPreferredTextLanguage(null)
        else b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).setPreferredTextLanguage(code)
        sel.setParameters(b)
        if (!notify) return
        if (code == "off") { showOsd("Sous-titres désactivés"); return }
        val has = player?.currentTracks?.groups?.any { it.type == C.TRACK_TYPE_TEXT && normLang(it.mediaTrackGroup.getFormat(0).language) == code } ?: false
        showOsd(if (has) "Sous-titres : " + labelOf("subs", code) else "Pas de sous-titres " + labelOf("subs", code) + " pour cette vidéo", 3000)
    }

    /** Change la piste audio dans le fichier actuel si elle existe (fichiers MULTI). */
    private fun selectAudio(code: String, notify: Boolean): Boolean {
        val p = player ?: return false
        val sel = selector ?: return false
        val groups = p.currentTracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
        if (groups.isEmpty()) return false
        val g = groups.firstOrNull { gr ->
            val l = normLang(gr.mediaTrackGroup.getFormat(0).language)
            if (code == "vo") l.isNotEmpty() && l != "und" && l != deviceLang else l == code
        } ?: return false
        sel.setParameters(sel.buildUponParameters().setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, 0)))
        if (notify) showOsd("Audio : " + labelOf("audio", code), 2500)
        return true
    }

    fun message(text: String) { showOsd(text, 3500) }

    fun finishWithError(reason: String?) {
        if (!reason.isNullOrEmpty()) error = reason
        finish()
    }

    private fun fmt(ms: Long): String {
        val s = (ms / 1000).coerceAtLeast(0)
        val h = s / 3600; val m = (s % 3600) / 60; val sec = s % 60
        return if (h > 0) String.format("%d:%02d:%02d", h, m, sec) else String.format("%d:%02d", m, sec)
    }

    private fun showOsd(text: String, ms: Long = 1500) {
        osd.text = text
        osd.animate().cancel(); osd.alpha = 1f
        main.removeCallbacks(hideOsd)
        main.postDelayed(hideOsd, ms)
    }

    private fun seekBy(seconds: Int) {
        val p = player ?: return
        pendingSeek += seconds * 1000L
        val target = (p.currentPosition + pendingSeek).coerceIn(0, maxOf(0, p.duration))
        showOsd((if (pendingSeek > 0) "+" else "−") + (Math.abs(pendingSeek) / 1000) + " s  ·  " + fmt(target))
        main.removeCallbacks(applySeek)
        main.postDelayed(applySeek, 450)
    }

    private fun toggle() {
        val p = player ?: return
        if (p.isPlaying) { p.pause(); showOsd("Pause") } else { p.play(); showOsd("Lecture") }
    }

    /** Commandes venant du téléphone. */
    fun handleRemote(cmd: JSONObject): Boolean {
        val p = player ?: return false
        when (cmd.optString("action")) {
            "playpause" -> toggle()
            "pause" -> p.pause()
            "resume" -> p.play()
            "seek" -> seekBy(cmd.optInt("delta", 10))
            "seekTo" -> p.seekTo((cmd.optDouble("position", 0.0) * 1000).toLong())
            "stop" -> finish()
            "key" -> when (cmd.optString("key")) {
                "ok" -> { toggle(); view.showController() }
                "left" -> seekBy(-10)
                "right" -> seekBy(10)
                "up", "down" -> view.showController()
                "back" -> finish()
                else -> return false
            }
            else -> return false
        }
        report(false)
        return true
    }

    override fun dispatchKeyEvent(e: KeyEvent): Boolean {
        val visible = view.isControllerFullyVisible
        val code = e.keyCode
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) {
            if (e.action == KeyEvent.ACTION_UP) { if (visible) view.hideController() else finish() }
            return true
        }
        if (e.action == KeyEvent.ACTION_DOWN) {
            when (code) {
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK -> { if (e.repeatCount == 0) toggle(); return true }
                KeyEvent.KEYCODE_MEDIA_PLAY -> { player?.play(); return true }
                KeyEvent.KEYCODE_MEDIA_PAUSE -> { player?.pause(); return true }
                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { seekBy(30); return true }
                KeyEvent.KEYCODE_MEDIA_REWIND -> { seekBy(-30); return true }
                KeyEvent.KEYCODE_MEDIA_STOP -> { finish(); return true }
                KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS, KeyEvent.KEYCODE_CAPTIONS, KeyEvent.KEYCODE_INFO,
                KeyEvent.KEYCODE_MEDIA_AUDIO_TRACK -> { if (e.repeatCount == 0) openMenu(); return true }
            }
            if (!visible) {
                when (code) {
                    KeyEvent.KEYCODE_DPAD_LEFT -> { seekBy(if (e.repeatCount > 8) -60 else -10); return true }
                    KeyEvent.KEYCODE_DPAD_RIGHT -> { seekBy(if (e.repeatCount > 8) 60 else 10); return true }
                    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> { toggle(); view.showController(); return true }
                    KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN -> { view.showController(); return true }
                }
            }
        }
        return super.dispatchKeyEvent(e)
    }

    private fun report(closed: Boolean) {
        val p = player ?: return
        if (reported && closed) return
        val o = JSONObject()
            .put("videoId", videoId)
            .put("position", p.currentPosition)
            .put("duration", if (p.duration == C.TIME_UNSET) 0 else p.duration)
            .put("paused", !p.isPlaying)
        if (closed) {
            o.put("closed", true).put("ended", ended)
            error?.let { o.put("error", it) }
            reported = true
        }
        events?.invoke("onyx-player", o.toString())
    }

    override fun onPause() {
        super.onPause()
        if (isFinishing) close()
    }

    override fun onStop() {
        super.onStop()
        // l'utilisateur quitte vers l'accueil Android : on met en pause
        player?.pause()
    }

    private fun close() {
        main.removeCallbacks(failTimeout)
        main.removeCallbacks(ticker)
        main.removeCallbacks(applySeek)
        report(true)
        player?.release()
        player = null
        if (current === this) current = null
    }

    override fun onDestroy() {
        if (player != null) close()
        super.onDestroy()
    }
}
