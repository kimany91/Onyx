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
                announce(port)
                return
            } catch (_: Exception) { }
        }
    }

    fun stopServer() {
        try { server?.stop() } catch (_: Exception) { }; server = null
        try { nsdListener?.let { (getSystemService(NSD_SERVICE) as android.net.nsd.NsdManager).unregisterService(it) } } catch (_: Exception) { }
        nsdListener = null
    }

    /** Annonce la TV sur le réseau local (« _onyx._tcp ») : le téléphone la retrouve même si son adresse change. */
    private var nsdListener: android.net.nsd.NsdManager.RegistrationListener? = null
    private fun announce(port: Int) {
        try {
            val nsd = getSystemService(NSD_SERVICE) as android.net.nsd.NsdManager
            val info = android.net.nsd.NsdServiceInfo().apply { serviceName = "Onyx TV"; serviceType = "_onyx._tcp."; this.port = port }
            val l = object : android.net.nsd.NsdManager.RegistrationListener {
                override fun onServiceRegistered(si: android.net.nsd.NsdServiceInfo) { }
                override fun onRegistrationFailed(si: android.net.nsd.NsdServiceInfo, code: Int) { }
                override fun onServiceUnregistered(si: android.net.nsd.NsdServiceInfo) { }
                override fun onUnregistrationFailed(si: android.net.nsd.NsdServiceInfo, code: Int) { }
            }
            nsd.registerService(info, android.net.nsd.NsdManager.PROTOCOL_DNS_SD, l)
            nsdListener = l
        } catch (_: Exception) { }
    }

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
