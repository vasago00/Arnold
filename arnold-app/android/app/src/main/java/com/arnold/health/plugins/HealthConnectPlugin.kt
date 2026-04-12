package com.arnold.health.plugins

import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Arnold Health Connect Plugin — Capacitor bridge to Android Health Connect API.
 *
 * Provides read access to: ExerciseSession, Sleep, Weight, HeartRate, Nutrition
 * Provides write access to: Nutrition (Arnold food log write-back)
 *
 * All methods are called from JavaScript via:
 *   window.Capacitor.Plugins.HealthConnect.<methodName>({...})
 */
@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {

    private val TAG = "HealthConnectPlugin"

    private val healthConnectClient by lazy {
        HealthConnectClient.getOrCreate(context)
    }

    // ── Permissions ─────────────────────────────────────────────────────────

    private val ALL_PERMISSIONS = setOf(
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(WeightRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(NutritionRecord::class),
        HealthPermission.getReadPermission(HydrationRecord::class),
        HealthPermission.getWritePermission(NutritionRecord::class),
        HealthPermission.getWritePermission(HydrationRecord::class),
    )

    @PluginMethod
    fun checkAvailability(call: PluginCall) {
        val status = HealthConnectClient.getSdkStatus(context)
        val result = JSObject()
        result.put("available", status == HealthConnectClient.SDK_AVAILABLE)
        result.put("installed", status != HealthConnectClient.SDK_UNAVAILABLE)
        call.resolve(result)
    }

    @PluginMethod
    fun requestPermissions(call: PluginCall) {
        bridge.activity?.let { activity ->
            val launcher = activity.registerForActivityResult(
                HealthConnectClient.permissionController.createRequestPermissionResultContract()
            ) { granted ->
                val result = JSObject()
                result.put("granted", granted.containsAll(ALL_PERMISSIONS))
                val denied = JSArray()
                (ALL_PERMISSIONS - granted).forEach { denied.put(it.toString()) }
                result.put("denied", denied)
                call.resolve(result)
            }
            launcher.launch(ALL_PERMISSIONS)
        } ?: run {
            call.reject("No activity available for permission request")
        }
    }

    // ── Read: Exercise Sessions ─────────────────────────────────────────────

    @PluginMethod
    fun readExerciseSessions(call: PluginCall) {
        val startDate = call.getString("startDate") ?: return call.reject("startDate required")
        val endDate = call.getString("endDate") ?: return call.reject("endDate required")

        bridge.activity?.let {
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
                try {
                    val timeRange = timeRangeFromDates(startDate, endDate)
                    val request = ReadRecordsRequest(
                        recordType = ExerciseSessionRecord::class,
                        timeRangeFilter = timeRange
                    )
                    val response = healthConnectClient.readRecords(request)

                    val sessions = JSArray()
                    for (record in response.records) {
                        val session = JSObject()
                        session.put("id", record.metadata.id)
                        session.put("exerciseType", record.exerciseType)
                        session.put("startTime", record.startTime.toString())
                        session.put("endTime", record.endTime.toString())
                        session.put("title", record.title ?: "")

                        // Read associated data
                        // Calories
                        val caloriesRequest = ReadRecordsRequest(
                            recordType = ActiveCaloriesBurnedRecord::class,
                            timeRangeFilter = TimeRangeFilter.between(record.startTime, record.endTime)
                        )
                        val caloriesResponse = healthConnectClient.readRecords(caloriesRequest)
                        val totalCals = caloriesResponse.records.sumOf {
                            it.energy.inKilocalories
                        }
                        session.put("calories", totalCals)

                        // Distance
                        val distRequest = ReadRecordsRequest(
                            recordType = DistanceRecord::class,
                            timeRangeFilter = TimeRangeFilter.between(record.startTime, record.endTime)
                        )
                        val distResponse = healthConnectClient.readRecords(distRequest)
                        val totalDist = distResponse.records.sumOf {
                            it.distance.inMeters
                        }
                        session.put("distanceMeters", totalDist)

                        // Heart rate during exercise
                        val hrRequest = ReadRecordsRequest(
                            recordType = HeartRateRecord::class,
                            timeRangeFilter = TimeRangeFilter.between(record.startTime, record.endTime)
                        )
                        val hrResponse = healthConnectClient.readRecords(hrRequest)
                        val allBpms = hrResponse.records.flatMap { it.samples.map { s -> s.beatsPerMinute } }
                        if (allBpms.isNotEmpty()) {
                            session.put("avgHeartRate", allBpms.average().toInt())
                            session.put("maxHeartRate", allBpms.max())
                        }

                        sessions.put(session)
                    }

                    val result = JSObject()
                    result.put("sessions", sessions)
                    call.resolve(result)
                } catch (e: Exception) {
                    Log.e(TAG, "readExerciseSessions error", e)
                    call.reject("Failed to read exercise sessions: ${e.message}")
                }
            }
        }
    }

    // ── Read: Sleep Sessions ────────────────────────────────────────────────

    @PluginMethod
    fun readSleepSessions(call: PluginCall) {
        val startDate = call.getString("startDate") ?: return call.reject("startDate required")
        val endDate = call.getString("endDate") ?: return call.reject("endDate required")

        bridge.activity?.let {
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
                try {
                    val timeRange = timeRangeFromDates(startDate, endDate)
                    val request = ReadRecordsRequest(
                        recordType = SleepSessionRecord::class,
                        timeRangeFilter = timeRange
                    )
                    val response = healthConnectClient.readRecords(request)

                    val sessions = JSArray()
                    for (record in response.records) {
                        val session = JSObject()
                        session.put("id", record.metadata.id)
                        session.put("startTime", record.startTime.toString())
                        session.put("endTime", record.endTime.toString())
                        session.put("durationMinutes",
                            java.time.Duration.between(record.startTime, record.endTime).toMinutes()
                        )

                        // Sleep stages
                        val stages = JSArray()
                        for (stage in record.stages) {
                            val stageObj = JSObject()
                            stageObj.put("stage", mapSleepStage(stage.stage))
                            stageObj.put("startTime", stage.startTime.toString())
                            stageObj.put("endTime", stage.endTime.toString())
                            stages.put(stageObj)
                        }
                        session.put("stages", stages)

                        sessions.put(session)
                    }

                    val result = JSObject()
                    result.put("sessions", sessions)
                    call.resolve(result)
                } catch (e: Exception) {
                    Log.e(TAG, "readSleepSessions error", e)
                    call.reject("Failed to read sleep sessions: ${e.message}")
                }
            }
        }
    }

    // ── Read: Weight ────────────────────────────────────────────────────────

    @PluginMethod
    fun readWeight(call: PluginCall) {
        val startDate = call.getString("startDate") ?: return call.reject("startDate required")
        val endDate = call.getString("endDate") ?: return call.reject("endDate required")

        bridge.activity?.let {
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
                try {
                    val timeRange = timeRangeFromDates(startDate, endDate)
                    val request = ReadRecordsRequest(
                        recordType = WeightRecord::class,
                        timeRangeFilter = timeRange
                    )
                    val response = healthConnectClient.readRecords(request)

                    val records = JSArray()
                    for (record in response.records) {
                        val obj = JSObject()
                        obj.put("weightKg", record.weight.inKilograms)
                        obj.put("time", record.time.toString())
                        records.put(obj)
                    }

                    val result = JSObject()
                    result.put("records", records)
                    call.resolve(result)
                } catch (e: Exception) {
                    Log.e(TAG, "readWeight error", e)
                    call.reject("Failed to read weight: ${e.message}")
                }
            }
        }
    }

    // ── Read: Heart Rate ────────────────────────────────────────────────────

    @PluginMethod
    fun readHeartRate(call: PluginCall) {
        val startDate = call.getString("startDate") ?: return call.reject("startDate required")
        val endDate = call.getString("endDate") ?: return call.reject("endDate required")

        bridge.activity?.let {
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
                try {
                    val timeRange = timeRangeFromDates(startDate, endDate)
                    val request = ReadRecordsRequest(
                        recordType = HeartRateRecord::class,
                        timeRangeFilter = timeRange
                    )
                    val response = healthConnectClient.readRecords(request)

                    val records = JSArray()
                    for (record in response.records) {
                        for (sample in record.samples) {
                            val obj = JSObject()
                            obj.put("bpm", sample.beatsPerMinute)
                            obj.put("time", sample.time.toString())
                            records.put(obj)
                        }
                    }

                    val result = JSObject()
                    result.put("records", records)
                    call.resolve(result)
                } catch (e: Exception) {
                    Log.e(TAG, "readHeartRate error", e)
                    call.reject("Failed to read heart rate: ${e.message}")
                }
            }
        }
    }

    // ── Read: Nutrition ─────────────────────────────────────────────────────

    @PluginMethod
    fun readNutrition(call: PluginCall) {
        val startDate = call.getString("startDate") ?: return call.reject("startDate required")
        val endDate = call.getString("endDate") ?: return call.reject("endDate required")

        bridge.activity?.let {
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
                try {
                    val timeRange = timeRangeFromDates(startDate, endDate)
                    val request = ReadRecordsRequest(
                        recordType = NutritionRecord::class,
                        timeRangeFilter = timeRange
                    )
                    val response = healthConnectClient.readRecords(request)

                    val records = JSArray()
                    for (record in response.records) {
                        val obj = JSObject()
                        obj.put("id", record.metadata.id)
                        obj.put("name", record.name ?: "")
                        obj.put("mealType", record.mealType)
                        obj.put("startTime", record.startTime.toString())
                        obj.put("endTime", record.endTime.toString())

                        val energy = JSObject(); energy.put("calories", record.energy?.inKilocalories ?: 0.0)
                        obj.put("energy", energy)

                        val protein = JSObject(); protein.put("grams", record.protein?.inGrams ?: 0.0)
                        obj.put("protein", protein)

                        val carbs = JSObject(); carbs.put("grams", record.totalCarbohydrate?.inGrams ?: 0.0)
                        obj.put("carbs", carbs)

                        val fat = JSObject(); fat.put("grams", record.totalFat?.inGrams ?: 0.0)
                        obj.put("fat", fat)

                        val fiber = JSObject(); fiber.put("grams", record.dietaryFiber?.inGrams ?: 0.0)
                        obj.put("fiber", fiber)

                        val sugar = JSObject(); sugar.put("grams", record.sugar?.inGrams ?: 0.0)
                        obj.put("sugar", sugar)

                        val sodium = JSObject(); sodium.put("mg", record.sodium?.inMilligrams ?: 0.0)
                        obj.put("sodium", sodium)

                        val potassium = JSObject(); potassium.put("mg", record.potassium?.inMilligrams ?: 0.0)
                        obj.put("potassium", potassium)

                        val calcium = JSObject(); calcium.put("mg", record.calcium?.inMilligrams ?: 0.0)
                        obj.put("calcium", calcium)

                        val iron = JSObject(); iron.put("mg", record.iron?.inMilligrams ?: 0.0)
                        obj.put("iron", iron)

                        val magnesium = JSObject(); magnesium.put("mg", record.magnesium?.inMilligrams ?: 0.0)
                        obj.put("magnesium", magnesium)

                        obj.put("source", record.metadata.dataOrigin.packageName)

                        records.put(obj)
                    }

                    val result = JSObject()
                    result.put("records", records)
                    call.resolve(result)
                } catch (e: Exception) {
                    Log.e(TAG, "readNutrition error", e)
                    call.reject("Failed to read nutrition: ${e.message}")
                }
            }
        }
    }

    // ── Read: Hydration ─────────────────────────────────────────────────────

    @PluginMethod
    fun readHydration(call: PluginCall) {
        val startDate = call.getString("startDate") ?: return call.reject("startDate required")
        val endDate = call.getString("endDate") ?: return call.reject("endDate required")

        bridge.activity?.let {
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
                try {
                    val timeRange = timeRangeFromDates(startDate, endDate)
                    val request = ReadRecordsRequest(
                        recordType = HydrationRecord::class,
                        timeRangeFilter = timeRange
                    )
                    val response = healthConnectClient.readRecords(request)

                    val records = JSArray()
                    for (record in response.records) {
                        val obj = JSObject()
                        obj.put("id", record.metadata.id)
                        obj.put("volumeMl", record.volume.inMilliliters)
                        obj.put("startTime", record.startTime.toString())
                        obj.put("endTime", record.endTime.toString())
                        records.put(obj)
                    }

                    val result = JSObject()
                    result.put("records", records)
                    call.resolve(result)
                } catch (e: Exception) {
                    Log.e(TAG, "readHydration error", e)
                    call.reject("Failed to read hydration: ${e.message}")
                }
            }
        }
    }

    // ── Write: Nutrition (Arnold → HC) ──────────────────────────────────────

    @PluginMethod
    fun writeNutrition(call: PluginCall) {
        val recordData = call.getObject("record") ?: return call.reject("record required")

        bridge.activity?.let {
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
                try {
                    val startTime = Instant.parse(recordData.getString("startTime"))
                    val endTime = Instant.parse(recordData.getString("endTime") ?: recordData.getString("startTime"))
                    val zoneOffset = java.time.ZoneOffset.systemDefault().rules.getOffset(startTime)

                    val record = NutritionRecord(
                        startTime = startTime,
                        endTime = endTime,
                        startZoneOffset = zoneOffset,
                        endZoneOffset = zoneOffset,
                        name = recordData.getString("name") ?: "Arnold food entry",
                        mealType = recordData.getInt("mealType", 0),
                        energy = recordData.getJSObject("energy")?.let {
                            androidx.health.connect.client.units.Energy.kilocalories(it.getDouble("calories"))
                        },
                        protein = recordData.getJSObject("protein")?.let {
                            androidx.health.connect.client.units.Mass.grams(it.getDouble("grams"))
                        },
                        totalCarbohydrate = recordData.getJSObject("carbs")?.let {
                            androidx.health.connect.client.units.Mass.grams(it.getDouble("grams"))
                        },
                        totalFat = recordData.getJSObject("fat")?.let {
                            androidx.health.connect.client.units.Mass.grams(it.getDouble("grams"))
                        },
                    )

                    healthConnectClient.insertRecords(listOf(record))

                    val result = JSObject()
                    result.put("success", true)
                    call.resolve(result)
                } catch (e: Exception) {
                    Log.e(TAG, "writeNutrition error", e)
                    call.reject("Failed to write nutrition: ${e.message}")
                }
            }
        }
    }

    // ── Write: Hydration (Arnold → HC) ──────────────────────────────────────

    @PluginMethod
    fun writeHydration(call: PluginCall) {
        val recordData = call.getObject("record") ?: return call.reject("record required")

        bridge.activity?.let {
            kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.IO).launch {
                try {
                    val startTime = Instant.parse(recordData.getString("startTime"))
                    val endTime = Instant.parse(recordData.getString("endTime") ?: recordData.getString("startTime"))
                    val zoneOffset = java.time.ZoneOffset.systemDefault().rules.getOffset(startTime)

                    val record = HydrationRecord(
                        startTime = startTime,
                        endTime = endTime,
                        startZoneOffset = zoneOffset,
                        endZoneOffset = zoneOffset,
                        volume = androidx.health.connect.client.units.Volume.milliliters(
                            recordData.getDouble("volumeMl")
                        ),
                    )

                    healthConnectClient.insertRecords(listOf(record))

                    val result = JSObject()
                    result.put("success", true)
                    call.resolve(result)
                } catch (e: Exception) {
                    Log.e(TAG, "writeHydration error", e)
                    call.reject("Failed to write hydration: ${e.message}")
                }
            }
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun timeRangeFromDates(startDate: String, endDate: String): TimeRangeFilter {
        val start = LocalDate.parse(startDate).atStartOfDay(ZoneId.systemDefault()).toInstant()
        val end = LocalDate.parse(endDate).plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant()
        return TimeRangeFilter.between(start, end)
    }

    private fun mapSleepStage(stage: Int): String {
        return when (stage) {
            SleepSessionRecord.STAGE_TYPE_AWAKE -> "awake"
            SleepSessionRecord.STAGE_TYPE_LIGHT -> "light"
            SleepSessionRecord.STAGE_TYPE_DEEP -> "deep"
            SleepSessionRecord.STAGE_TYPE_REM -> "rem"
            SleepSessionRecord.STAGE_TYPE_SLEEPING -> "light" // Generic "sleeping" → light
            SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> "awake"
            else -> "unknown"
        }
    }
}
