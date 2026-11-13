package app.onyx.core

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Mises à jour automatiques depuis les « Releases » GitHub du projet.
 * Le tag de version est « v1.0.N » où N = versionCode.
 */
object Updater {
    const val REPO = "kimany91/Onyx"
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var busy = false

    fun check(ctx: Context, assetName: String, currentCode: Int, manual: Boolean, cb: (JSONObject) -> Unit) {
        if (busy) return
        busy = true
        val app = ctx.applicationContext
        Thread {
            try {
                val conn = URL("https://api.github.com/repos/$REPO/releases/latest").openConnection() as HttpURLConnection
                conn.setRequestProperty("Accept", "application/vnd.github+json")
                conn.setRequestProperty("User-Agent", "Onyx-Updater")
                conn.connectTimeout = 15000; conn.readTimeout = 15000
                if (conn.responseCode != 200) {
                    post(cb, JSONObject().put("status", if (manual) "error" else "none").put("manual", manual)
                        .put("message", if (conn.responseCode == 404) "aucune version publique trouvée" else "HTTP ${conn.responseCode}"))
                    return@Thread
                }
                val json = JSONObject(conn.inputStream.bufferedReader().readText())
                val tag = json.optString("tag_name")
                val code = Regex("(\\d+)$").find(tag)?.groupValues?.get(1)?.toIntOrNull() ?: 0
                if (code <= currentCode) {
                    post(cb, JSONObject().put("status", "none").put("manual", manual))
                    return@Thread
                }
                val assets = json.optJSONArray("assets")
                var url: String? = null
                for (i in 0 until (assets?.length() ?: 0)) {
                    val a = assets!!.getJSONObject(i)
                    if (a.optString("name") == assetName) url = a.optString("browser_download_url")
                }
                if (url == null) {
                    post(cb, JSONObject().put("status", "none").put("manual", manual))
                    return@Thread
                }
                post(cb, JSONObject().put("status", "available").put("version", tag.removePrefix("v")).put("manual", manual))
                val dir = File(app.getExternalFilesDir(null) ?: app.cacheDir, "updates").apply { mkdirs() }
                dir.listFiles()?.forEach { it.delete() }
                val file = File(dir, assetName)
                download(url, file) { p -> post(cb, JSONObject().put("status", "downloading").put("progress", p)) }
                post(cb, JSONObject().put("status", "ready").put("version", tag.removePrefix("v")))
                main.post { install(app, file) }
            } catch (e: Exception) {
                post(cb, JSONObject().put("status", "error").put("manual", manual).put("message", e.message ?: "erreur réseau"))
            } finally {
                busy = false
            }
        }.start()
    }

    private fun post(cb: (JSONObject) -> Unit, o: JSONObject) = main.post { cb(o) }

    private fun download(url: String, file: File, progress: (Int) -> Unit) {
        var u = URL(url)
        var conn: HttpURLConnection
        var redirects = 0
        while (true) {
            conn = u.openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("User-Agent", "Onyx-Updater")
            conn.connectTimeout = 20000; conn.readTimeout = 30000
            val c = conn.responseCode
            if (c in 300..399 && redirects < 6) { u = URL(u, conn.getHeaderField("Location")); redirects++; continue }
            if (c != 200) throw Exception("téléchargement HTTP $c")
            break
        }
        val total = conn.contentLengthLong
        var done = 0L
        var last = -1
        conn.inputStream.use { input ->
            file.outputStream().use { out ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    done += n
                    if (total > 0) {
                        val p = (done * 100 / total).toInt()
                        if (p >= last + 5) { last = p; progress(p) }
                    }
                }
            }
        }
    }

    /**
     * Installe la mise à jour.
     * Android 12+ : session PackageInstaller « sans action de l'utilisateur » → silencieuse dès que
     * l'app s'est déjà mise à jour elle-même une fois (Android demande une confirmation la 1re fois).
     * Versions plus anciennes : écran d'installation classique.
     */
    fun install(ctx: Context, file: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ctx.packageManager.canRequestPackageInstalls()) {
            try {
                ctx.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.packageName))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (_: Exception) { }
            pending = file
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try { installWithSession(ctx, file); return } catch (_: Exception) { }
        }
        installWithIntent(ctx, file)
    }

    private fun installWithSession(ctx: Context, file: File) {
        val pi = ctx.packageManager.packageInstaller
        val params = android.content.pm.PackageInstaller.SessionParams(android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(ctx.packageName)
        params.setSize(file.length())
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(android.content.pm.PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = pi.createSession(params)
        pi.openSession(id).use { session ->
            file.inputStream().use { input ->
                session.openWrite("onyx.apk", 0, file.length()).use { out ->
                    input.copyTo(out, 256 * 1024)
                    session.fsync(out)
                }
            }
            val intent = Intent(ctx, InstallReceiver::class.java).setAction(InstallReceiver.ACTION)
            var flags = android.app.PendingIntent.FLAG_UPDATE_CURRENT
            if (Build.VERSION.SDK_INT >= 31) flags = flags or android.app.PendingIntent.FLAG_MUTABLE
            val sender = android.app.PendingIntent.getBroadcast(ctx, id, intent, flags)
            session.commit(sender.intentSender)
        }
    }

    private fun installWithIntent(ctx: Context, file: File) {
        val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N)
            FileProvider.getUriForFile(ctx, ctx.packageName + ".updates", file) else Uri.fromFile(file)
        val i = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try { ctx.startActivity(i) } catch (_: Exception) { }
    }

    /* ---------- Vérification automatique ---------- */
    private const val PREFS = "onyx_updater"
    private var periodic: Runnable? = null

    /** Vérifie si la dernière vérification date de plus de [minIntervalMs] (au démarrage, au retour dans l'app…). */
    fun autoCheck(ctx: Context, assetName: String, currentCode: Int, minIntervalMs: Long, cb: (JSONObject) -> Unit) {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val last = prefs.getLong("last", 0)
        if (System.currentTimeMillis() - last < minIntervalMs) return
        prefs.edit().putLong("last", System.currentTimeMillis()).apply()
        check(ctx, assetName, currentCode, false, cb)
    }

    /** Vérifie régulièrement tant que l'app est ouverte (toutes les 3 h). */
    fun startPeriodic(ctx: Context, assetName: String, currentCode: Int, cb: (JSONObject) -> Unit) {
        val app = ctx.applicationContext
        periodic?.let { main.removeCallbacks(it) }
        val r = object : Runnable {
            override fun run() {
                autoCheck(app, assetName, currentCode, 3 * 3600_000L, cb)
                main.postDelayed(this, 3 * 3600_000L)
            }
        }
        periodic = r
        main.postDelayed(r, 3 * 3600_000L)
    }

    /** APK téléchargé en attente d'autorisation « sources inconnues ». */
    @Volatile var pending: File? = null

    fun resumePending(ctx: Context) {
        val f = pending ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ctx.packageManager.canRequestPackageInstalls()) return
        pending = null
        if (f.exists()) install(ctx, f)
    }
}
