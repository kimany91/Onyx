plugins {
    id("com.android.application") version "8.7.3" apply false
    id("com.android.library") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}

// Numéro de version : fourni par la CI (-PonyxVersionCode=N), sinon 1
val onyxVersionCode: Int = (findProperty("onyxVersionCode") as String?)?.toIntOrNull() ?: 1
extra["onyxVersionCode"] = onyxVersionCode
// nom affiché : toujours « 1.1 » ; le numéro de compilation (versionCode) sert seulement aux mises à jour
extra["onyxVersionName"] = "1.1"
