package app.onyx.core

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.net.HttpURLConnection
import java.net.URL

/**
 * Images des films (affiches, fonds) demandées en mode « CORS » par l'interface :
 * le serveur d'images n'envoie pas toujours l'autorisation nécessaire pour lire
 * leurs couleurs. On les relaie en ajoutant cette autorisation, pour que
 * l'ambiance de l'écran puisse prendre les couleurs du film.
 * Seules les requêtes d'images CORS vers des hôtes d'images connus passent ici.
 */
object ImageProxy {
    private val HOSTS = setOf("images.metahub.space", "m.media-amazon.com", "image.tmdb.org", "live.metahub.space")

    fun intercept(req: WebResourceRequest): WebResourceResponse? {
        val url = req.url ?: return null
        if (req.method != "GET" || url.scheme != "https" || url.host !in HOSTS) return null
        val origin = req.requestHeaders.entries.firstOrNull { it.key.equals("Origin", true) }?.value ?: return null
        return try {
            val c = URL(url.toString()).openConnection() as HttpURLConnection
            c.connectTimeout = 10000; c.readTimeout = 15000
            c.instanceFollowRedirects = true
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) Onyx")
            val code = c.responseCode
            if (code !in 200..299) { c.disconnect(); return null }
            val mime = (c.contentType ?: "image/jpeg").substringBefore(';').trim()
            val headers = hashMapOf(
                "Access-Control-Allow-Origin" to (if (origin == "null") "*" else origin),
                "Cache-Control" to "public, max-age=2592000"
            )
            WebResourceResponse(mime, null, code, "OK", headers, c.inputStream)
        } catch (_: Exception) { null }
    }
}
