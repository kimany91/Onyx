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
    private const val BLOCK = 16L * 1024

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
        /** Film en cours de lecture : jamais supprimé tant que le lecteur ne l'a pas libéré. */
        @Volatile var playing = false
        /** Fichier demandé à la lecture (ex. « *S1E1 » pour un pack de saison), prioritaire sur celui de la sonde */
        @Volatile var wantFile: String? = null
        /** L'épisode demandé n'est pas dans ce torrent : on refuse de lire un autre fichier. */
        @Volatile var missing = false
        /** Lecture en cours sur le serveur local (une seule à la fois par torrent). */
        @Volatile var stream: InputStream? = null
        @Volatile var streamPos = 0L
        /** Blocs (16 ko) déjà reçus des morceaux incomplets : servis sans attendre le morceau entier. */
        val blocks = ConcurrentHashMap<Int, ConcurrentHashMap<Int, Long>>()
        /** Lectures passives en cours (analyse de l'intro). */
        val readers = java.util.concurrent.atomic.AtomicInteger()
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
            .connectionsLimit(400)
            .activeDownloads(60)
            .activeLimit(80)
            .maxPeerlistSize(3000)
        sp.setEnableDht(true)
        sp.setEnableLsd(true)
        sp.setMaxMetadataSize(16 * 1024 * 1024)
        sp.setString(settings_pack.string_types.dht_bootstrap_nodes.swigValue(),
            "dht.libtorrent.org:25401,router.bittorrent.com:6881,router.utorrent.com:6881,dht.transmissionbt.com:6881,dht.aelitis.com:6881")
        // profil « streaming rapide »
        sp.setInteger(settings_pack.int_types.connection_speed.swigValue(), 150)
        sp.setInteger(settings_pack.int_types.torrent_connect_boost.swigValue(), 100)
        sp.setBoolean(settings_pack.bool_types.smooth_connects.swigValue(), false)
        // tous les trackers interrogés en même temps (par défaut : un seul à la fois)
        sp.setBoolean(settings_pack.bool_types.announce_to_all_trackers.swigValue(), true)
        sp.setBoolean(settings_pack.bool_types.announce_to_all_tiers.swigValue(), true)
        // plus de demandes en parallèle par pair → la connexion est mieux remplie
        sp.setInteger(settings_pack.int_types.max_out_request_queue.swigValue(), 1500)
        sp.setInteger(settings_pack.int_types.request_queue_time.swigValue(), 3)
        sp.setInteger(settings_pack.int_types.whole_pieces_threshold.swigValue(), 5)
        sp.setBoolean(settings_pack.bool_types.prioritize_partial_pieces.swigValue(), true)
        sp.setBoolean(settings_pack.bool_types.strict_end_game_mode.swigValue(), false)
        // un morceau urgent qui traîne est redemandé à d'autres pairs plus vite
        sp.setInteger(settings_pack.int_types.piece_timeout.swigValue(), 8)
        // les pairs lents ou morts sont remplacés plus souvent
        sp.setInteger(settings_pack.int_types.peer_turnover.swigValue(), 10)
        sp.setInteger(settings_pack.int_types.peer_turnover_cutoff.swigValue(), 90)
        sp.setInteger(settings_pack.int_types.peer_turnover_interval.swigValue(), 60)
        sp.setInteger(settings_pack.int_types.max_failcount.swigValue(), 2)
        sp.setInteger(settings_pack.int_types.inactivity_timeout.swigValue(), 120)
        // on partage en retour avec plus de pairs → ils nous envoient plus de données
        sp.setInteger(settings_pack.int_types.unchoke_slots_limit.swigValue(), 20)
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
        // alertes « bloc reçu » : la lecture peut servir chaque bloc de 16 ko dès son arrivée
        try {
            val cur = s.settings()
            val mask = cur.getInteger(settings_pack.int_types.alert_mask.swigValue()) or
                org.libtorrent4j.swig.alert.block_progress_notification.to_int() or
                org.libtorrent4j.swig.alert.status_notification.to_int()
            s.applySettings(SettingsPack().apply { setInteger(settings_pack.int_types.alert_mask.swigValue(), mask) })
        } catch (_: Throwable) { }
        s.addListener(object : org.libtorrent4j.AlertListener {
            override fun types() = intArrayOf(org.libtorrent4j.alerts.AlertType.BLOCK_FINISHED.swig(), org.libtorrent4j.alerts.AlertType.PIECE_FINISHED.swig(), org.libtorrent4j.alerts.AlertType.HASH_FAILED.swig())
            override fun alert(a: org.libtorrent4j.alerts.Alert<*>) {
                try {
                    when (a) {
                        is org.libtorrent4j.alerts.BlockFinishedAlert -> {
                            val e = blockEntry(a.handle()) ?: return
                            e.blocks.getOrPut(a.pieceIndex()) { ConcurrentHashMap() }[a.blockIndex()] = System.currentTimeMillis()
                        }
                        is org.libtorrent4j.alerts.PieceFinishedAlert -> blockEntry(a.handle())?.blocks?.remove(a.pieceIndex())
                        // morceau corrompu : il sera retéléchargé, ses blocs ne sont plus fiables
                        is org.libtorrent4j.alerts.HashFailedAlert -> blockEntry(a.handle())?.blocks?.remove(a.pieceIndex())
                        else -> { }
                    }
                } catch (_: Throwable) { }
            }
        })
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
        if (mode == STREAM) e.playing = true
        if (!created && !filename.isNullOrEmpty() && filename != e.filename && filename != e.wantFile) {
            // la lecture vise un fichier précis (épisode d'un pack) : on le choisit à nouveau
            e.wantFile = filename
            val ti = e.info
            if (ti != null) {
                val idx = chooseFile(ti, fileIdx, filename)
                e.missing = idx < 0
                if (idx >= 0 && idx != e.fileIndex) { e.fileIndex = idx; e.prioritized.clear(); applyMode(e) }
            }
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
        entries.values.filter { it.hash !in keep && !it.playing && !(it.mode == STREAM && now - it.lastUse < 10 * 60_000) }.forEach { remove(it.hash) }
    }

    /** Le lecteur a fermé ce film : il redevient un torrent ordinaire (gardé un moment pour une reprise rapide). */
    fun stopPlaying(hash: String?) {
        val e = entries[hash?.lowercase() ?: return] ?: return
        e.playing = false
        e.lastUse = System.currentTimeMillis()
        try { e.stream?.close() } catch (_: Exception) { }
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
        entries.values.filter { !it.playing }.sortedWith(compareBy<Entry>({ it.mode }, { it.lastUse }))
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
                        // recherche de pairs immédiate (trackers + DHT)
                        try { th.forceReannounce(); th.forceDHTAnnounce() } catch (_: Exception) { }
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
            val idx = chooseFile(ti, e.fileHint, e.wantFile ?: e.filename)
            if (idx < 0) throw IOException(if ((e.wantFile ?: e.filename ?: "").startsWith("*")) "épisode introuvable dans ce torrent" else "aucune vidéo dans ce torrent")
            e.info = ti; e.fileIndex = idx; e.handle = th
            applyMode(e)
            // peu de pairs après quelques secondes → nouvelle recherche
            val h0 = th
            Thread {
                try {
                    Thread.sleep(8000)
                    if (!e.cancelled && h0.isValid && h0.status().numPeers() < 5) { h0.forceReannounce(); h0.forceDHTAnnounce() }
                } catch (_: Exception) { }
            }.apply { isDaemon = true; start() }
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
        // épisode demandé (« *S1E1 » ou « *S2E1A14 », A = numéro absolu) : le bon fichier ou rien.
        // Jamais « le plus gros fichier » d'un pack : ce serait un autre épisode.
        val ep = if (filename != null) Regex("^\\*S(\\d+)E(\\d+)(?:A(\\d+))?$", RegexOption.IGNORE_CASE).find(filename) else null
        if (ep != null) {
            val s = ep.groupValues[1].toInt(); val e = ep.groupValues[2].toInt()
            val abs = ep.groupValues[3].toIntOrNull() ?: e
            val files = (0 until n).map { i -> if (fs.padFileAt(i)) "" to 0L else fs.filePath(i).replace('\\', '/') to fs.fileSize(i) }
            return EpisodeMatch.episodeFile(files, s, e, abs)
        }
        if (hint in 0 until n && !fs.padFileAt(hint) && fs.fileSize(hint) > 30L * 1024 * 1024 && video.matches(fs.fileName(hint))) return hint
        var best = -1; var bestSize = -1L
        for (i in 0 until n) {
            if (fs.padFileAt(i) || !video.matches(fs.fileName(i))) continue
            if (fs.fileSize(i) > bestSize) { bestSize = fs.fileSize(i); best = i }
        }
        return best
    }

    /** Fixe des échéances pour les morceaux couvrant [start, start+len) du fichier (lecture prioritaire). */
    private fun window(e: Entry, start: Long, len: Long, baseDeadline: Int, forcePriority: Boolean = false, spacing: Int = 150) {
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
                th.setPieceDeadline(p, baseDeadline + k * spacing)
            }
            k++
        }
    }

    /** Torrent concerné par une alerte de bloc. */
    private fun blockEntry(h: TorrentHandle?): Entry? {
        if (h == null) return null
        return entries[h.infoHash().toHex()]
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
        // part du début (8 Mo) et de la fin (4 Mo) du fichier déjà reçue : ce qu'il faut pour démarrer.
        // Compté au bloc près (16 ko), y compris les pièces en cours : la progression avance en continu.
        var head = 0.0; var headHave = 0L; var headNeed = 0L
        if (ti != null) try {
            val th = e.handle!!
            val fs = ti.files(); val pl = ti.pieceLength().toLong()
            val fStart = fs.fileOffset(e.fileIndex); val fSize = fs.fileSize(e.fileIndex)
            val ps = LinkedHashSet<Int>()
            for (p in (fStart / pl).toInt()..((fStart + minOf(fSize, 8L * 1024 * 1024)) / pl).toInt()) ps.add(p)
            for (p in ((fStart + maxOf(0, fSize - 4L * 1024 * 1024)) / pl).toInt()..((fStart + fSize - 1) / pl).toInt()) ps.add(p)
            val partial = HashMap<Int, Double>()
            try {
                for (q in th.getDownloadQueue()) {
                    val n = maxOf(1, q.blocksInPiece())
                    partial[q.pieceIndex()] = (q.finished() + q.writing()).toDouble() / n
                }
            } catch (_: Exception) { }
            var have = 0.0
            for (p in ps) have += if (th.havePiece(p)) 1.0 else (partial[p] ?: 0.0)
            head = have / maxOf(1, ps.size)
            headNeed = ps.size * pl
            headHave = (head * headNeed).toLong()
        } catch (_: Exception) { }
        o.put("headHave", headHave).put("headNeed", headNeed)
        return o.put("state", "downloading").put("progress", done).put("head", head)
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
            if (e.missing) return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "épisode introuvable dans ce torrent")
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
            // « passive » : lecture d'analyse (détection de l'intro) qui ne touche pas aux priorités du film
            val passive = session.parameters?.get("passive")?.firstOrNull() == "1"
            val body: InputStream = if (session.method == Method.HEAD) "".byteInputStream() else PieceStream(e, start, end, passive)
            val resp = newFixedLengthResponse(if (range != null) Response.Status.PARTIAL_CONTENT else Response.Status.OK, mime, body, len)
            resp.addHeader("Accept-Ranges", "bytes")
            if (range != null) resp.addHeader("Content-Range", "bytes $start-$end/$size")
            return resp
        }
    }

    /** Lit le fichier au fur et à mesure que les morceaux arrivent (bloque tant qu'ils manquent). */
    private class PieceStream(val e: Entry, var pos: Long, val end: Long, val passive: Boolean = false) : InputStream() {
        private var raf: RandomAccessFile? = null
        private val ti = e.info!!
        private val pl = ti.pieceLength().toLong()
        private val fileStart = ti.files().fileOffset(e.fileIndex)
        private val path = File(dir, ti.files().filePath(e.fileIndex))
        private var lastWindowPiece = -1000
        private var closed = false
        private val fileSize = ti.files().fileSize(e.fileIndex)
        /** Débit moyen du film (taille / ~2 h) : sert à garder ~90 s de vidéo d'avance en priorité. */
        private val rate = maxOf(256L * 1024, fileSize / 7200)
        private val ahead = (rate * 90).coerceIn(64L * 1024 * 1024, 512L * 1024 * 1024)
        /** Écart réel entre deux morceaux à la vitesse de lecture (ms), borné pour rester urgent. */
        private val spacing = ((pl * 1000 / rate).toInt()).coerceIn(80, 1500)

        init { if (!passive) startActive() else e.readers.incrementAndGet() }

        private fun startActive() {
            val th = e.handle
            val prev = e.stream
            // saut dans le film : les anciennes échéances (déjà dépassées, donc « ultra urgentes »)
            // passeraient avant la nouvelle position → on les efface et on ferme l'ancienne lecture
            // (liste urgente vidée puis reremplie : libtorrent annule aussi les demandes non urgentes en cours)
            if (th != null && (prev == null || kotlin.math.abs(pos - e.streamPos) > 32L * 1024 * 1024)) {
                try { th.clearPieceDeadlines() } catch (_: Exception) { }
            }
            if (prev != null && prev !== this) try { prev.close() } catch (_: Exception) { }
            e.stream = this; e.streamPos = pos
            // les premiers Mo à la nouvelle position passent avant tout le reste
            window(e, pos, 16L * 1024 * 1024, 0, true, 60)
            window(e, pos, ahead, 0, false, spacing)
        }

        override fun read(): Int {
            val b = ByteArray(1)
            return if (read(b, 0, 1) <= 0) -1 else b[0].toInt() and 0xff
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (pos > end) return -1
            val th = e.handle ?: throw IOException("torrent fermé")
            val piece = ((fileStart + pos) / pl).toInt()
            // fenêtre glissante (~90 s de film) devant la lecture, échéances rafraîchies à chaque morceau
            if (!passive && piece != lastWindowPiece) { lastWindowPiece = piece; window(e, pos, ahead, 0, false, spacing) }
            var waited = 0
            var ready = -1L
            var lastGot = -1; var stallSince = 0
            while (!th.havePiece(piece)) {
                if (closed || e.cancelled || !th.isValid) throw IOException("lecture interrompue")
                // morceau incomplet : les blocs déjà reçus sont servis tout de suite
                // (sinon il faut attendre tout le morceau, 4 à 16 Mo sur un vrai film, avant la première image)
                ready = readyBytes(piece, pos)
                if (ready > 0) break
                Thread.sleep(30)
                waited += 30
                // lecture d'analyse : on attend sans rien exiger, et on abandonne si rien ne vient
                if (passive) { if (waited > 90_000) throw IOException("délai dépassé"); continue }
                // morceau bloquant qui n'avance plus depuis 1,5 s : libtorrent l'a « oublié » (vu en test : la moitié
                // des blocs reçus, le reste jamais redemandé, il passe aux morceaux suivants). On annule tout
                // et on redemande à partir d'ici : la liste urgente vide déclenche l'annulation des autres demandes.
                val got = e.blocks[piece]?.size ?: 0
                if (got != lastGot) { lastGot = got; stallSince = waited }
                if (waited - stallSince >= 1500) {
                    stallSince = waited
                    try { th.clearPieceDeadlines() } catch (_: Exception) { }
                    window(e, pos, 16L * 1024 * 1024, 0, true, 60)
                    window(e, pos, ahead, 0, false, spacing)
                }
            }
            e.lastUse = System.currentTimeMillis()
            val pieceEndInFile = (piece + 1) * pl - fileStart
            val n = minOf(len.toLong(), end - pos + 1, pieceEndInFile - pos, if (ready > 0) ready else Long.MAX_VALUE).toInt()
            val f = raf ?: RandomAccessFile(path, "r").also { raf = it }
            f.seek(pos)
            var r = f.read(b, off, n)
            // bloc annoncé mais pas encore écrit sur le disque (TV lente) : que des zéros → on relit un peu plus tard
            var tries = 0
            while (ready > 0 && r >= 4096 && tries < 40 && allZero(b, off, r) && !th.havePiece(piece)) {
                if (closed) throw IOException("lecture interrompue")
                Thread.sleep(50); tries++
                f.seek(pos); r = f.read(b, off, n)
            }
            if (r <= 0) { Thread.sleep(20); return 0 }
            pos += r
            if (!passive && e.stream === this) e.streamPos = pos
            return r
        }

        private fun allZero(b: ByteArray, off: Int, n: Int): Boolean {
            for (i in off until off + n) if (b[i].toInt() != 0) return false
            return true
        }

        /** Octets lisibles d'affilée à partir de pos dans un morceau incomplet (blocs reçus depuis > 150 ms). */
        private fun readyBytes(piece: Int, pos: Long): Long {
            val got = e.blocks[piece] ?: return 0
            val inPiece = fileStart + pos - piece.toLong() * pl
            var blk = (inPiece / BLOCK).toInt()
            val limit = System.currentTimeMillis() - 150
            var n = 0L
            while (true) {
                val t = got[blk] ?: break
                if (t > limit) break
                n += (blk + 1L) * BLOCK - maxOf(inPiece, blk.toLong() * BLOCK)
                blk++
                if (blk.toLong() * BLOCK >= pl) break
            }
            return n
        }

        override fun close() {
            if (passive && !closed) e.readers.decrementAndGet()
            closed = true
            if (!passive && e.stream === this) e.stream = null
            try { raf?.close() } catch (_: Exception) { }
        }
    }

    fun parseSources(json: String?): List<String> = try {
        val a = JSONArray(json ?: "[]"); (0 until a.length()).map { a.getString(it) }
    } catch (_: Exception) { emptyList() }
}
