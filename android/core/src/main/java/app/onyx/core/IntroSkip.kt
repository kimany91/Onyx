package app.onyx.core

import android.media.MediaDataSource
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer

/**
 * « Passer l'intro » : où commence et finit l'intro d'un film ou d'un épisode.
 *  1. Bases communautaires gratuites (TheIntroDB, SkipDB, IntroDB) : génériques de séries,
 *     récapitulatifs, et intros de beaucoup de films.
 *  2. Sinon, pour un film : analyse des 2 premières minutes (logos de studio), voir IntroDetect.
 * Le saut est un simple déplacement dans la vidéo déjà chargée : rien ne se recharge.
 */
object IntroSkip {
    class Seg(val startMs: Long, val endMs: Long, val label: String, val source: String)

    const val INTRO = "Passer l'intro"
    const val RECAP = "Passer le résumé"

    /* ---------- 1. Bases de données ---------- */

    fun lookup(videoId: String, durationMs: Long): List<Seg> {
        val m = Regex("^(tt\\d{5,10})(?::(\\d+):(\\d+))?$").find(videoId) ?: return emptyList()
        val imdb = m.groupValues[1]
        val s = m.groupValues[2]; val e = m.groupValues[3]
        val tv = s.isNotEmpty()
        val q = if (tv) "&season=$s&episode=$e" else ""
        val out = ArrayList<Seg>()
        fun add(start: Long?, end: Long?, label: String, src: String, maxLen: Long) {
            if (end == null || end <= 0) return
            val a = start ?: 0L
            if (end - a < 3000 || end - a > maxLen) return
            if (durationMs > 0 && end > durationMs - 10_000) return
            if (out.any { it.label == label }) return
            out.add(Seg(a, end, label, src))
        }
        // TheIntroDB : listes de segments (start_ms peut être null = début)
        try {
            val o = JSONObject(get("https://api.theintrodb.org/v4/media?imdb_id=$imdb$q" + (if (durationMs > 0) "&duration_ms=$durationMs" else "")) ?: "{}")
            first(o.optJSONArray("intro"))?.let { add(optLong(it, "start_ms"), optLong(it, "end_ms"), INTRO, "theintrodb", 300_000) }
            first(o.optJSONArray("recap"))?.let { add(optLong(it, "start_ms"), optLong(it, "end_ms"), RECAP, "theintrodb", 1_200_000) }
        } catch (_: Exception) { }
        if (out.none { it.label == INTRO }) try {
            val o = JSONObject(get("https://api.skipdb.tv/api/segments?imdb_id=$imdb$q") ?: "{}").optJSONObject("segments")
            o?.optJSONObject("intro")?.let { add(optLong(it, "start_ms"), optLong(it, "end_ms"), INTRO, "skipdb", 300_000) }
            o?.optJSONObject("recap")?.let { add(optLong(it, "start_ms"), optLong(it, "end_ms"), RECAP, "skipdb", 1_200_000) }
        } catch (_: Exception) { }
        if (out.none { it.label == INTRO }) try {
            val o = JSONObject(get("https://api.introdb.app/segments?imdb_id=$imdb" + (if (tv) q else "&is_movie=true")) ?: "{}")
            o.optJSONObject("intro")?.let { add(optLong(it, "start_ms"), optLong(it, "end_ms"), INTRO, "introdb", 300_000) }
            o.optJSONObject("recap")?.let { add(optLong(it, "start_ms"), optLong(it, "end_ms"), RECAP, "introdb", 1_200_000) }
        } catch (_: Exception) { }
        return out.sortedBy { it.startMs }
    }

    private fun first(a: JSONArray?): JSONObject? = if (a != null && a.length() > 0) a.optJSONObject(0) else null
    private fun optLong(o: JSONObject, k: String): Long? = if (o.isNull(k) || !o.has(k)) null else o.optLong(k)

    private fun get(url: String): String? {
        val c = URL(url).openConnection() as HttpURLConnection
        return try {
            c.connectTimeout = 5000; c.readTimeout = 6000
            c.setRequestProperty("User-Agent", "Onyx")
            c.setRequestProperty("Accept", "application/json")
            if (c.responseCode != 200) null else c.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
        } finally { c.disconnect() }
    }

    /* ---------- 2. Analyse des logos de studio ---------- */

    /**
     * Lit les images compressées des ~2 premières minutes (sans les décoder : pas de décodeur vidéo
     * pris au lecteur) et cherche la fin des logos.
     * @param budget octets maximum à lire (source directe : on ne retélécharge pas tout le début)
     */
    fun analyze(url: String, headers: Map<String, String>, budget: Long, stop: () -> Boolean): Seg? {
        if (Build.VERSION.SDK_INT < 23) return null
        val limitUs = 150_000_000L
        val ds = HttpSource(url, headers, budget, stop)
        val ex = MediaExtractor()
        try {
            ex.setDataSource(ds)
            var vt = -1
            for (i in 0 until ex.trackCount) {
                if (ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true) { vt = i; break }
            }
            if (vt < 0) return null
            ex.selectTrack(vt)
            val buf = ByteBuffer.allocateDirect(16 shl 20)
            val ts = ArrayList<Double>(4096); val sz = ArrayList<Int>(4096); val key = ArrayList<Boolean>(4096)
            var maxT = 0.0
            while (!stop()) {
                val t = ex.sampleTime
                if (t < 0 || t > limitUs) break
                val n = if (Build.VERSION.SDK_INT >= 28) ex.sampleSize.toInt() else try { ex.readSampleData(buf, 0) } catch (_: Exception) { 16 shl 20 }
                if (n < 0) break
                ts.add(t / 1e6); sz.add(n); key.add(ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0)
                if (t / 1e6 > maxT) maxT = t / 1e6
                if (!ex.advance()) break
            }
            if (ts.size < 200 || maxT < 50) return null
            val runs = IntroDetect.runsFromFrames(ts.toDoubleArray(), sz.toIntArray(), key.toBooleanArray())
            val end = IntroDetect.decide(runs, maxT)
            return if (end > 0) Seg(0, (end * 1000).toLong(), INTRO, "analyse") else null
        } catch (_: Throwable) {
            return null
        } finally {
            try { ex.release() } catch (_: Throwable) { }
            try { ds.close() } catch (_: Throwable) { }
        }
    }

    /** Source HTTP à requêtes « Range », avec un budget d'octets et arrêt possible à tout moment. */
    private class HttpSource(val url: String, val headers: Map<String, String>, val budget: Long, val stop: () -> Boolean) : MediaDataSource() {
        private var conn: HttpURLConnection? = null
        private var input: InputStream? = null
        private var at = -1L
        private var size = -2L
        private var total = 0L

        private fun open(pos: Long) {
            drop()
            val c = URL(url).openConnection() as HttpURLConnection
            headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
            c.setRequestProperty("Range", "bytes=$pos-")
            c.connectTimeout = 15000; c.readTimeout = 60000
            val code = c.responseCode
            if (code != 206 && !(code == 200 && pos == 0L)) { c.disconnect(); throw IOException("HTTP $code") }
            if (size == -2L) {
                val cr = c.getHeaderField("Content-Range")
                size = cr?.substringAfter('/')?.toLongOrNull() ?: if (code == 200) c.contentLength.toLong() else -1L
            }
            conn = c; input = BufferedInputStream(c.inputStream, 256 * 1024); at = pos
        }

        private fun drop() {
            try { input?.close() } catch (_: Exception) { }
            try { conn?.disconnect() } catch (_: Exception) { }
            input = null; conn = null
        }

        override fun getSize(): Long {
            if (size == -2L) try { open(0) } catch (_: Exception) { size = -1 }
            return size
        }

        override fun readAt(position: Long, buffer: ByteArray, offset: Int, sz: Int): Int {
            if (stop() || total > budget) return -1
            if (size >= 0 && position >= size) return -1
            if (sz == 0) return 0
            if (input == null || position != at) {
                // petit saut en avant (piste audio entrelacée) : on lit et on jette plutôt que de reconnecter
                val i = input
                if (i != null && position > at && position - at < 1024 * 1024) {
                    var skip = position - at
                    while (skip > 0) { val k = i.skip(skip); if (k <= 0) break; skip -= k; at += k; total += k }
                    if (skip > 0) open(position)
                } else open(position)
            }
            val n = input!!.read(buffer, offset, sz)
            if (n < 0) return -1
            at += n; total += n
            return n
        }

        override fun close() { drop() }
    }
}
