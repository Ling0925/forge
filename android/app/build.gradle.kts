plugins {
    id("com.android.application")
}

android {
    namespace = "dev.forge.mobile"
    compileSdk = 33

    defaultConfig {
        applicationId = "dev.forge.mobile"
        minSdk = 23
        targetSdk = 33
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        debug {
            // Debug is the only supported build for now (see docs/BUILD.md).
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.6.1")
    // Mature ZXing wrapper: provides the scan Activity + ScanContract.
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}

/**
 * Compiles and runs the dependency-free URI checks in tests/ServerUrlTest.java.
 *
 * ServerUrl deliberately has no Android imports, so this only needs a JDK - no emulator and no
 * test libraries. Run it with: ./gradlew checkServerUrl
 */
val serverUrlMainClasses = layout.buildDirectory.dir(
    "intermediates/javac/debug/compileDebugJavaWithJavac/classes",
)
val serverUrlTestClasses = layout.buildDirectory.dir("tmp/serverUrlTestClasses")

val compileServerUrlTest by tasks.registering(JavaCompile::class) {
    group = "verification"
    description = "Compiles the host-side ServerUrl checks."
    dependsOn(tasks.named("compileDebugJavaWithJavac"))

    source = fileTree(rootProject.file("tests")) { include("**/*.java") }
    classpath = files(serverUrlMainClasses)
    destinationDirectory.set(serverUrlTestClasses)
    options.encoding = "UTF-8"
    sourceCompatibility = JavaVersion.VERSION_17.toString()
    targetCompatibility = JavaVersion.VERSION_17.toString()
}

val checkServerUrl by tasks.registering(JavaExec::class) {
    group = "verification"
    description = "Runs the ServerUrl URI checks on the host JVM (no device needed)."
    dependsOn(compileServerUrlTest)

    classpath = files(serverUrlTestClasses, serverUrlMainClasses)
    mainClass.set("ServerUrlTest")
}
