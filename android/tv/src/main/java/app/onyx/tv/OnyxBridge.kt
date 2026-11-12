package app.onyx.tv

import android.webkit.JavascriptInterface
import app.onyx.core.Updater

/** Fonctions natives appelables depuis l'interface (window.OnyxNative). */
class OnyxBridge(private val activity: MainActivity) {

    private val app get() = OnyxApp.instance

    @JavascriptInterface fun platform() = "android-tv"

    @JavascriptInterface fun version() = BuildConfig.VERSION_NAME

    @JavascriptInterface fun serverInfo(): String? = app.server?.info()?.toString()

    @JavascriptInterface fun devices(): String = app.server?.devicesJson() ?: "[]"

    @JavascriptInterface fun resetToken(): String? = app.server?.resetToken()

    @JavascriptInterface fun setState(json: String) { app.server?.state = json }

    @JavascriptInterface fun play(json: String): Boolean {
        OnyxApp.main.post { activity.play(json) }
        return true
    }

    @JavascriptInterface fun openExternal(url: String, mime: String?): Boolean {
        var ok = false
        val lock = Object()
        var done = false
        OnyxApp.main.post {
            ok = activity.openExternal(url, mime)
            synchronized(lock) { done = true; lock.notifyAll() }
        }
        synchronized(lock) { if (!done) lock.wait(3000) }
        return ok
    }

    @JavascriptInterface fun checkUpdate(manual: Boolean): Boolean {
        Updater.check(activity, "onyx-tv.apk", BuildConfig.VERSION_CODE, manual) { MainActivity.emit("onyx-update", it.toString()) }
        return true
    }

    @JavascriptInterface fun exitApp(): Boolean {
        OnyxApp.main.post { activity.exitApp() }
        return true
    }
}
