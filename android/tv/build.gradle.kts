plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val copyWeb by tasks.registering(Sync::class) {
    from(rootProject.file("../web"))
    into(layout.buildDirectory.dir("generated/webassets/web"))
}

android {
    namespace = "app.onyx.tv"
    compileSdk = 35
    defaultConfig {
        applicationId = "app.onyx.tv"
        minSdk = 21
        targetSdk = 35
        versionCode = rootProject.extra["onyxVersionCode"] as Int
        versionName = rootProject.extra["onyxVersionName"] as String
        // les TV Android utilisent des processeurs ARM : APK plus léger (mises à jour plus rapides)
        ndk { abiFilters += listOf("armeabi-v7a", "arm64-v8a") }
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
        release {
            isMinifyEnabled = false
            signingConfig = signing
        }
        debug { signingConfig = signing }
    }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webassets"))
    buildFeatures { buildConfig = true }
    lint { checkReleaseBuilds = false; abortOnError = false }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += setOf("META-INF/*.kotlin_module") }
}
tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
    implementation(project(":core"))
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.nanohttpd:nanohttpd:2.3.1")
    // Découpage du sujet de l'image du film (effet de profondeur / parallaxe) :
    // modèle Google « sujet » (via les services Google) et, en secours, modèle « personnes » intégré à l'app
    implementation("com.google.android.gms:play-services-mlkit-subject-segmentation:16.0.0-beta1")
    implementation("com.google.mlkit:segmentation-selfie:16.0.0-beta6")
}
