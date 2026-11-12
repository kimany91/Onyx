package app.onyx.remote

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import app.onyx.core.Updater
import com.google.zxing.client.android.Intents
import com.journeyapps.barcodescanner.ScanOptions
import com.journeyapps.barcodescanner.CaptureActivity

/**
 * Onyx Remote : scanne le QR code affiché par la TV puis devient
 * une télécommande (l'interface est servie directement par la TV).
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var welcome: View
    private lateinit var error: View
    private lateinit var errorText: TextView
    private val prefs by lazy { getSharedPreferences("onyx", Context.MODE_PRIVATE) }
    private var updateChecked = false

    companion object { const val SCAN = 42 }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        welcome = findViewById(R.id.welcome)
        error = findViewById(R.id.error)
        errorText = findViewById(R.id.errorText)
        findViewById<TextView>(R.id.version).text = "Version " + BuildConfig.VERSION_NAME

        findViewById<Button>(R.id.scanBtn).setOnClickListener { scan() }
        findViewById<Button>(R.id.retryBtn).setOnClickListener { loadTv() }
        findViewById<Button>(R.id.rescanBtn).setOnClickListener { scan() }

        web.setBackgroundColor(Color.parseColor("#050506"))
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString OnyxRemote/${BuildConfig.VERSION_NAME}"
        }
        web.addJavascriptInterface(Bridge(), "OnyxPhone")
        web.webViewClient = object : WebViewClient() {
            override fun onReceivedError(view: WebView, request: WebResourceRequest, err: WebResourceError) {
                if (request.isForMainFrame) showError()
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val tv = prefs.getString("tv", null) ?: return false
                if (request.url.host == Uri.parse(tv).host) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Exception) { }
                return true
            }
        }

        // Lien direct (QR code scanné avec l'appareil photo puis « ouvrir avec Onyx Remote »)
        intent?.data?.let { if (accept(it.toString())) return }
        if (prefs.getString("tv", null) == null) showWelcome() else loadTv()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.let { accept(it.toString()) }
    }

    override fun onResume() {
        super.onResume()
        Updater.resumePending(this)
        if (!updateChecked) {
            updateChecked = true
            Updater.check(this, "onyx-remote.apk", BuildConfig.VERSION_CODE, false) { o ->
                if (o.optString("status") == "available") Toast.makeText(this, "Mise à jour " + o.optString("version") + " en cours de téléchargement…", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun showWelcome() {
        welcome.visibility = View.VISIBLE; error.visibility = View.GONE; web.visibility = View.INVISIBLE
    }

    private fun showError() {
        welcome.visibility = View.GONE; error.visibility = View.VISIBLE; web.visibility = View.INVISIBLE
        errorText.text = "Impossible de joindre la TV.\nVérifie que l'app Onyx est ouverte sur la TV et que ton téléphone est sur le même Wi-Fi."
    }

    private fun loadTv() {
        val tv = prefs.getString("tv", null) ?: return showWelcome()
        welcome.visibility = View.GONE; error.visibility = View.GONE; web.visibility = View.VISIBLE
        web.loadUrl(tv)
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
        loadTv()
        return true
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.visibility == View.VISIBLE && web.canGoBack()) web.goBack()
        else @Suppress("DEPRECATION") super.onBackPressed()
    }

    inner class Bridge {
        @JavascriptInterface fun deviceName(): String {
            val m = Build.MODEL ?: "Téléphone"
            val brand = (Build.MANUFACTURER ?: "").replaceFirstChar { it.uppercase() }
            return if (m.startsWith(brand, true)) m else "$brand $m".trim()
        }

        @JavascriptInterface fun vibrate(ms: Int) {
            try {
                @Suppress("DEPRECATION")
                val v = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(ms.toLong(), VibrationEffect.DEFAULT_AMPLITUDE))
                else @Suppress("DEPRECATION") v.vibrate(ms.toLong())
            } catch (_: Exception) { }
        }

        @JavascriptInterface fun scan() { runOnUiThread { this@MainActivity.scan() } }

        @JavascriptInterface fun forget() {
            runOnUiThread {
                AlertDialog.Builder(this@MainActivity).setTitle("Oublier cette TV ?")
                    .setPositiveButton("Oublier") { _, _ -> prefs.edit().remove("tv").apply(); showWelcome() }
                    .setNegativeButton("Annuler", null).show()
            }
        }
    }
}
