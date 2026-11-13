package app.onyx.tv

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Build
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Découpe le sujet principal de l'image d'un film (personnage, véhicule, créature…)
 * avec l'IA de Google (ML Kit), sur la TV elle-même. Le résultat (PNG transparent,
 * même cadrage que l'image d'origine) est gardé en cache : l'interface le superpose
 * au fond et fait bouger les deux plans à des vitesses différentes (effet de profondeur).
 */
object Cutout {
    private val pool = Executors.newSingleThreadExecutor()
    private val running = HashSet<String>()

    fun dir(ctx: Context) = File(ctx.cacheDir, "cutouts").apply { mkdirs() }

    private fun key(url: String): String =
        MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }.take(24)

    /** cb(nom du fichier PNG dans le cache, ou null si l'image ne se prête pas au découpage) */
    fun request(ctx: Context, url: String, cb: (String?) -> Unit) {
        val k = key(url)
        val out = File(dir(ctx), "$k.png")
        val none = File(dir(ctx), "$k.none")
        if (out.exists()) { cb(out.name); return }
        if (none.exists()) { cb(null); return }
        synchronized(running) { if (!running.add(k)) return }
        pool.execute {
            var result: String? = null
            try {
                val src = download(url) ?: throw IllegalStateException("image")
                val fg = subject(src) ?: person(src)
                if (fg != null && plausible(fg)) {
                    FileOutputStream(out).use { fg.compress(Bitmap.CompressFormat.PNG, 100, it) }
                    result = out.name
                } else none.createNewFile()
                trim(ctx)
            } catch (_: Throwable) {
                try { none.createNewFile() } catch (_: Exception) { }
            } finally {
                synchronized(running) { running.remove(k) }
            }
            cb(result)
        }
    }

    private fun download(url: String): Bitmap? {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10000; c.readTimeout = 15000
        c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) Onyx")
        val bytes = c.inputStream.use { it.readBytes() }
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
        var sample = 1
        while (o.outWidth / (sample * 2) >= 960) sample *= 2
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    /** Modèle « sujet » (n'importe quel objet saillant) — services Google, Android 7+ */
    private fun subject(src: Bitmap): Bitmap? {
        if (Build.VERSION.SDK_INT < 24) return null
        return try {
            val seg = SubjectSegmentation.getClient(SubjectSegmenterOptions.Builder().enableForegroundBitmap().build())
            val r = Tasks.await(seg.process(InputImage.fromBitmap(src, 0)), 25, TimeUnit.SECONDS)
            seg.close()
            r.foregroundBitmap
        } catch (_: Throwable) { null }
    }

    /** Secours : modèle « personnes » intégré à l'app (fonctionne sans les services Google) */
    private fun person(src: Bitmap): Bitmap? = try {
        val seg = Segmentation.getClient(SelfieSegmenterOptions.Builder().setDetectorMode(SelfieSegmenterOptions.SINGLE_IMAGE_MODE).build())
        val mask = Tasks.await(seg.process(InputImage.fromBitmap(src, 0)), 25, TimeUnit.SECONDS)
        seg.close()
        val w = mask.width; val h = mask.height; val buf = mask.buffer
        val scaled = if (src.width != w || src.height != h) Bitmap.createScaledBitmap(src, w, h, true) else src
        val px = IntArray(w * h); scaled.getPixels(px, 0, w, 0, 0, w, h)
        buf.rewind()
        for (i in 0 until w * h) {
            val conf = buf.float
            // bord adouci : transition progressive entre 0,35 et 0,75 de confiance
            val a = ((conf - 0.35f) / 0.4f).coerceIn(0f, 1f)
            val p = px[i]
            px[i] = Color.argb((a * 255).toInt(), Color.red(p), Color.green(p), Color.blue(p))
        }
        Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
    } catch (_: Throwable) { null }

    /** Le sujet doit occuper une part raisonnable de l'image (ni minuscule, ni toute l'image) */
    private fun plausible(b: Bitmap): Boolean {
        val w = b.width; val h = b.height; val step = 6
        var n = 0; var on = 0
        var y = 0
        while (y < h) { var x = 0; while (x < w) { n++; if (Color.alpha(b.getPixel(x, y)) > 128) on++; x += step }; y += step }
        val f = on.toFloat() / maxOf(1, n)
        return f in 0.04f..0.62f
    }

    /** Cache limité aux 150 derniers découpages */
    private fun trim(ctx: Context) {
        val files = dir(ctx).listFiles()?.sortedByDescending { it.lastModified() } ?: return
        files.drop(150).forEach { it.delete() }
    }
}
