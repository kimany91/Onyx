package app.onyx.core

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller

/** Résultat de l'installation d'une mise à jour, et relance de l'app une fois mise à jour. */
class InstallReceiver : BroadcastReceiver() {
    companion object { const val ACTION = "app.onyx.core.INSTALL_STATUS" }

    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            ACTION -> {
                val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
                if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    // première mise à jour (ou Android < 12) : Android demande une confirmation
                    @Suppress("DEPRECATION")
                    val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                    try { ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { }
                }
            }
            Intent.ACTION_MY_PACKAGE_REPLACED -> {
                // l'app vient d'être mise à jour : on la rouvre
                val pm = ctx.packageManager
                val launch = pm.getLeanbackLaunchIntentForPackage(ctx.packageName) ?: pm.getLaunchIntentForPackage(ctx.packageName) ?: return
                try { ctx.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { }
            }
        }
    }
}
