package app.onyx.core

import java.text.Normalizer

/**
 * Fichier exact d'un épisode dans un pack (saison complète, intégrale, numérotation continue
 * des animés). Renvoie -1 plutôt qu'un autre épisode. Même logique que web/js/match.js.
 */
object EpisodeMatch {
    private val VIDEO = Regex("\\.(mkv|mp4|avi|m4v|ts|m2ts|webm|mov|wmv|mpg|mpeg|flv)$", RegexOption.IGNORE_CASE)
    private val EXTRA = Regex("(^|[/ ._-])(sample|trailer|extras?|featurettes?|ncop|nced|creditless|preview)([/ ._-]|$)", RegexOption.IGNORE_CASE)

    fun norm(t: String): String =
        Normalizer.normalize(t.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")
            .replace("&", " and ").replace(Regex("['’]"), "").replace(Regex("[^a-z0-9]+"), " ").trim()

    private fun seasonsIn(n: String): List<Int> {
        val out = ArrayList<Int>()
        Regex("\\b(?:season|saison|temporada|stagione)\\s*0*(\\d{1,2})\\b").findAll(n).forEach { out.add(it.groupValues[1].toInt()) }
        Regex("\\b(\\d{1,2})(?:st|nd|rd|th)\\s+season\\b").findAll(n).forEach { out.add(it.groupValues[1].toInt()) }
        Regex("\\bs0*(\\d{1,2})\\b(?!\\s*e\\s*\\d)").findAll(n).forEach { out.add(it.groupValues[1].toInt()) }
        return out
    }

    /** Numéro d'épisode « nu » (« [Grp] Titre - 01 [1080p].mkv » → 1), -1 si aucun. */
    fun bareEpisode(base: String): Int {
        val b = base.replace(Regex("\\.[a-zA-Z0-9]{2,4}$"), " ")
            .replace(Regex("\\[[^\\]]*\\]|\\([^)]*\\)|\\{[^}]*\\}"), " ")
            .replace(Regex("\\b\\d{3,4}p\\b|\\bx\\.?26[45]\\b|\\bh\\.?26[45]\\b|\\b(?:8|10|12)\\s?bits?\\b|\\b\\d\\.\\d\\b|\\b(?:19|20)\\d\\d\\b|\\b\\d{1,2}(?:st|nd|rd|th)\\s+season\\b|\\b(?:season|saison)\\s*\\d+\\b|\\bs\\d{1,2}\\b|\\bv\\d\\b", RegexOption.IGNORE_CASE), " ")
        Regex("(?:^|[ ._-])(?:e|ep|episode|épisode|eps)[ ._-]*0*(\\d{1,4})(?!\\d)", RegexOption.IGNORE_CASE).find(b)?.let { return it.groupValues[1].toInt() }
        Regex("\\s-\\s*0*(\\d{1,4})(?:v\\d)?(?=[\\s._-]|$)").find(b)?.let { return it.groupValues[1].toInt() }
        val all = Regex("(?:^|[\\s._])0*(\\d{1,4})(?=[\\s._]|$)").findAll(b).toList()
        return if (all.isNotEmpty()) all.last().groupValues[1].toInt() else -1
    }

    private fun folderSeason(path: String): Int {
        val parts = path.split('/').dropLast(1)
        for (i in parts.indices.reversed()) {
            val ss = seasonsIn(norm(parts[i]))
            if (ss.size == 1) return ss[0]
            if (ss.size > 1) return -2
        }
        return -1
    }

    /** files : (chemin, taille) → index du fichier de l'épisode, ou -1. */
    fun episodeFile(files: List<Pair<String, Long>>, s: Int, e: Int, absIn: Int): Int {
        val abs = if (absIn > 0) absIn else e
        var best = -1; var bestScore = 0; var bestSize = -1L
        files.forEachIndexed { i, (path, size) ->
            if (path.isEmpty() || !VIDEO.containsMatchIn(path)) return@forEachIndexed
            if (EXTRA.containsMatchIn(path) && size < 300_000_000L) return@forEachIndexed
            val base = path.substringAfterLast('/')
            val nb = norm(base)
            var sc: Int
            val m = Regex("\\bs\\s*0*(\\d{1,2})\\s*e\\s*0*(\\d{1,4})\\b").find(nb) ?: Regex("\\b0*(\\d{1,2})x0*(\\d{1,3})\\b").find(nb)
            if (m != null) {
                if (m.groupValues[1].toInt() != s || m.groupValues[2].toInt() != e) return@forEachIndexed
                sc = 100
            } else {
                val m2 = Regex("\\bs0*(\\d{1,2})\\s+0*(\\d{1,4})\\b").find(nb)
                if (m2 != null) {
                    if (m2.groupValues[1].toInt() != s || m2.groupValues[2].toInt() != e) return@forEachIndexed
                    sc = 90
                } else {
                    val fsn = folderSeason(path)
                    val en = bareEpisode(base)
                    if (en < 0) return@forEachIndexed
                    val bs = seasonsIn(norm(base.replace(Regex("\\[[^\\]]*\\]|\\([^)]*\\)"), " ")))
                    val seasonHere = if (fsn > 0) fsn else if (bs.size == 1) bs[0] else -1
                    sc = when {
                        seasonHere > 0 -> if (seasonHere == s && en == e) 85 else return@forEachIndexed
                        en == abs && abs != e -> 75
                        en == e && abs == e -> 70
                        else -> return@forEachIndexed
                    }
                }
            }
            if (sc > bestScore || (sc == bestScore && size > bestSize)) { best = i; bestScore = sc; bestSize = size }
        }
        return best
    }
}
