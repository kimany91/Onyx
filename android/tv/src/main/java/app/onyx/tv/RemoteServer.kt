package app.onyx.tv

import android.content.Context
import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap

/**
 * Petit serveur HTTP local : le téléphone (app Onyx Remote ou navigateur)
 * envoie des commandes à la TV et lit son état.
 */
class RemoteServer(private val ctx: Context, port: Int) : NanoHTTPD("0.0.0.0", port) {

    data class Device(val name: String, val ip: String, var lastSeen: Long)

    @Volatile var state: String = "{}"
    @Volatile var progress: String = "{}"
    @Volatile var onCommand: ((JSONObject, String) -> Unit)? = null
    val devices = ConcurrentHashMap<String, Device>()
    private val prefs = ctx.getSharedPreferences("onyx_remote", Context.MODE_PRIVATE)
    var token: String = prefs.getString("token", null) ?: newToken()
        private set

    private fun newToken(): String {
        val alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        val r = SecureRandom()
        val t = (1..8).map { alphabet[r.nextInt(alphabet.length)] }.joinToString("")
        prefs.edit().putString("token", t).apply()
        token = t
        return t
    }

    fun resetToken(): String { devices.clear(); return newToken() }

    fun info(): JSONObject {
        val ip = lanIp()
        val url = "http://$ip:$listeningPort"
        return JSONObject().put("ip", ip).put("port", listeningPort).put("url", url)
            .put("token", token).put("pairUrl", "$url/remote/?token=$token")
    }

    fun devicesJson(): String {
        val a = JSONArray()
        devices.values.forEach { a.put(JSONObject().put("name", it.name).put("ip", it.ip).put("lastSeen", it.lastSeen)) }
        return a.toString()
    }

    private fun cors(r: Response): Response {
        r.addHeader("Access-Control-Allow-Origin", "*")
        r.addHeader("Access-Control-Allow-Headers", "Content-Type, X-Onyx-Token, X-Onyx-Device")
        r.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        r.addHeader("Cache-Control", "no-store")
        return r
    }

    private fun json(status: Response.Status, body: String) =
        cors(newFixedLengthResponse(status, "application/json; charset=utf-8", body))

    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri ?: "/"
        if (session.method == Method.OPTIONS) return cors(newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", ""))
        if (uri == "/api/ping") {
            val name = try { JSONObject(state).optString("tvName", "Onyx TV") } catch (_: Exception) { "Onyx TV" }
            return json(Response.Status.OK, JSONObject().put("app", "onyx").put("name", name)
                .put("version", BuildConfig.VERSION_NAME).put("platform", "android-tv").toString())
        }
        if (uri.startsWith("/api/")) {
            val t = session.headers["x-onyx-token"] ?: session.parms["token"]
            if (t != token) return json(Response.Status.UNAUTHORIZED, "{\"error\":\"unauthorized\"}")
            val name = (session.headers["x-onyx-device"] ?: "Téléphone").take(60)
            val ip = session.headers["remote-addr"] ?: session.headers["http-client-ip"] ?: "?"
            devices["$name@$ip"] = Device(name, ip, System.currentTimeMillis())

            if (uri == "/api/state") return json(Response.Status.OK, state)
            if (uri == "/api/progress" && session.method == Method.GET) return json(Response.Status.OK, progress)
            if (uri == "/api/progress" && session.method == Method.POST) {
                val files = HashMap<String, String>()
                try { session.parseBody(files) } catch (_: Exception) { }
                val body = files["postData"] ?: "{}"
                val entries = try { JSONObject(body).optJSONObject("entries") ?: JSONObject() } catch (_: Exception) { JSONObject() }
                val cmd = JSONObject().put("action", "progress-merge").put("entries", entries)
                onCommand?.invoke(cmd, cmd.toString())
                return json(Response.Status.OK, "{\"ok\":true}")
            }
            if (uri == "/api/cmd" && session.method == Method.POST) {
                val files = HashMap<String, String>()
                try { session.parseBody(files) } catch (_: Exception) { }
                val body = files["postData"] ?: ""
                val cmd = try { JSONObject(body) } catch (_: Exception) { return json(Response.Status.BAD_REQUEST, "{\"error\":\"bad json\"}") }
                onCommand?.invoke(cmd, body)
                return json(Response.Status.OK, "{\"ok\":true}")
            }
            return json(Response.Status.NOT_FOUND, "{\"error\":\"not found\"}")
        }
        // Interface du téléphone servie depuis les assets
        if (uri == "/" || uri == "/remote") {
            val r = newFixedLengthResponse(Response.Status.REDIRECT, "text/plain", "")
            r.addHeader("Location", "/remote/" + (session.queryParameterString?.let { "?$it" } ?: ""))
            return r
        }
        var rel = uri.trimStart('/')
        if (rel.contains("..")) return newFixedLengthResponse(Response.Status.FORBIDDEN, "text/plain", "")
        if (rel.endsWith("/") || rel.isEmpty()) rel += "index.html"
        return try {
            val bytes = ctx.assets.open("web/$rel").use { it.readBytes() }
            cors(newFixedLengthResponse(Response.Status.OK, mime(rel), ByteArrayInputStream(bytes), bytes.size.toLong()))
        } catch (_: Exception) {
            newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found")
        }
    }

    private fun mime(p: String) = when (p.substringAfterLast('.').lowercase()) {
        "html" -> "text/html; charset=utf-8"
        "js" -> "application/javascript; charset=utf-8"
        "css" -> "text/css; charset=utf-8"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "json" -> "application/json"
        else -> "application/octet-stream"
    }

    companion object {
        fun lanIp(): String {
            var best: String? = null
            try {
                for (ni in NetworkInterface.getNetworkInterfaces()) {
                    if (!ni.isUp || ni.isLoopback) continue
                    for (addr in ni.inetAddresses) {
                        if (addr !is Inet4Address || addr.isLoopbackAddress) continue
                        val ip = addr.hostAddress ?: continue
                        val preferred = ni.name.startsWith("wlan") || ni.name.startsWith("eth")
                        if (best == null || (preferred && addr.isSiteLocalAddress)) best = ip
                    }
                }
            } catch (_: Exception) { }
            return best ?: "127.0.0.1"
        }
    }
}
