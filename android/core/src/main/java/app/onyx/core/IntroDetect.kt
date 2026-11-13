package app.onyx.core

/**
 * Détection des logos de studio au début d'un film (Disney, Warner, Marvel…).
 *
 * Les logos se suivent au tout début, chacun dure 5 à 40 s et ils sont séparés par un passage
 * au noir (ou une image figée). Le film commence après le dernier de ces passages, suivi d'un long
 * moment sans coupure au noir.
 *
 * Deux façons de repérer les passages au noir, même règle de décision ensuite :
 *  - lecteur natif : la taille des images compressées (une image noire ou figée pèse presque rien),
 *    lue sans décoder la vidéo → aucun impact sur la lecture ;
 *  - lecteur PC : la luminosité réelle des images (voir intro.js).
 */
object IntroDetect {
    /** Passage au noir / image figée : [début, fin] en secondes. */
    class Run(val start: Double, val end: Double)

    /**
     * Passages au noir à partir des images compressées (ordre quelconque).
     * @param t instant de chaque image (s), @param size taille (octets), @param key image clé
     */
    fun runsFromFrames(t: DoubleArray, size: IntArray, key: BooleanArray): List<Run> {
        val n = t.size
        if (n < 60) return emptyList()
        val order = (0 until n).sortedBy { t[it] }
        val med = median(size.toList())
        val keySizes = (0 until n).filter { key[it] }.map { size[it] }
        val keyMed = if (keySizes.size >= 3) median(keySizes) else med * 8.0
        // durée d'une image
        val dts = (1 until order.size).map { t[order[it]] - t[order[it - 1]] }.filter { it > 0 }
        val dt = if (dts.isEmpty()) 1 / 24.0 else median(dts.map { (it * 1e6).toInt() }) / 1e6
        val tiny = maxOf(90.0, med * 0.025)
        val tinyKey = maxOf(400.0, keyMed * 0.03)
        val out = ArrayList<Run>()
        var rs = -1.0; var last = -1.0
        for (i in order) {
            val small = if (key[i]) size[i] < tinyKey else size[i] < tiny
            if (small) {
                if (rs < 0) rs = t[i]
                last = t[i]
            } else if (rs >= 0) {
                val end = last + dt
                if (end - rs >= 0.3) out.add(Run(rs, end))
                rs = -1.0
            }
        }
        if (rs >= 0 && last + dt - rs >= 0.3) out.add(Run(rs, last + dt))
        return out
    }

    /**
     * Fin des logos (s) ou -1 si on ne peut pas l'affirmer.
     * @param analyzed jusqu'où la vidéo a été analysée (s)
     */
    fun decide(runsIn: List<Run>, analyzed: Double, maxEnd: Double = 120.0): Double {
        // un « noir » de plus de 6 s n'est pas une coupure entre deux logos : c'est une scène sombre et lente
        // (souvent le début du film) → seule sa première seconde compte comme coupure
        val runs = runsIn.sortedBy { it.start }.map { if (it.end - it.start > 6) Run(it.start, it.start + 1.0) else it }
        // les logos de studio démarrent sur du noir (fondu d'ouverture) ; un film qui commence
        // directement sur une image n'a pas de logos à passer
        if (runs.isEmpty() || runs[0].start > 1.0) return -1.0
        var prev = 0.0
        var cand = -1.0
        var count = 0
        var lastSeg = -1.0
        var stopped = false
        for (r in runs) {
            if (r.end <= prev) continue
            if (r.start <= prev + 0.6) { prev = maxOf(prev, r.end); if (count > 0) cand = prev; continue } // noir du tout début, ou fondu en deux temps
            val seg = r.start - prev
            if (seg > 45) { lastSeg = seg; stopped = true; break } // un long moment sans coupure : c'est le film
            if (seg < 2.5) { prev = r.end; if (count > 0) cand = prev; continue } // micro-coupure dans un même logo
            count++
            cand = r.end
            prev = r.end
            if (count > 6 || cand > maxEnd) return -1.0
        }
        if (count == 0 || cand < 4 || cand > maxEnd) return -1.0
        // il faut avoir vu au moins 40 s de film après la fin trouvée (sinon on ne sait pas)
        if (!stopped && analyzed - cand < 40) return -1.0
        if (stopped && lastSeg < 45) return -1.0
        return cand
    }

    private fun median(v: List<Int>): Double {
        if (v.isEmpty()) return 0.0
        val s = v.sorted()
        return if (s.size % 2 == 1) s[s.size / 2].toDouble() else (s[s.size / 2 - 1] + s[s.size / 2]) / 2.0
    }
}
