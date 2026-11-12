plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "app.onyx.remote"
    compileSdk = 35
    defaultConfig {
        applicationId = "app.onyx.remote"
        minSdk = 24
        targetSdk = 35
        versionCode = rootProject.extra["onyxVersionCode"] as Int
        versionName = rootProject.extra["onyxVersionName"] as String
    }
    // Signature : clé fournie par la CI (secrets GitHub), sinon clé de debug
    val ksFile = System.getenv("ONYX_KEYSTORE_FILE")?.let { file(it) }
    signingConfigs {
        if (ksFile != null && ksFile.exists()) create("onyx") {
            storeFile = ksFile
            storePassword = System.getenv("ONYX_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("ONYX_KEY_ALIAS") ?: "onyx"
            keyPassword = System.getenv("ONYX_KEYSTORE_PASSWORD")
        }
    }
    val signing = signingConfigs.findByName("onyx") ?: signingConfigs.getByName("debug")
    buildTypes {
        release { isMinifyEnabled = false; signingConfig = signing }
        debug { signingConfig = signing }
    }
    buildFeatures { buildConfig = true }
    lint { checkReleaseBuilds = false; abortOnError = false }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation(project(":core"))
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}
