package app.onyx.remote

import app.onyx.core.ImageProxy
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
import org.json.JSONArray
import org.json.JSONObject

/**
 * Onyx (téléphone) : fonctionne seul — parcourir et regarder sur le téléphone —
 * et peut en plus se connecter à la TV (QR code) pour la piloter ou y lancer un film.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private val prefs by lazy { getSharedPreferences("onyx", Context.MODE_PRIVATE) }

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
                loader.shouldInterceptRequest(request.url) ?: ImageProxy.intercept(request)
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
        // après une mise à jour : on oublie l'ancienne interface gardée en mémoire
        val vp = getSharedPreferences("onyx-webcache", MODE_PRIVATE)
        if (vp.getInt("v", -1) != BuildConfig.VERSION_CODE) {
            web.clearCache(true)
            vp.edit().putInt("v", BuildConfig.VERSION_CODE).apply()
        }
        web.loadUrl(HOME)
        Updater.startPeriodic(this, "onyx-remote.apk", BuildConfig.VERSION_CODE, ::onUpdate)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.let { accept(it.toString()) }
    }

    override fun onResume() {
        super.onResume()
        PlayerActivity.events = { name, json -> emit(name, json) }
        Updater.resumePending(this)
        // mise à jour automatique : au démarrage et à chaque retour dans l'app (au plus 1 fois par heure)
        Updater.autoCheck(this, "onyx-remote.apk", BuildConfig.VERSION_CODE, 3600_000L, ::onUpdate)
    }

    private fun onUpdate(o: JSONObject) {
        if (o.optString("status") == "available") Toast.makeText(this, "Mise à jour " + o.optString("version") + " en cours de téléchargement…", Toast.LENGTH_LONG).show()
        emit("onyx-update", o.toString())
    }

    /** Réseau Wi-Fi (ou Ethernet) actuel, même s'il n'a pas Internet. */
    private fun wifiNetwork(): android.net.Network? = try {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        @Suppress("DEPRECATION")
        cm.allNetworks.firstOrNull { n ->
            val c = cm.getNetworkCapabilities(n)
            c != null && (c.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) || c.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET))
        }
    } catch (_: Exception) { null }

    private var discovering = false
    private fun discoverTv() {
        if (discovering) return
        discovering = true
        val nsd = getSystemService(Context.NSD_SERVICE) as android.net.nsd.NsdManager
        val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager
        val lock = try { wifi.createMulticastLock("onyx").apply { setReferenceCounted(false); acquire() } } catch (_: Exception) { null }
        val found = JSONArray()
        var listener: android.net.nsd.NsdManager.DiscoveryListener? = null
        fun finish() {
            if (!discovering) return
            discovering = false
            try { listener?.let { nsd.stopServiceDiscovery(it) } } catch (_: Exception) { }
            try { lock?.release() } catch (_: Exception) { }
            emit("onyx-found", JSONObject().put("tvs", found).toString())
        }
        listener = object : android.net.nsd.NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(t: String) { }
            override fun onDiscoveryStopped(t: String) { }
            override fun onStartDiscoveryFailed(t: String, e: Int) { runOnUiThread { finish() } }
            override fun onStopDiscoveryFailed(t: String, e: Int) { }
            override fun onServiceLost(si: android.net.nsd.NsdServiceInfo) { }
            override fun onServiceFound(si: android.net.nsd.NsdServiceInfo) {
                @Suppress("DEPRECATION")
                nsd.resolveService(si, object : android.net.nsd.NsdManager.ResolveListener {
                    override fun onResolveFailed(s: android.net.nsd.NsdServiceInfo, e: Int) { }
                    override fun onServiceResolved(s: android.net.nsd.NsdServiceInfo) {
                        @Suppress("DEPRECATION")
                        val host = s.host?.hostAddress ?: return
                        if (host.contains(':')) return
                        synchronized(found) { found.put("http://$host:${s.port}") }
                    }
                })
            }
        }
        try { nsd.discoverServices("_onyx._tcp.", android.net.nsd.NsdManager.PROTOCOL_DNS_SD, listener) } catch (_: Exception) { finish(); return }
        android.os.Handler(mainLooper).postDelayed({ finish() }, 5000)
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
        // « connectée » n'est affiché qu'une fois que la TV a vraiment répondu (côté interface)
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

        /** Mémorise l'adresse de la TV qui a répondu (elle peut différer de celle du QR code). */
        @JavascriptInterface fun saveTv(url: String) { prefs.edit().putString("tv", url).apply() }

        /** Cherche la TV sur le réseau local (annonce « _onyx._tcp ») ; réponse via l'événement « onyx-found ». */
        @JavascriptInterface fun discover() { runOnUiThread { discoverTv() } }

        /**
         * Requête vers la TV faite par l'app elle-même (et non par la page web) :
         * les navigateurs récents bloquent les appels d'une page vers un appareil
         * du réseau local ; ici aucune restriction. Réponse via l'événement « onyx-http ».
         */
        @JavascriptInterface fun http(id: String, method: String, url: String, headers: String?, body: String?) {
            Thread {
                val out = JSONObject().put("id", id)
                try {
                    // toujours par le Wi-Fi : sinon Android peut passer par les données mobiles ou un VPN,
                    // et la TV (adresse locale) devient injoignable
                    val c = (wifiNetwork()?.openConnection(java.net.URL(url)) ?: java.net.URL(url).openConnection()) as java.net.HttpURLConnection
                    c.requestMethod = if (method == "POST") "POST" else "GET"
                    c.connectTimeout = 4000; c.readTimeout = 10000
                    c.useCaches = false
                    try {
                        val h = JSONObject(headers ?: "{}")
                        h.keys().forEach { k -> c.setRequestProperty(k, h.optString(k)) }
                    } catch (_: Exception) { }
                    if (c.requestMethod == "POST" && body != null) {
                        c.doOutput = true
                        c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                    }
                    val code = c.responseCode
                    val text = (if (code >= 400) c.errorStream else c.inputStream)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
                    out.put("status", code).put("body", text)
                    c.disconnect()
                } catch (e: Exception) {
                    out.put("status", 0).put("error", e.javaClass.simpleName + ": " + (e.message ?: "")).put("wifi", wifiNetwork() != null)
                }
                emit("onyx-http", out.toString())
            }.apply { isDaemon = true; start() }
        }

        @JavascriptInterface fun scan() { runOnUiThread { this@MainActivity.scan() } }

        @JavascriptInterface fun playerPrepare(json: String): Boolean = play(json)

        @JavascriptInterface fun playerProgress(json: String) {
            runOnUiThread { try { PlayerActivity.current?.jsProgress(JSONObject(json)) } catch (_: Exception) { } }
        }

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
