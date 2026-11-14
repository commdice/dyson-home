plugins {
    id("com.android.application")
}

android {
    namespace = "com.dysonhome.watchface.warpdrive"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.dysonhome.watchface.warpdrive"
        // Watch Face Format needs Wear OS 4+ (API 33). Galaxy Watch 7 ships Wear OS 5 (API 34).
        minSdk = 33
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key so the APK can be sideloaded straight away.
            // Swap in your own signingConfig before publishing to Google Play.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}
