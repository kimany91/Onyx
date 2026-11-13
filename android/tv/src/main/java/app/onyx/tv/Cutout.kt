package app.onyx.tv

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
 * Effet de profondeur sur l'image d'un film, préparé sur la TV avec l'IA de Google (ML Kit) :
 *  - premier plan : le sujet détouré en haute résolution, bords resserrés puis adoucis
 *    (aucun liseré clair du fond) et couleurs d'origine (même éclairage que l'image) ;
 *  - arrière-plan : la même image où le sujet est effacé et la zone reconstruite à partir
 *    du décor voisin. Ainsi, quand les deux plans bougent à des vitesses différentes,
 *    on ne voit jamais le personnage en double.
 * Les deux fichiers sont gardés en cache.
 */
object Cutout {
    private val pool = Executors.newSingleThreadExecutor()
    private val running = HashSet<String>()
    private const val V = "5" // version du traitement (change → anciens découpages ignorés)

    fun dir(ctx: Context) = File(ctx.cacheDir, "cutouts").apply { mkdirs() }

    private fun key(url: String): String =
        MessageDigest.getInstance("SHA-1").digest((V + url).toByteArray()).joinToString("") { "%02x".format(it) }.take(24)

    /** cb(premier plan, arrière-plan, centre du sujet x, y en 0..1) ou nulls si l'image ne s'y prête pas */
    fun request(ctx: Context, url: String, cb: (String?, String?, Float, Float) -> Unit) {
        val k = key(url)
        val fgF = File(dir(ctx), "$k-fg.png")
        val bgF = File(dir(ctx), "$k-bg.jpg")
        val none = File(dir(ctx), "$k.none")
        val ctrF = File(dir(ctx), "$k.ctr")
        if (fgF.exists() && bgF.exists() && ctrF.exists()) {
            val c = ctrF.readText().split(",").mapNotNull { it.toFloatOrNull() }
            cb(fgF.name, bgF.name, c.getOrElse(0) { 0.5f }, c.getOrElse(1) { 0.5f }); return
        }
        if (none.exists()) { cb(null, null, 0.5f, 0.5f); return }
        synchronized(running) { if (!running.add(k)) return }
        pool.execute {
            var ok = false; var cx = 0.5f; var cy = 0.5f
            try {
                val src = download(url) ?: throw IllegalStateException("image")
                val w = src.width; val h = src.height
                val conf = subject(src) ?: person(src)
                val keep = if (conf != null && plausible(conf)) mainSubject(conf, w, h) else null
                if (conf != null && keep != null) {
                    // on ne garde que le sujet principal (les autres éléments restent dans le décor)
                    for (i in conf.indices) if (!keep[i]) conf[i] = 0f
                    var sw = 0f; var sx = 0f; var sy = 0f
                    for (i in conf.indices) { val c = conf[i]; if (c > 0.5f) { sw += c; sx += (i % w) * c; sy += (i / w) * c } }
                    if (sw > 0f) { cx = sx / sw / w; cy = sy / sw / h }
                    val px = IntArray(w * h); src.getPixels(px, 0, w, 0, 0, w, h)
                    // 1) premier plan : masque resserré (seuil élevé + érosion) puis bord adouci
                    val alpha = FloatArray(w * h) { smooth(0.5f, 0.85f, conf[it]) }
                    val tight = erode(alpha, w, h, maxOf(1, w / 640))
                    val soft = blur(tight, w, h, maxOf(1, w / 900))
                    val fg = IntArray(w * h)
                    for (i in fg.indices) { val a = (soft[i] * 255f).toInt().coerceIn(0, 255); fg[i] = (a shl 24) or (px[i] and 0xFFFFFF) }
                    FileOutputStream(fgF).use { Bitmap.createBitmap(fg, w, h, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, it) }
                    // 2) arrière-plan : sujet (élargi) effacé et reconstruit depuis le décor voisin
                    // seul le cœur du sujet est effacé du décor : les bords gardent l'image d'origine (aucun halo),
                    // et le sujet, qui ne fait que grossir autour de son centre, recouvre toujours cette zone
                    val hole = BooleanArray(w * h) { soft[it] > 0.6f }
                    val plate = inpaint(px, w, h, hole)
                    FileOutputStream(bgF).use { Bitmap.createBitmap(plate, w, h, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.JPEG, 92, it) }
                    ctrF.writeText("$cx,$cy")
                    ok = true
                } else none.createNewFile()
                trim(ctx)
            } catch (_: Throwable) {
                try { none.createNewFile() } catch (_: Exception) { }
            } finally {
                synchronized(running) { running.remove(k) }
            }
            if (ok) cb(fgF.name, bgF.name, cx, cy) else cb(null, null, 0.5f, 0.5f)
        }
    }

    private fun download(url: String): Bitmap? {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10000; c.readTimeout = 20000
        c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) Onyx")
        val bytes = c.inputStream.use { it.readBytes() }
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
        var sample = 1
        while (o.outWidth / (sample * 2) >= 1280) sample *= 2 // haute résolution : jusqu'à ~1280-2560 px de large
        val b = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        return if (b.width > 1600) Bitmap.createScaledBitmap(b, 1600, b.height * 1600 / b.width, true) else b
    }

    /** Confiance « sujet » par pixel (n'importe quel objet saillant) — services Google, Android 7+ */
    private fun subject(src: Bitmap): FloatArray? {
        if (Build.VERSION.SDK_INT < 24) return null
        return try {
            val seg = SubjectSegmentation.getClient(SubjectSegmenterOptions.Builder().enableForegroundConfidenceMask().build())
            val r = Tasks.await(seg.process(InputImage.fromBitmap(src, 0)), 30, TimeUnit.SECONDS)
            seg.close()
            val buf = r.foregroundConfidenceMask ?: return null
            buf.rewind()
            FloatArray(src.width * src.height) { if (buf.hasRemaining()) buf.get() else 0f }
        } catch (_: Throwable) { null }
    }

    /** Secours : modèle « personnes » intégré à l'app (sans les services Google) */
    private fun person(src: Bitmap): FloatArray? = try {
        val seg = Segmentation.getClient(SelfieSegmenterOptions.Builder().setDetectorMode(SelfieSegmenterOptions.SINGLE_IMAGE_MODE).build())
        val mask = Tasks.await(seg.process(InputImage.fromBitmap(src, 0)), 30, TimeUnit.SECONDS)
        seg.close()
        val mw = mask.width; val mh = mask.height; val buf = mask.buffer
        buf.rewind()
        val m = FloatArray(mw * mh) { buf.float }
        if (mw == src.width && mh == src.height) m else {
            val w = src.width; val h = src.height
            FloatArray(w * h) { i -> m[((i / w) * mh / h) * mw + (i % w) * mw / w] }
        }
    } catch (_: Throwable) { null }

    /** Le sujet doit occuper une part raisonnable de l'image (ni minuscule, ni toute l'image) */
    private fun plausible(conf: FloatArray): Boolean {
        var on = 0; var n = 0; var i = 0
        while (i < conf.size) { n++; if (conf[i] > 0.6f) on++; i += 7 }
        val f = on.toFloat() / maxOf(1, n)
        return f in 0.04f..0.55f
    }

    /** Plus grand bloc du sujet (grille 1/8) : un seul sujet net, pas des morceaux éparpillés */
    private fun mainSubject(conf: FloatArray, w: Int, h: Int): BooleanArray? {
        val gs = 8; val gw = (w + gs - 1) / gs; val gh = (h + gs - 1) / gs
        val g = BooleanArray(gw * gh)
        for (y in 0 until h step 2) for (x in 0 until w step 2) if (conf[y * w + x] > 0.5f) g[(y / gs) * gw + x / gs] = true
        val lab = IntArray(gw * gh); var best = 0; var bestN = 0; var cur = 0
        val stack = IntArray(gw * gh)
        for (i in g.indices) if (g[i] && lab[i] == 0) {
            cur++; var n = 0; var sp = 0; stack[sp++] = i; lab[i] = cur
            while (sp > 0) {
                val j = stack[--sp]; n++
                val x = j % gw; val y = j / gw
                for (d in 0 until 4) {
                    val nx = x + (if (d == 0) 1 else if (d == 1) -1 else 0); val ny = y + (if (d == 2) 1 else if (d == 3) -1 else 0)
                    if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
                    val k = ny * gw + nx
                    if (g[k] && lab[k] == 0) { lab[k] = cur; stack[sp++] = k }
                }
            }
            if (n > bestN) { bestN = n; best = cur }
        }
        if (best == 0 || bestN < gw * gh * 0.02f) return null
        // bloc élargi d'une case pour garder les bords doux du sujet
        val near = BooleanArray(gw * gh)
        for (i in lab.indices) if (lab[i] == best) { val x = i % gw; val y = i / gw; for (dy in -1..1) for (dx in -1..1) { val nx = x + dx; val ny = y + dy; if (nx in 0 until gw && ny in 0 until gh) near[ny * gw + nx] = true } }
        return BooleanArray(w * h) { near[((it / w) / gs) * gw + (it % w) / gs] }
    }

    private fun smooth(a: Float, b: Float, x: Float): Float { val t = ((x - a) / (b - a)).coerceIn(0f, 1f); return t * t * (3 - 2 * t) }

    /** Érosion (minimum local) : supprime le liseré du fond autour du sujet */
    private fun erode(a: FloatArray, w: Int, h: Int, r: Int): FloatArray {
        val t = FloatArray(a.size); val o = FloatArray(a.size)
        for (y in 0 until h) for (x in 0 until w) { var m = 1f; for (d in -r..r) { val xx = (x + d).coerceIn(0, w - 1); m = minOf(m, a[y * w + xx]) }; t[y * w + x] = m }
        for (y in 0 until h) for (x in 0 until w) { var m = 1f; for (d in -r..r) { val yy = (y + d).coerceIn(0, h - 1); m = minOf(m, t[yy * w + x]) }; o[y * w + x] = m }
        return o
    }

    /** Flou léger du masque : bord net mais doux, comme une vraie découpe photo */
    private fun blur(a: FloatArray, w: Int, h: Int, r: Int): FloatArray {
        val t = FloatArray(a.size); val o = FloatArray(a.size); val n = (2 * r + 1).toFloat()
        for (y in 0 until h) for (x in 0 until w) { var s = 0f; for (d in -r..r) s += a[y * w + (x + d).coerceIn(0, w - 1)]; t[y * w + x] = s / n }
        for (y in 0 until h) for (x in 0 until w) { var s = 0f; for (d in -r..r) s += t[(y + d).coerceIn(0, h - 1) * w + x]; o[y * w + x] = s / n }
        return o
    }

    /** Élargit la zone du sujet (couvre les bords et le déplacement de la parallaxe) */
    private fun dilate(m: BooleanArray, w: Int, h: Int, r: Int): BooleanArray {
        val t = BooleanArray(m.size); val o = BooleanArray(m.size)
        for (y in 0 until h) { var last = -100000; for (x in 0 until w) { if (m[y * w + x]) last = x; if (x - last <= r) t[y * w + x] = true }
            last = 100000; for (x in w - 1 downTo 0) { if (m[y * w + x]) last = x; if (last - x <= r) t[y * w + x] = true } }
        for (x in 0 until w) { var last = -100000; for (y in 0 until h) { if (t[y * w + x]) last = y; if (y - last <= r) o[y * w + x] = true }
            last = 100000; for (y in h - 1 downTo 0) { if (t[y * w + x]) last = y; if (last - y <= r) o[y * w + x] = true } }
        return o
    }

    /**
     * Reconstruction de la zone effacée (« pousser-tirer ») : on réduit l'image en ignorant
     * les pixels du sujet, puis on remonte en comblant les trous avec les couleurs du décor
     * environnant. Rapide, sans bords visibles ; le reste de l'image n'est pas modifié.
     */
    private fun inpaint(px: IntArray, w: Int, h: Int, hole: BooleanArray): IntArray {
        class Lv(val w: Int, val h: Int) { val r = FloatArray(w * h); val g = FloatArray(w * h); val b = FloatArray(w * h); val a = FloatArray(w * h) }
        val levels = ArrayList<Lv>()
        val l0 = Lv(w, h)
        for (i in px.indices) if (!hole[i]) { val c = px[i]; l0.r[i] = ((c shr 16) and 255).toFloat(); l0.g[i] = ((c shr 8) and 255).toFloat(); l0.b[i] = (c and 255).toFloat(); l0.a[i] = 1f }
        levels.add(l0)
        while (levels.last().w > 4 && levels.last().h > 4) {
            val p = levels.last(); val q = Lv((p.w + 1) / 2, (p.h + 1) / 2)
            for (y in 0 until q.h) for (x in 0 until q.w) {
                var r = 0f; var g = 0f; var b = 0f; var a = 0f
                for (dy in 0..1) for (dx in 0..1) { val xx = minOf(p.w - 1, x * 2 + dx); val yy = minOf(p.h - 1, y * 2 + dy); val i = yy * p.w + xx; val wa = p.a[i]; r += p.r[i] * wa; g += p.g[i] * wa; b += p.b[i] * wa; a += wa }
                val j = y * q.w + x
                if (a > 0f) { q.r[j] = r / a; q.g[j] = g / a; q.b[j] = b / a; q.a[j] = minOf(1f, a) }
            }
            levels.add(q)
        }
        for (li in levels.size - 2 downTo 0) {
            val p = levels[li]; val q = levels[li + 1]
            for (y in 0 until p.h) for (x in 0 until p.w) {
                val i = y * p.w + x
                if (p.a[i] >= 1f) continue
                // couleur du niveau supérieur, interpolée
                val fx = ((x - 0.5f) / 2f).coerceIn(0f, (q.w - 1).toFloat()); val fy = ((y - 0.5f) / 2f).coerceIn(0f, (q.h - 1).toFloat())
                val x0 = fx.toInt(); val y0 = fy.toInt(); val x1 = minOf(q.w - 1, x0 + 1); val y1 = minOf(q.h - 1, y0 + 1); val tx = fx - x0; val ty = fy - y0
                fun s(arr: FloatArray) = (arr[y0 * q.w + x0] * (1 - tx) + arr[y0 * q.w + x1] * tx) * (1 - ty) + (arr[y1 * q.w + x0] * (1 - tx) + arr[y1 * q.w + x1] * tx) * ty
                val wa = p.a[i]
                p.r[i] = p.r[i] * wa + s(q.r) * (1 - wa); p.g[i] = p.g[i] * wa + s(q.g) * (1 - wa); p.b[i] = p.b[i] * wa + s(q.b) * (1 - wa); p.a[i] = 1f
            }
        }
        val out = px.copyOf()
        for (i in out.indices) if (hole[i]) {
            out[i] = (0xFF shl 24) or (l0.r[i].toInt().coerceIn(0, 255) shl 16) or (l0.g[i].toInt().coerceIn(0, 255) shl 8) or l0.b[i].toInt().coerceIn(0, 255)
        }
        return out
    }

    /** Cache limité aux 200 derniers fichiers */
    private fun trim(ctx: Context) {
        val files = dir(ctx).listFiles()?.sortedByDescending { it.lastModified() } ?: return
        files.drop(200).forEach { it.delete() }
    }
}
