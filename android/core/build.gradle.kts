plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "app.onyx.core"
    compileSdk = 35
    defaultConfig { minSdk = 21 }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    lint { abortOnError = false }
}
dependencies {
    api("androidx.core:core:1.13.1")
    api("androidx.media3:media3-exoplayer:1.5.0")
    api("androidx.media3:media3-exoplayer-hls:1.5.0")
    api("androidx.media3:media3-exoplayer-dash:1.5.0")
    api("androidx.media3:media3-ui:1.5.0")
    // Décodage audio logiciel (DTS, TrueHD, E-AC3…) quand la TV ne sait pas le faire
    api("org.jellyfin.media3:media3-ffmpeg-decoder:1.5.0+1")
    // Moteur torrent (streaming des sources torrent sans Stremio ni debrid)
    api("org.libtorrent4j:libtorrent4j:2.1.0-39")
    api("org.libtorrent4j:libtorrent4j-android-arm:2.1.0-39")
    api("org.libtorrent4j:libtorrent4j-android-arm64:2.1.0-39")
    api("org.libtorrent4j:libtorrent4j-android-x86_64:2.1.0-39")
    api("org.nanohttpd:nanohttpd:2.3.1")
}
