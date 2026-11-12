package app.onyx.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import app.onyx.core.Updater
import org.json.JSONObject

class MainActivity : Activity() {

    companion object {
        @Volatile var instance: MainActivity? = null
        const val HOME = "https://appassets.androidplatform.net/assets/web/index.html"

        /** Envoie un événement à l'interface web (window.dispatchEvent). */
        fun emit(event: String, json: String) {
            OnyxApp.main.post {
                instance?.web?.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('$event',{detail:${JSONObject.quote(json)}}))", null
                )
            }
        }
    }

    lateinit var web: WebView
        private set

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        instance = this
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        hideSystemUi()

        OnyxApp.instance.startServer()

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this)
        web.setBackgroundColor(Color.BLACK)
        web.isFocusable = true
        web.isFocusableInTouchMode = true
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            loadWithOverviewMode = true
            useWideViewPort = true
            userAgentString = "$userAgentString OnyxTV/${BuildConfig.VERSION_NAME}"
        }
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.host == "appassets.androidplatform.net") return false
                openExternal(u.toString(), null)
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        }
        web.addJavascriptInterface(OnyxBridge(this), "OnyxNative")
        setContentView(web)
        web.loadUrl(HOME)
        web.requestFocus()
    }

    private fun hideSystemUi() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
    }

    override fun onResume() {
        super.onResume()
        instance = this
        hideSystemUi()
        OnyxApp.instance.startServer()
        Updater.resumePending(this)
        web.requestFocus()
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        web.destroy()
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) {
            if (event.action == KeyEvent.ACTION_UP) web.evaluateJavascript("window.onyxBack && window.onyxBack()", null)
            return true
        }
        val media = when (code) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK -> "playpause"
            KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
            KeyEvent.KEYCODE_MEDIA_PAUSE -> "pause"
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "ff"
            KeyEvent.KEYCODE_MEDIA_REWIND -> "rw"
            KeyEvent.KEYCODE_MEDIA_STOP -> "stop"
            else -> null
        }
        if (media != null) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) emit("onyx-key", JSONObject().put("action", media).toString())
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    fun openExternal(url: String, mime: String?): Boolean {
        return try {
            val i = Intent(Intent.ACTION_VIEW)
            if (!mime.isNullOrEmpty()) i.setDataAndType(Uri.parse(url), mime) else i.data = Uri.parse(url)
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (!mime.isNullOrEmpty()) startActivity(Intent.createChooser(i, "Ouvrir avec").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            else startActivity(i)
            true
        } catch (_: Exception) { false }
    }

    fun play(json: String) {
        val i = Intent(this, PlayerActivity::class.java).putExtra("json", json)
        startActivity(i)
    }

    fun exitApp() {
        OnyxApp.instance.stopServer()
        if (Build.VERSION.SDK_INT >= 21) finishAndRemoveTask() else finish()
    }
}
