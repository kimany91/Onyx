package app.onyx.core

import android.content.Context
import android.os.StatFs
import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject
import org.libtorrent4j.Priority
import org.libtorrent4j.SessionManager
import org.libtorrent4j.SessionParams
import org.libtorrent4j.SettingsPack
import org.libtorrent4j.Sha1Hash
import org.libtorrent4j.TorrentFlags
import org.libtorrent4j.TorrentHandle
import org.libtorrent4j.TorrentInfo
import org.libtorrent4j.SessionHandle
import org.libtorrent4j.swig.settings_pack
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Moteur de streaming torrent intégré (comme le serveur de Stremio) :
 *  - ajoute le torrent par son hash (+ trackers publics pour trouver vite des pairs),
 *  - télécharge le fichier dans l'ordre, en priorité le début et la fin (index MKV/MP4),
 *  - le sert au lecteur en HTTP local (http://127.0.0.1:PORT/stream/HASH) avec support des « Range » :
 *    le lecteur démarre dès les premiers morceaux, quelle que soit la taille du fichier.
 */
object TorrentEngine {

    private val TRACKERS = listOf(
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://open.stealth.si:80/announce",
        "udp://tracker.torrent.eu.org:451/announce",
        "udp://exodus.desync.com:6969/announce",
        "udp://open.demonii.com:1337/announce",
        "udp://explodie.org:6969/announce",
        "udp://tracker.dler.org:6969/announce",
        "udp://tracker.tiny-vps.com:6969/announce",
        "udp://tracker.openbittorrent.com:6969/announce",
        "udp://opentracker.io:6969/announce",
        "udp://tracker.theoks.net:6969/announce",
        "https://tracker.tamersunion.org:443/announce"
    )
    private const val VIDEO_EXT = "mkv|mp4|avi|m4v|mov|webm|ts|m2ts|wmv|flv|mpg|mpeg"

    class Entry(val hash: String, val fileHint: Int, val filename: String?, val trackers: List<String>) {
        @Volatile var handle: TorrentHandle? = null
        @Volatile var info: TorrentInfo? = null
        @Volatile var fileIndex = -1
        @Volatile var error: String? = null
        @Volatile var lastUse = System.currentTimeMillis()
        @Volatile var cancelled = false
        /** Préchargement seul : uniquement le début et la fin du fichier, pas le reste. */
        @Volatile var prewarmOnly = false
        /** Morceaux déjà rendus prioritaires (évite des milliers d'appels inutiles). */
        val prioritized: MutableSet<Int> = ConcurrentHashMap.newKeySet()
        val ready = CountDownLatch(1)
    }

    var session: SessionManager? = null
        private set
    private var server: Server? = null
    private lateinit var dir: File
    private val entries = ConcurrentHashMap<String, Entry>()

    val port: Int get() = server?.listeningPort ?: 0

    @Synchronized
    fun init(ctx: Context) { initWithDir(File(ctx.cacheDir, "torrents")) }

    /** Démarre la session dans le dossier de cache donné (aussi utilisé par les tests). */
    @Synchronized
    fun initWithDir(cache: File) {
        if (session != null) return
        dir = cache
        dir.deleteRecursively()
        dir.mkdirs()
        val sp = SettingsPack()
            .connectionsLimit(200)
            .activeDownloads(3)
            .activeLimit(6)
            .maxPeerlistSize(2000)
        sp.setString(settings_pack.string_types.dht_bootstrap_nodes.swigValue(),
            "dht.libtorrent.org:25401,router.bittorrent.com:6881,router.utorrent.com:6881,dht.transmissionbt.com:6881,dht.aelitis.com:6881")
        sp.setInteger(settings_pack.int_types.connection_speed.swigValue(), 60)
        sp.setInteger(settings_pack.int_types.torrent_connect_boost.swigValue(), 60)
        sp.setInteger(settings_pack.int_types.peer_connect_timeout.swigValue(), 7)
        sp.setInteger(settings_pack.int_types.request_timeout.swigValue(), 10)
        sp.setInteger(settings_pack.int_types.min_reconnect_time.swigValue(), 2)
        val s = SessionManager(false)
        // E/S disque par défaut de libtorrent 2 (fichiers mappés en mémoire) : la plus rapide.
        // Sur Android, ART chaîne les signaux (libsigchain) donc pas de conflit avec la VM.
        s.start(SessionParams(sp))
        session = s
        for (p in 11480..11495) {
            try { val srv = Server(p); srv.start(NanoHTTPD.SOCKET_READ_TIMEOUT, true); server = srv; break } catch (_: Exception) { }
        }
    }

    /** Espace libre (octets) pour le cache torrent. */
    fun freeSpace(): Long = try { StatFs(dir.path).availableBytes } catch (_: Exception) { -1 }

    /** Prépare (ou réutilise) un torrent et renvoie l'URL locale à donner au lecteur. */
    fun open(hash: String, fileIdx: Int, filename: String?, sources: List<String>, prewarm: Boolean = false): String {
        val h = hash.lowercase()
        var created = false
        val e = entries[h] ?: Entry(h, fileIdx, filename, sources).also { it.prewarmOnly = prewarm; entries[h] = it; created = true }
        if (created) start(e)
        else if (!prewarm && e.prewarmOnly) { e.prewarmOnly = false; activate(e) }
        e.lastUse = System.currentTimeMillis()
        trim(h)
        return "http://127.0.0.1:$port/stream/$h"
    }

    /** Préchargement : récupère les métadonnées et les premiers/derniers morceaux à l'avance. */
    fun prepare(hash: String, fileIdx: Int, filename: String?, sources: List<String>) { open(hash, fileIdx, filename, sources, true) }

    /** Passage du préchargement à la lecture : tout le fichier devient prioritaire. */
    private fun activate(e: Entry) {
        val th = e.handle ?: return
        val ti = e.info ?: return
        try {
            th.setDownloadLimit(-1)
            th.prioritizeFiles(Array(ti.files().numFiles()) { if (it == e.fileIndex) Priority.DEFAULT else Priority.IGNORE })
        } catch (_: Exception) { }
    }

    /** Garde au plus 2 torrents (lecture en cours + préchargement), supprime les autres. */
    private fun trim(keep: String) {
        val others = entries.values.filter { it.hash != keep }.sortedByDescending { it.lastUse }
        others.drop(1).forEach { remove(it.hash) }
    }

    fun remove(hash: String) {
        val e = entries.remove(hash) ?: return
        e.cancelled = true
        val th = e.handle
        Thread { try { if (th != null && th.isValid) session?.remove(th, SessionHandle.DELETE_FILES) } catch (_: Exception) { } }.start()
    }

    private fun start(e: Entry) = Thread {
        try {
            val s = session ?: throw IOException("moteur torrent indisponible")
            val trackers = (e.trackers.mapNotNull { if (it.startsWith("tracker:")) it.removePrefix("tracker:") else null } + TRACKERS).distinct()
            val magnet = "magnet:?xt=urn:btih:${e.hash}" + trackers.joinToString("") { "&tr=" + URLEncoder.encode(it, "UTF-8") }
            // (pas de « ne rien télécharger par défaut » : on resterait « non intéressé » auprès des pairs,
            //  qui mettraient ensuite jusqu'à 15 s à nous envoyer des données)
            s.download(magnet, dir, TorrentFlags.SEQUENTIAL_DOWNLOAD)
            val sha = Sha1Hash.parseHex(e.hash)
            var th: TorrentHandle? = null
            val t0 = System.currentTimeMillis()
            // attend les métadonnées (liste des fichiers) en gardant les pairs déjà connectés
            while (!e.cancelled) {
                th = th ?: s.find(sha)
                if (th != null && th.isValid && th.status().hasMetadata()) break
                if (System.currentTimeMillis() - t0 > 90_000) throw IOException("aucun pair trouvé pour ce torrent")
                Thread.sleep(150)
            }
            if (e.cancelled || th == null) return@Thread
            val ti = th.torrentFile() ?: throw IOException("métadonnées illisibles")
            val idx = chooseFile(ti, e.fileHint, e.filename)
            if (idx < 0) throw IOException("aucune vidéo dans ce torrent")
            val fs = ti.files()
            th.prioritizeFiles(Array(fs.numFiles()) { if (it == idx && !e.prewarmOnly) Priority.DEFAULT else Priority.IGNORE })
            e.info = ti; e.fileIndex = idx; e.handle = th
            if (!e.prewarmOnly) activate(e)
            // début (lecture) puis fin du fichier (index MKV/MP4) en priorité absolue
            window(e, 0, 8L * 1024 * 1024, 0, e.prewarmOnly)
            val size = fs.fileSize(idx)
            window(e, maxOf(0, size - 4L * 1024 * 1024), 4L * 1024 * 1024, 300, e.prewarmOnly)
            if (e.prewarmOnly) {
                // début et fin prêts → on continue « au compte-gouttes » (200 ko/s) : on reste
                // intéressé auprès des pairs, qui ne nous coupent pas → la lecture repart à pleine vitesse
                val ready0 = System.currentTimeMillis()
                while (e.prewarmOnly && !e.cancelled && System.currentTimeMillis() - ready0 < 60_000) {
                    if (e.prioritized.all { th.havePiece(it) }) break
                    Thread.sleep(250)
                }
                if (e.prewarmOnly && !e.cancelled) {
                    th.setDownloadLimit(200 * 1024)
                    th.prioritizeFiles(Array(fs.numFiles()) { if (it == idx) Priority.LOW else Priority.IGNORE })
                }
            }
        } catch (ex: Exception) {
            e.error = ex.message ?: "erreur torrent"
        } finally {
            e.ready.countDown()
        }
    }.apply { isDaemon = true; start() }

    private fun chooseFile(ti: TorrentInfo, hint: Int, filename: String?): Int {
        val fs = ti.files()
        val n = fs.numFiles()
        if (!filename.isNullOrEmpty()) {
            for (i in 0 until n) if (!fs.padFileAt(i) && fs.fileName(i).equals(filename, true)) return i
        }
        val video = Regex(".*\\.($VIDEO_EXT)$", RegexOption.IGNORE_CASE)
        if (hint in 0 until n && !fs.padFileAt(hint) && fs.fileSize(hint) > 30L * 1024 * 1024 && video.matches(fs.fileName(hint))) return hint
        var best = -1; var bestSize = -1L
        for (i in 0 until n) {
            if (fs.padFileAt(i) || !video.matches(fs.fileName(i))) continue
            if (fs.fileSize(i) > bestSize) { bestSize = fs.fileSize(i); best = i }
        }
        return best
    }

    /** Fixe des échéances pour les morceaux couvrant [start, start+len) du fichier (lecture prioritaire). */
    private fun window(e: Entry, start: Long, len: Long, baseDeadline: Int, forcePriority: Boolean = false) {
        val ti = e.info ?: return
        val th = e.handle ?: return
        val fs = ti.files()
        val pl = ti.pieceLength().toLong()
        val fileStart = fs.fileOffset(e.fileIndex)
        val fileEnd = fileStart + fs.fileSize(e.fileIndex) - 1
        val first = ((fileStart + start) / pl).toInt()
        val last = (minOf(fileEnd, fileStart + start + len) / pl).toInt()
        var k = 0
        for (p in first..last) {
            if (!th.havePiece(p)) {
                // en préchargement le fichier est ignoré : il faut autoriser ces morceaux un par un
                if (forcePriority && e.prioritized.add(p)) th.piecePriority(p, Priority.TOP_PRIORITY)
                // échéances toujours dans le futur (rafraîchies au fil de la lecture)
                th.setPieceDeadline(p, baseDeadline + k * 150)
            }
            k++
        }
    }

    /** État pour l'interface : pairs, débit, progression. */
    fun stats(hash: String): JSONObject {
        val o = JSONObject()
        val e = entries[hash.lowercase()] ?: return o.put("state", "none")
        e.error?.let { return o.put("state", "error").put("error", it) }
        val th = e.handle
        if (th == null || !th.isValid) {
            val s = session?.find(Sha1Hash.parseHex(e.hash))
            val st = try { s?.status() } catch (_: Exception) { null }
            return o.put("state", "metadata").put("peers", st?.numPeers() ?: 0).put("speed", st?.downloadPayloadRate() ?: 0)
        }
        val st = th.status()
        val ti = e.info
        var done = 0.0
        if (ti != null) try {
            val size = ti.files().fileSize(e.fileIndex).toDouble()
            if (size > 0) done = th.fileProgress()[e.fileIndex] / size
        } catch (_: Exception) { }
        return o.put("state", "downloading").put("peers", st.numPeers()).put("speed", st.downloadPayloadRate())
            .put("progress", done)
    }

    /* ---------- Serveur HTTP local (Range) ---------- */
    private class Server(port: Int) : NanoHTTPD("127.0.0.1", port) {
        override fun serve(session: IHTTPSession): Response {
            val parts = (session.uri ?: "").trim('/').split('/')
            if (parts.size >= 2 && parts[0] == "stats") return newFixedLengthResponse(Response.Status.OK, "application/json", stats(parts[1]).toString())
            if (parts.size < 2 || parts[0] != "stream") return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "")
            val e = entries[parts[1]] ?: return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "torrent inconnu")
            e.lastUse = System.currentTimeMillis()
            if (!e.ready.await(120, TimeUnit.SECONDS) || e.error != null || e.info == null)
                return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", e.error ?: "délai dépassé")
            val ti = e.info!!
            val fs = ti.files()
            val size = fs.fileSize(e.fileIndex)
            val name = fs.fileName(e.fileIndex)
            val mime = when (name.substringAfterLast('.').lowercase()) {
                "mp4", "m4v", "mov" -> "video/mp4"; "webm" -> "video/webm"; "avi" -> "video/x-msvideo"
                "ts", "m2ts" -> "video/mp2t"; else -> "video/x-matroska"
            }
            var start = 0L
            var end = size - 1
            val range = session.headers["range"]
            if (range != null && range.startsWith("bytes=")) {
                val r = range.removePrefix("bytes=").split('-')
                start = r[0].toLongOrNull() ?: 0
                if (r.size > 1 && r[1].isNotEmpty()) end = minOf(size - 1, r[1].toLong())
            }
            if (start >= size) {
                val resp = newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, "text/plain", "")
                resp.addHeader("Content-Range", "bytes */$size")
                return resp
            }
            val len = end - start + 1
            val body: InputStream = if (session.method == Method.HEAD) "".byteInputStream() else PieceStream(e, start, end)
            val resp = newFixedLengthResponse(if (range != null) Response.Status.PARTIAL_CONTENT else Response.Status.OK, mime, body, len)
            resp.addHeader("Accept-Ranges", "bytes")
            if (range != null) resp.addHeader("Content-Range", "bytes $start-$end/$size")
            return resp
        }
    }

    /** Lit le fichier au fur et à mesure que les morceaux arrivent (bloque tant qu'ils manquent). */
    private class PieceStream(val e: Entry, var pos: Long, val end: Long) : InputStream() {
        private var raf: RandomAccessFile? = null
        private val ti = e.info!!
        private val pl = ti.pieceLength().toLong()
        private val fileStart = ti.files().fileOffset(e.fileIndex)
        private val path = File(dir, ti.files().filePath(e.fileIndex))
        private var lastWindowPiece = -1000
        private val step = 1
        private var closed = false

        init { window(e, pos, 16L * 1024 * 1024, 0) }

        override fun read(): Int {
            val b = ByteArray(1)
            return if (read(b, 0, 1) <= 0) -1 else b[0].toInt() and 0xff
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (pos > end) return -1
            val th = e.handle ?: throw IOException("torrent fermé")
            val piece = ((fileStart + pos) / pl).toInt()
            // fenêtre glissante de 24 Mo devant la lecture, échéances rafraîchies à chaque morceau
            if (piece >= lastWindowPiece + step || piece < lastWindowPiece) { lastWindowPiece = piece; window(e, pos, 24L * 1024 * 1024, 0) }
            while (!th.havePiece(piece)) {
                if (closed || e.cancelled || !th.isValid) throw IOException("lecture interrompue")
                Thread.sleep(30)
            }
            e.lastUse = System.currentTimeMillis()
            val pieceEndInFile = (piece + 1) * pl - fileStart
            val n = minOf(len.toLong(), end - pos + 1, pieceEndInFile - pos).toInt()
            val f = raf ?: RandomAccessFile(path, "r").also { raf = it }
            f.seek(pos)
            val r = f.read(b, off, n)
            if (r <= 0) { Thread.sleep(20); return 0 }
            pos += r
            return r
        }

        override fun close() { closed = true; try { raf?.close() } catch (_: Exception) { } }
    }

    fun parseSources(json: String?): List<String> = try {
        val a = JSONArray(json ?: "[]"); (0 until a.length()).map { a.getString(it) }
    } catch (_: Exception) { emptyList() }
}
