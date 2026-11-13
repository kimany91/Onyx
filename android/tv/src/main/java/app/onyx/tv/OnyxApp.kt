package app.onyx.tv

import android.app.Application
import android.os.Handler
import android.os.Looper
import app.onyx.core.PlayerActivity
import app.onyx.core.TorrentEngine
import org.json.JSONObject

class OnyxApp : Application() {

    companion object {
        lateinit var instance: OnyxApp
            private set
        val main = Handler(Looper.getMainLooper())
    }

    var server: RemoteServer? = null
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        PlayerActivity.events = { name, json -> MainActivity.emit(name, json) }
        Thread { try { TorrentEngine.init(this) } catch (_: Throwable) { } }.start()
    }

    /** Démarre le serveur de connexion (ports 8765 à 8775). */
    fun startServer() {
        if (server?.isAlive == true) return
        for (port in 8765..8775) {
            try {
                val s = RemoteServer(this, port)
                s.onCommand = { cmd, raw -> main.post { route(cmd, raw) } }
                s.start(5000, true)
                server = s
                return
            } catch (_: Exception) { }
        }
    }

    fun stopServer() { try { server?.stop() } catch (_: Exception) { }; server = null }

    /** Les commandes de lecture vont au lecteur natif s'il est ouvert, le reste à l'interface. */
    private fun route(cmd: JSONObject, raw: String) {
        val player = PlayerActivity.current
        val action = cmd.optString("action")
        if (player != null) {
            if (player.handleRemote(cmd)) return
            if (action in setOf("open", "sources", "search", "play") || (action == "key" && cmd.optString("key") == "home")) player.finish()
        }
        MainActivity.emit("onyx-remote", raw)
    }
}
