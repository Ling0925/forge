import com.android.build.api.artifact.SingleArtifact

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "dev.forge.nativeapp"
    compileSdk = 35
    defaultConfig {
        applicationId = "dev.forge.nativeapp"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            isDebuggable = true
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android.txt"), "proguard-debug.pro")
            testProguardFiles("proguard-android-test.pro")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

abstract class CheckApkSize : DefaultTask() {
    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val apkDirectory: DirectoryProperty

    @TaskAction
    fun checkSize() {
        val apks = apkDirectory.get().asFile.walkTopDown()
            .filter { it.isFile && it.extension == "apk" }.toList()
        check(apks.isNotEmpty()) { "No APK found in ${apkDirectory.get().asFile}" }
        apks.forEach { apk ->
            val bytes = apk.length()
            check(bytes < 10_000_000L) {
                "${apk.name} is $bytes bytes; every native APK must be below 10,000,000 bytes (10 MB)."
            }
            logger.lifecycle("APK size OK: ${apk.name} = $bytes bytes (< 10,000,000)")
        }
    }
}

// Use the APK artifact provider so the gate checks the just-built package, not a stale path.
androidComponents.onVariants { variant ->
    val variantName = variant.name.replaceFirstChar { it.uppercaseChar() }
    val sizeCheck = tasks.register<CheckApkSize>("check${variantName}ApkSize") {
        group = "verification"
        description = "Require every ${variant.name} APK to be strictly smaller than 10 MB."
        apkDirectory.set(variant.artifacts.get(SingleArtifact.APK))
    }
    tasks.matching { it.name == "assemble$variantName" }.configureEach {
        dependsOn(sizeCheck)
    }
}
