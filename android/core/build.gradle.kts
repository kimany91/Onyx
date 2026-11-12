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
    api("androidx.media3:media3-exoplayer:1.4.1")
    api("androidx.media3:media3-exoplayer-hls:1.4.1")
    api("androidx.media3:media3-exoplayer-dash:1.4.1")
    api("androidx.media3:media3-ui:1.4.1")
}
