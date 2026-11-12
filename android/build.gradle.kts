plugins {
    id("com.android.application") version "8.7.3" apply false
    id("com.android.library") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}

// Numéro de version : fourni par la CI (-PonyxVersionCode=N), sinon 1
val onyxVersionCode: Int = (findProperty("onyxVersionCode") as String?)?.toIntOrNull() ?: 1
extra["onyxVersionCode"] = onyxVersionCode
extra["onyxVersionName"] = "1.0.$onyxVersionCode"
