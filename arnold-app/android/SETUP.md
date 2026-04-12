# Arnold Android Setup — Health Connect Integration

## Prerequisites
- Android Studio Hedgehog or later
- JDK 17
- Physical Android device with Health Connect installed (or emulator API 34+)
- Garmin Connect app configured to sync to Health Connect

## Step 1: Initialize Capacitor

```bash
cd arnold-app
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init Arnold com.arnold.health --web-dir dist
npx cap add android
```

## Step 2: Build web assets

```bash
npm run build
npx cap sync android
```

## Step 3: Add Health Connect dependency

In `android/app/build.gradle`, add:

```gradle
dependencies {
    // Health Connect
    implementation "androidx.health.connect:connect-client:1.1.0-alpha07"

    // Coroutines for async HC calls
    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3"
}

android {
    defaultConfig {
        minSdkVersion 26  // Required for Health Connect
    }
}
```

## Step 4: AndroidManifest.xml permissions

Add inside `<manifest>`:

```xml
<!-- Health Connect permissions -->
<uses-permission android:name="android.permission.health.READ_EXERCISE" />
<uses-permission android:name="android.permission.health.READ_SLEEP" />
<uses-permission android:name="android.permission.health.READ_WEIGHT" />
<uses-permission android:name="android.permission.health.READ_HEART_RATE" />
<uses-permission android:name="android.permission.health.READ_NUTRITION" />
<uses-permission android:name="android.permission.health.READ_HYDRATION" />
<uses-permission android:name="android.permission.health.WRITE_NUTRITION" />
<uses-permission android:name="android.permission.health.WRITE_HYDRATION" />
```

Add inside `<application>`:

```xml
<!-- Health Connect intent filter for permission handling -->
<activity-alias
    android:name="ViewPermissionUsageActivity"
    android:exported="true"
    android:targetActivity=".MainActivity"
    android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
    <intent-filter>
        <action android:name="android.intent.action.VIEW_PERMISSION_USAGE" />
        <category android:name="android.intent.category.HEALTH_PERMISSIONS" />
    </intent-filter>
</activity-alias>
```

## Step 5: Register the plugin

In `MainActivity.kt` (or `MainActivity.java`), register the plugin:

```kotlin
import com.arnold.health.plugins.HealthConnectPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(HealthConnectPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
```

## Step 6: Run

```bash
npx cap open android
# Build and run from Android Studio on a physical device
```

## Data Flow

```
Garmin Watch → Garmin Connect → Health Connect → HealthConnectPlugin.kt → hc-bridge.js → hc-sync.js → storage.js
```

## Testing without Capacitor

The web version continues to work on GitHub Pages. `hc-bridge.js` detects the platform:
- **Web**: Returns empty arrays, FIT/CSV upload remains available
- **Native**: Calls Health Connect via the Kotlin plugin

## Health Connect data types used

| HC Record Type | Direction | Arnold Storage |
|---|---|---|
| ExerciseSessionRecord | Read | activities |
| SleepSessionRecord | Read | sleep |
| WeightRecord | Read | weight |
| HeartRateRecord | Read | sleep (restingHR) |
| NutritionRecord | Read+Write | cronometer, nutrition-log |
| HydrationRecord | Read+Write | nutrition-log (water) |
