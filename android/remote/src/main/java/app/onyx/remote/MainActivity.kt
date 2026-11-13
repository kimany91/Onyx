package app.onyx.remote

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import app.onyx.core.PlayerActivity
import app.onyx.core.TorrentEngine
import app.onyx.core.Updater
import com.google.zxing.client.android.Intents
import com.journeyapps.barcodescanner.CaptureActivity
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONObject

/**
 * Onyx (téléphone) : fonctionne seul — parcourir et regarder sur le téléphone —
 * et peut en plus se connecter à la TV (QR code) pour la piloter ou y lancer un film.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private val prefs by lazy { getSharedPreferences("onyx", Context.MODE_PRIVATE) }
    private var updateChecked = false

    companion object {
        const val SCAN = 42
        const val HOME = "https://appassets.androidplatform.net/assets/web/remote/index.html"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#050506"))
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            // la TV répond en http sur le réseau local
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            userAgentString = "$userAgentString OnyxPhone/${BuildConfig.VERSION_NAME}"
        }
        web.addJavascriptInterface(Bridge(), "OnyxPhone")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == "appassets.androidplatform.net") return false
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Exception) { }
                return true
            }
        }
        setContentView(web)
        PlayerActivity.events = { name, json -> emit(name, json) }
        Thread { try { TorrentEngine.init(applicationContext) } catch (_: Throwable) { } }.start()

        // Lien direct (QR code scanné avec l'appareil photo puis « ouvrir avec Onyx »)
        intent?.data?.let { accept(it.toString()) }
        web.loadUrl(HOME)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.let { accept(it.toString()) }
    }

    override fun onResume() {
        super.onResume()
        PlayerActivity.events = { name, json -> emit(name, json) }
        Updater.resumePending(this)
        if (!updateChecked) {
            updateChecked = true
            Updater.check(this, "onyx-remote.apk", BuildConfig.VERSION_CODE, false) { o ->
                if (o.optString("status") == "available") Toast.makeText(this, "Mise à jour " + o.optString("version") + " en cours de téléchargement…", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun emit(event: String, json: String) {
        runOnUiThread {
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('$event',{detail:${JSONObject.quote(json)}}))", null)
        }
    }

    private fun scan() {
        val options = ScanOptions()
            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("Scanne le QR code affiché sur la TV (Onyx › Connexions)")
            .setBeepEnabled(false)
            .setOrientationLocked(true)
        startActivityForResult(options.createScanIntent(this).setClass(this, CaptureActivity::class.java), SCAN)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != SCAN) return
        val text = data?.getStringExtra(Intents.Scan.RESULT) ?: return
        if (!accept(text)) Toast.makeText(this, "Ce QR code n'est pas un code Onyx.", Toast.LENGTH_LONG).show()
    }

    /** Accepte une URL du type http://IP:PORT/remote/?token=XXXX */
    private fun accept(text: String): Boolean {
        val u = try { Uri.parse(text.trim()) } catch (_: Exception) { return false }
        if (u.scheme != "http" && u.scheme != "https") return false
        if (u.getQueryParameter("token").isNullOrEmpty() || u.path?.contains("remote") != true) return false
        prefs.edit().putString("tv", u.toString()).apply()
        Toast.makeText(this, "TV connectée ✓", Toast.LENGTH_SHORT).show()
        emit("onyx-tv", JSONObject().put("url", u.toString()).toString())
        return true
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack()
        else @Suppress("DEPRECATION") super.onBackPressed()
    }

    inner class Bridge {
        @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface fun deviceName(): String {
            val m = Build.MODEL ?: "Téléphone"
            val brand = (Build.MANUFACTURER ?: "").replaceFirstChar { it.uppercase() }
            return if (m.startsWith(brand, true)) m else "$brand $m".trim()
        }

        @JavascriptInterface fun tvUrl(): String? = prefs.getString("tv", null)

        @JavascriptInterface fun forgetTv() { prefs.edit().remove("tv").apply() }

        @JavascriptInterface fun scan() { runOnUiThread { this@MainActivity.scan() } }

        @JavascriptInterface fun play(json: String): Boolean {
            runOnUiThread { startActivity(Intent(this@MainActivity, PlayerActivity::class.java).putExtra("json", json)) }
            return true
        }

        @JavascriptInterface fun torrentUrl(hash: String, fileIdx: String?, filename: String?, sources: String?): String {
            TorrentEngine.init(applicationContext)
            return TorrentEngine.open(hash, fileIdx?.toIntOrNull() ?: -1, filename, TorrentEngine.parseSources(sources))
        }

        @JavascriptInterface fun torrentPrepare(hash: String, fileIdx: String?, filename: String?, sources: String?) {
            TorrentEngine.init(applicationContext)
            TorrentEngine.prepare(hash, fileIdx?.toIntOrNull() ?: -1, filename, TorrentEngine.parseSources(sources))
        }

        @JavascriptInterface fun torrentProbe(list: String?) {
            TorrentEngine.init(applicationContext)
            try { TorrentEngine.probe(org.json.JSONArray(list ?: "[]")) } catch (_: Exception) { }
        }

        @JavascriptInterface fun torrentHealth(hashes: String?): String =
            try { TorrentEngine.health(org.json.JSONArray(hashes ?: "[]")).toString() } catch (_: Exception) { "{}" }

        @JavascriptInterface fun torrentKeep(hashes: String?) {
            try { val a = org.json.JSONArray(hashes ?: "[]"); TorrentEngine.keepOnly((0 until a.length()).map { a.getString(it) }) } catch (_: Exception) { }
        }

        @JavascriptInterface fun torrentStats(hash: String): String = TorrentEngine.stats(hash).toString()

        @JavascriptInterface fun freeSpace(): String { TorrentEngine.init(applicationContext); return TorrentEngine.freeSpace().toString() }

        @JavascriptInterface fun closePlayer(reason: String?) { runOnUiThread { PlayerActivity.current?.finishWithError(reason) } }

        @JavascriptInterface fun playerMessage(text: String) { runOnUiThread { PlayerActivity.current?.message(text) } }

        @JavascriptInterface fun openExternal(url: String, mime: String?): Boolean {
            return try {
                val i = Intent(Intent.ACTION_VIEW)
                if (!mime.isNullOrEmpty()) i.setDataAndType(Uri.parse(url), mime) else i.data = Uri.parse(url)
                startActivity(if (!mime.isNullOrEmpty()) Intent.createChooser(i, "Ouvrir avec") else i)
                true
            } catch (_: Exception) { false }
        }

        @JavascriptInterface fun vibrate(ms: Int) {
            try {
                @Suppress("DEPRECATION")
                val v = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(ms.toLong(), VibrationEffect.DEFAULT_AMPLITUDE))
                else @Suppress("DEPRECATION") v.vibrate(ms.toLong())
            } catch (_: Exception) { }
        }
    }
}
