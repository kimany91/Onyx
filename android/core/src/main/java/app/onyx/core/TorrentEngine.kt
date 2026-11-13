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

    /** Trackers publics de secours (liste « best » de ngosang/trackerslist + HTTPS pour les réseaux qui bloquent l'UDP). */
    private val DEFAULT_TRACKERS = listOf(
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://open.stealth.si:80/announce",
        "udp://tracker.torrent.eu.org:451/announce",
        "udp://open.demonii.com:1337/announce",
        "udp://open.tracker.cl:1337/announce",
        "udp://tracker.qu.ax:6969/announce",
        "udp://tracker.ducks.party:1984/announce",
        "udp://tracker-udp.gbitt.info:80/announce",
        "udp://tracker.tryhackx.org:6969/announce",
        "udp://tracker.theoks.net:6969/announce",
        "udp://tracker.gmi.gd:6969/announce",
        "udp://explodie.org:6969/announce",
        "udp://exodus.desync.com:6969/announce",
        "http://tracker.renfei.net:8080/announce",
        "http://tracker.dler.org:6969/announce",
        "http://tracker2.dler.org:80/announce",
        "https://tracker.pmman.tech:443/announce",
        "https://tracker.nekomi.cn:443/announce",
        "https://tr.nyacat.pw:443/announce",
        "https://open.ftorrent.com:443/announce"
    )
    @Volatile private var trackers: List<String> = DEFAULT_TRACKERS
    private const val VIDEO_EXT = "mkv|mp4|avi|m4v|mov|webm|ts|m2ts|wmv|flv|mpg|mpeg"

    /** Modes : sonde (a-t-il des pairs ?) < préchargement (début + fin) < lecture (tout le fichier). */
    const val PROBE = 0
    const val PREWARM = 1
    const val STREAM = 2
    private const val MAX_ENTRIES = 14

    class Entry(val hash: String, val fileHint: Int, val filename: String?, val trackers: List<String>) {
        /** Poignée disponible dès l'ajout (avant les métadonnées). */
        @Volatile var early: TorrentHandle? = null
        @Volatile var handle: TorrentHandle? = null
        @Volatile var info: TorrentInfo? = null
        @Volatile var fileIndex = -1
        @Volatile var error: String? = null
        @Volatile var lastUse = System.currentTimeMillis()
        @Volatile var cancelled = false
        @Volatile var mode = PROBE
        @Volatile var trickleStarted = false
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
        // pas de file d'attente : tous les torrents (sondes, préchargements, lecture) tournent en même temps
        val sp = SettingsPack()
            .connectionsLimit(300)
            .activeDownloads(60)
            .activeLimit(80)
            .maxPeerlistSize(3000)
        sp.setEnableDht(true)
        sp.setEnableLsd(true)
        sp.setMaxMetadataSize(16 * 1024 * 1024)
        sp.setString(settings_pack.string_types.dht_bootstrap_nodes.swigValue(),
            "dht.libtorrent.org:25401,router.bittorrent.com:6881,router.utorrent.com:6881,dht.transmissionbt.com:6881,dht.aelitis.com:6881")
        sp.setInteger(settings_pack.int_types.connection_speed.swigValue(), 80)
        sp.setInteger(settings_pack.int_types.torrent_connect_boost.swigValue(), 80)
        sp.setInteger(settings_pack.int_types.peer_connect_timeout.swigValue(), 7)
        sp.setInteger(settings_pack.int_types.request_timeout.swigValue(), 10)
        sp.setInteger(settings_pack.int_types.min_reconnect_time.swigValue(), 2)
        val s = SessionManager(false)
        // E/S disque par défaut de libtorrent 2 (fichiers mappés en mémoire) : la plus rapide.
        // Sur Android, ART chaîne les signaux (libsigchain) donc pas de conflit avec la VM.
        // L'état du réseau DHT est réutilisé d'un lancement à l'autre : pairs trouvés en quelques secondes.
        val stateFile = File(cache.parentFile ?: cache, "onyx-session.dat")
        val saved = try { if (stateFile.length() > 0) SessionParams(stateFile.readBytes()) else null } catch (_: Throwable) { null }
        if (saved != null) {
            s.start(saved)
            s.applySettings(sp)
        } else s.start(SessionParams(sp))
        session = s
        Thread {
            while (true) {
                Thread.sleep(if (stateFile.exists()) 120_000 else 45_000)
                try { s.saveState()?.let { stateFile.writeBytes(it) } } catch (_: Throwable) { }
            }
        }.apply { isDaemon = true; start() }
        for (p in 11480..11495) {
            try { val srv = Server(p); srv.start(NanoHTTPD.SOCKET_READ_TIMEOUT, true); server = srv; break } catch (_: Exception) { }
        }
        loadTrackers(cache.parentFile ?: cache)
    }

    /** Liste de trackers à jour (ngosang/trackerslist), gardée en cache pour les démarrages suivants. */
    private fun loadTrackers(base: File) {
        val f = File(base, "onyx-trackers.txt")
        try { if (f.exists()) trackers = (f.readLines().map { it.trim() }.filter { it.contains("://") } + DEFAULT_TRACKERS).distinct() } catch (_: Exception) { }
        Thread {
            val got = ArrayList<String>()
            for (u in listOf("https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt",
                             "https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_best.txt",
                             "https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_all_https.txt")) {
                try {
                    val c = java.net.URL(u).openConnection() as java.net.HttpURLConnection
                    c.connectTimeout = 8000; c.readTimeout = 8000
                    c.inputStream.bufferedReader().readLines().map { it.trim() }.filter { it.contains("://") }.forEach { got.add(it) }
                } catch (_: Exception) { }
            }
            if (got.size >= 5) {
                trackers = (got + DEFAULT_TRACKERS).distinct()
                try { f.writeText(got.distinct().joinToString("\n")) } catch (_: Exception) { }
            }
        }.apply { isDaemon = true; start() }
    }

    /** Espace libre (octets) pour le cache torrent. */
    fun freeSpace(): Long = try { StatFs(dir.path).availableBytes } catch (_: Exception) { -1 }

    /** Prépare (ou réutilise) un torrent dans le mode voulu et renvoie l'URL locale pour le lecteur. */
    fun open(hash: String, fileIdx: Int, filename: String?, sources: List<String>, mode: Int = STREAM): String {
        val h = hash.lowercase()
        var created = false
        val e: Entry
        synchronized(entries) {
            e = entries[h] ?: Entry(h, fileIdx, filename, sources).also { it.mode = mode; entries[h] = it; created = true }
        }
        if (created) start(e)
        else if (mode > e.mode) { e.mode = mode; applyMode(e) }
        if (mode >= PREWARM) e.lastUse = System.currentTimeMillis()
        trim()
        return "http://127.0.0.1:$port/stream/$h"
    }

    /** Préchargement : métadonnées + premiers/derniers morceaux. */
    fun prepare(hash: String, fileIdx: Int, filename: String?, sources: List<String>) { open(hash, fileIdx, filename, sources, PREWARM) }

    /** Sonde plusieurs torrents en parallèle (presque sans débit) pour savoir lesquels ont des pairs. */
    fun probe(list: JSONArray) {
        for (i in 0 until list.length()) {
            val o = list.optJSONObject(i) ?: continue
            val h = o.optString("hash")
            if (h.length != 40) continue
            val src = o.optJSONArray("sources")
            open(h, o.optInt("fileIdx", -1), o.optString("filename").ifEmpty { null },
                if (src == null) emptyList() else (0 until src.length()).map { src.getString(it) }, PROBE)
        }
    }

    /** Ne garde que ces torrents (+ celui en cours de lecture) : libère réseau et disque. */
    fun keepOnly(hashes: Collection<String>) {
        val keep = hashes.map { it.lowercase() }.toSet()
        val now = System.currentTimeMillis()
        entries.values.filter { it.hash !in keep && !(it.mode == STREAM && now - it.lastUse < 60_000) }.forEach { remove(it.hash) }
    }

    /** Applique la stratégie de téléchargement du mode actuel (une fois les métadonnées reçues). */
    private fun applyMode(e: Entry) {
        val th = e.handle ?: return
        val ti = e.info ?: return
        val n = ti.files().numFiles()
        val idx = e.fileIndex
        try {
            when (e.mode) {
                PROBE -> {
                    // reste « intéressé » auprès des pairs, mais quasiment sans débit
                    th.setDownloadLimit(48 * 1024)
                    th.prioritizeFiles(Array(n) { if (it == idx) Priority.LOW else Priority.IGNORE })
                }
                PREWARM -> {
                    th.setDownloadLimit(-1)
                    th.prioritizeFiles(Array(n) { Priority.IGNORE })
                    window(e, 0, 8L * 1024 * 1024, 0, true)
                    val size = ti.files().fileSize(idx)
                    window(e, maxOf(0, size - 4L * 1024 * 1024), 4L * 1024 * 1024, 300, true)
                    startTrickle(e)
                }
                else -> {
                    th.setDownloadLimit(-1)
                    th.prioritizeFiles(Array(n) { if (it == idx) Priority.DEFAULT else Priority.IGNORE })
                    window(e, 0, 8L * 1024 * 1024, 0)
                    val size = ti.files().fileSize(idx)
                    window(e, maxOf(0, size - 4L * 1024 * 1024), 4L * 1024 * 1024, 300)
                }
            }
        } catch (_: Exception) { }
    }

    /** Préchargement terminé (début + fin) → filet à 200 ko/s pour rester débloqué par les pairs. */
    private fun startTrickle(e: Entry) {
        if (e.trickleStarted) return
        e.trickleStarted = true
        Thread {
            val th = e.handle ?: return@Thread
            val t0 = System.currentTimeMillis()
            while (e.mode == PREWARM && !e.cancelled && System.currentTimeMillis() - t0 < 60_000) {
                if (e.prioritized.all { th.havePiece(it) }) break
                Thread.sleep(250)
            }
            if (e.mode == PREWARM && !e.cancelled) try {
                th.setDownloadLimit(200 * 1024)
                val n = e.info?.files()?.numFiles() ?: return@Thread
                th.prioritizeFiles(Array(n) { if (it == e.fileIndex) Priority.LOW else Priority.IGNORE })
            } catch (_: Exception) { }
        }.apply { isDaemon = true; start() }
    }

    /** Limite le nombre de torrents : on retire d'abord les sondes les plus anciennes. */
    private fun trim() {
        if (entries.size <= MAX_ENTRIES) return
        entries.values.sortedWith(compareBy<Entry>({ it.mode }, { it.lastUse }))
            .take(entries.size - MAX_ENTRIES).forEach { remove(it.hash) }
    }

    fun remove(hash: String) {
        val e = entries.remove(hash) ?: return
        e.cancelled = true
        val th = e.handle ?: e.early
        Thread { try { if (th != null && th.isValid) session?.remove(th, SessionHandle.DELETE_FILES) } catch (_: Exception) { } }.start()
    }

    private fun start(e: Entry) = Thread {
        try {
            val s = session ?: throw IOException("moteur torrent indisponible")
            val list = (e.trackers.mapNotNull { if (it.startsWith("tracker:")) it.removePrefix("tracker:") else null } + trackers).distinct()
            val magnet = "magnet:?xt=urn:btih:${e.hash}" + list.joinToString("") { "&tr=" + URLEncoder.encode(it, "UTF-8") }
            // (pas de « ne rien télécharger par défaut » : on resterait « non intéressé » auprès des pairs,
            //  qui mettraient ensuite jusqu'à 15 s à nous envoyer des données)
            s.download(magnet, dir, TorrentFlags.SEQUENTIAL_DOWNLOAD)
            val sha = Sha1Hash.parseHex(e.hash)
            var th: TorrentHandle? = null
            val t0 = System.currentTimeMillis()
            var scraped = false
            // attend les métadonnées (liste des fichiers) en gardant les pairs déjà connectés
            while (!e.cancelled) {
                if (th == null) {
                    th = s.find(sha)
                    if (th != null && th.isValid) {
                        // hors de la file d'attente de libtorrent : le torrent démarre tout de suite
                        th.unsetFlags(TorrentFlags.AUTO_MANAGED)
                        th.resume()
                        e.early = th
                    }
                }
                if (th != null && th.isValid) {
                    if (!scraped && System.currentTimeMillis() - t0 > 2500) { scraped = true; try { th.scrapeTracker() } catch (_: Exception) { } }
                    if (th.status().hasMetadata()) break
                }
                if (System.currentTimeMillis() - t0 > 90_000) throw IOException("aucun pair trouvé pour ce torrent")
                Thread.sleep(150)
            }
            if (e.cancelled || th == null) return@Thread
            val ti = th.torrentFile() ?: throw IOException("métadonnées illisibles")
            val idx = chooseFile(ti, e.fileHint, e.filename)
            if (idx < 0) throw IOException("aucune vidéo dans ce torrent")
            e.info = ti; e.fileIndex = idx; e.handle = th
            applyMode(e)
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

    /** État d'un torrent : seeds annoncés, pairs connectés, débit, progression du fichier. */
    fun stats(hash: String): JSONObject {
        val o = JSONObject()
        val e = entries[hash.lowercase()] ?: return o.put("state", "none")
        o.put("dht", session?.dhtNodes() ?: 0)
        e.error?.let { return o.put("state", "error").put("error", it) }
        val th = e.handle ?: e.early
        val st = try { if (th != null && th.isValid) th.status() else null } catch (_: Exception) { null }
        if (st == null) return o.put("state", "starting").put("peers", 0).put("seeds", 0)
        val seeds = maxOf(st.numComplete(), st.listSeeds(), st.numSeeds())
        o.put("peers", st.numPeers()).put("seeds", seeds).put("known", st.listPeers()).put("speed", st.downloadPayloadRate())
            .put("metadata", st.hasMetadata())
        if (e.handle == null) return o.put("state", "metadata")
        var done = 0.0
        val ti = e.info
        if (ti != null) try {
            val size = ti.files().fileSize(e.fileIndex).toDouble()
            if (size > 0) done = e.handle!!.fileProgress()[e.fileIndex] / size
        } catch (_: Exception) { }
        return o.put("state", "downloading").put("progress", done)
    }

    /** État de plusieurs torrents d'un coup (pour choisir le meilleur torrent vivant). */
    fun health(hashes: JSONArray): JSONObject {
        val o = JSONObject()
        for (i in 0 until hashes.length()) { val h = hashes.optString(i).lowercase(); o.put(h, stats(h)) }
        return o
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
