package com.arnold.health

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.*
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {

    private var healthConnectClient: HealthConnectClient? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun load() {
        try {
            healthConnectClient = HealthConnectClient.getOrCreate(context)
        } catch (e: Exception) {
            // Health Connect not installed or not available
        }
    }

    @PluginMethod
    fun checkAvailability(call: PluginCall) {
        val status = HealthConnectClient.getSdkStatus(context)
        val result = JSObject()
        result.put("available", status == HealthConnectClient.SDK_AVAILABLE)
        result.put("installed", status != HealthConnectClient.SDK_UNAVAILABLE)
        call.resolve(result)
    }

    // Arnold is a one-way READER of Health Connect. This set MUST stay in sync
    // with the <uses-permission> entries in AndroidManifest.xml — anything in
    // here that the manifest doesn't declare can never be granted, which makes
    // requestPermissions() permanently return granted=false and silently breaks
    // every periodic sync. Removed in this pass: ExerciseSession (FIT uploads
    // are authoritative for activities), Nutrition (Cronometer is authoritative),
    // Hydration (no consumer), Distance (derived from Steps).
    private val allPermissions = setOf(
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(WeightRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
    )

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        val client = healthConnectClient
        if (client == null) {
            val result = JSObject()
            result.put("granted", false)
            result.put("denied", JSArray(listOf("Health Connect not available")))
            call.resolve(result)
            return
        }
        scope.launch {
            try {
                val granted = client.permissionController.getGrantedPermissions()
                val missing = allPermissions - granted
                val result = JSObject()
                result.put("granted", missing.isEmpty())
                val deniedArr = JSArray()
                missing.forEach { deniedArr.put(it) }
                result.put("denied", deniedArr)
                call.resolve(result)
            } catch (e: Exception) {
                val result = JSObject()
                result.put("granted", false)
                result.put("denied", JSArray(listOf(e.message ?: "Unknown error")))
                call.resolve(result)
            }
        }
    }

    private fun parseDate(dateStr: String): Instant {
        val ld = LocalDate.parse(dateStr, DateTimeFormatter.ISO_LOCAL_DATE)
        return ld.atStartOfDay(ZoneId.systemDefault()).toInstant()
    }

    private fun parseDateEnd(dateStr: String): Instant {
        val ld = LocalDate.parse(dateStr, DateTimeFormatter.ISO_LOCAL_DATE)
        return ld.plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant()
    }

    @PluginMethod
    fun readExerciseSessions(call: PluginCall) {
        val client = healthConnectClient ?: run { call.resolve(JSObject().put("sessions", JSArray())); return }
        val startDate = call.getString("startDate") ?: run { call.reject("startDate required"); return }
        val endDate = call.getString("endDate") ?: run { call.reject("endDate required"); return }
        scope.launch {
            try {
                val start = parseDate(startDate)
                val end = parseDateEnd(endDate)
                val response = client.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class, TimeRangeFilter.between(start, end)))
                val sessions = JSArray()
                for (record in response.records) {
                    val obj = JSObject()
                    obj.put("id", record.metadata.id)
                    obj.put("exerciseType", record.exerciseType)
                    obj.put("startTime", record.startTime.toString())
                    obj.put("endTime", record.endTime.toString())
                    obj.put("title", record.title ?: "")
                    try {
                        val calResponse = client.readRecords(ReadRecordsRequest(ActiveCaloriesBurnedRecord::class, TimeRangeFilter.between(record.startTime, record.endTime)))
                        obj.put("calories", calResponse.records.sumOf { it.energy.inKilocalories })
                    } catch (_: Exception) { obj.put("calories", 0) }
                    try {
                        val distResponse = client.readRecords(ReadRecordsRequest(DistanceRecord::class, TimeRangeFilter.between(record.startTime, record.endTime)))
                        obj.put("distanceMeters", distResponse.records.sumOf { it.distance.inMeters })
                    } catch (_: Exception) { obj.put("distanceMeters", 0) }
                    try {
                        val hrResponse = client.readRecords(ReadRecordsRequest(HeartRateRecord::class, TimeRangeFilter.between(record.startTime, record.endTime)))
                        val allSamples = hrResponse.records.flatMap { it.samples }
                        if (allSamples.isNotEmpty()) {
                            obj.put("avgHeartRate", allSamples.map { it.beatsPerMinute }.average().toInt())
                            obj.put("maxHeartRate", allSamples.maxOf { it.beatsPerMinute })
                        }
                    } catch (_: Exception) {}
                    sessions.put(obj)
                }
                call.resolve(JSObject().put("sessions", sessions))
            } catch (e: Exception) { call.reject("Failed to read exercise sessions: ${e.message}") }
        }
    }

    @PluginMethod
    fun readSleepSessions(call: PluginCall) {
        val client = healthConnectClient ?: run { call.resolve(JSObject().put("sessions", JSArray())); return }
        val startDate = call.getString("startDate") ?: run { call.reject("startDate required"); return }
        val endDate = call.getString("endDate") ?: run { call.reject("endDate required"); return }
        scope.launch {
            try {
                val response = client.readRecords(ReadRecordsRequest(SleepSessionRecord::class, TimeRangeFilter.between(parseDate(startDate), parseDateEnd(endDate))))
                val sessions = JSArray()
                for (record in response.records) {
                    val obj = JSObject()
                    obj.put("id", record.metadata.id)
                    obj.put("startTime", record.startTime.toString())
                    obj.put("endTime", record.endTime.toString())
                    obj.put("durationMinutes", java.time.Duration.between(record.startTime, record.endTime).toMinutes())
                    val stages = JSArray()
                    for (stage in record.stages) {
                        val stObj = JSObject()
                        stObj.put("stage", when (stage.stage) {
                            SleepSessionRecord.STAGE_TYPE_AWAKE -> "awake"
                            SleepSessionRecord.STAGE_TYPE_LIGHT -> "light"
                            SleepSessionRecord.STAGE_TYPE_DEEP -> "deep"
                            SleepSessionRecord.STAGE_TYPE_REM -> "rem"
                            SleepSessionRecord.STAGE_TYPE_SLEEPING -> "sleeping"
                            SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> "out_of_bed"
                            else -> "unknown"
                        })
                        stObj.put("startTime", stage.startTime.toString())
                        stObj.put("endTime", stage.endTime.toString())
                        stages.put(stObj)
                    }
                    obj.put("stages", stages)
                    sessions.put(obj)
                }
                call.resolve(JSObject().put("sessions", sessions))
            } catch (e: Exception) { call.reject("Failed to read sleep: ${e.message}") }
        }
    }

    @PluginMethod
    fun readWeight(call: PluginCall) {
        val client = healthConnectClient ?: run { call.resolve(JSObject().put("records", JSArray())); return }
        val startDate = call.getString("startDate") ?: run { call.reject("startDate required"); return }
        val endDate = call.getString("endDate") ?: run { call.reject("endDate required"); return }
        scope.launch {
            try {
                val response = client.readRecords(ReadRecordsRequest(WeightRecord::class, TimeRangeFilter.between(parseDate(startDate), parseDateEnd(endDate))))
                val records = JSArray()
                for (record in response.records) {
                    val obj = JSObject()
                    obj.put("id", record.metadata.id)
                    obj.put("weightKg", record.weight.inKilograms)
                    obj.put("time", record.time.toString())
                    records.put(obj)
                }
                call.resolve(JSObject().put("records", records))
            } catch (e: Exception) { call.reject("Failed to read weight: ${e.message}") }
        }
    }

    @PluginMethod
    fun readHeartRate(call: PluginCall) {
        val client = healthConnectClient ?: run { call.resolve(JSObject().put("records", JSArray())); return }
        val startDate = call.getString("startDate") ?: run { call.reject("startDate required"); return }
        val endDate = call.getString("endDate") ?: run { call.reject("endDate required"); return }
        scope.launch {
            try {
                val response = client.readRecords(ReadRecordsRequest(HeartRateRecord::class, TimeRangeFilter.between(parseDate(startDate), parseDateEnd(endDate))))
                val records = JSArray()
                for (hrRecord in response.records) {
                    for (sample in hrRecord.samples) {
                        val obj = JSObject()
                        obj.put("bpm", sample.beatsPerMinute)
                        obj.put("time", sample.time.toString())
                        records.put(obj)
                    }
                }
                call.resolve(JSObject().put("records", records))
            } catch (e: Exception) { call.reject("Failed to read heart rate: ${e.message}") }
        }
    }

    @PluginMethod
    fun readNutrition(call: PluginCall) {
        val client = healthConnectClient ?: run { call.resolve(JSObject().put("records", JSArray())); return }
        val startDate = call.getString("startDate") ?: run { call.reject("startDate required"); return }
        val endDate = call.getString("endDate") ?: run { call.reject("endDate required"); return }
        scope.launch {
            try {
                val response = client.readRecords(ReadRecordsRequest(NutritionRecord::class, TimeRangeFilter.between(parseDate(startDate), parseDateEnd(endDate))))
                val records = JSArray()
                for (record in response.records) {
                    val obj = JSObject()
                    obj.put("id", record.metadata.id)
                    obj.put("name", record.name ?: "")
                    obj.put("mealType", record.mealType)
                    obj.put("startTime", record.startTime.toString())
                    obj.put("endTime", record.endTime.toString())
                    obj.put("source", record.metadata.dataOrigin.packageName)
                    val energy = JSObject(); energy.put("calories", record.energy?.inKilocalories ?: 0.0); obj.put("energy", energy)
                    val protein = JSObject(); protein.put("grams", record.protein?.inGrams ?: 0.0); obj.put("protein", protein)
                    val carbs = JSObject(); carbs.put("grams", record.totalCarbohydrate?.inGrams ?: 0.0); obj.put("carbs", carbs)
                    val fat = JSObject(); fat.put("grams", record.totalFat?.inGrams ?: 0.0); obj.put("fat", fat)
                    val fiber = JSObject(); fiber.put("grams", record.dietaryFiber?.inGrams ?: 0.0); obj.put("fiber", fiber)
                    val sugar = JSObject(); sugar.put("grams", record.sugar?.inGrams ?: 0.0); obj.put("sugar", sugar)
                    val sodium = JSObject(); sodium.put("mg", record.sodium?.inMilligrams ?: 0.0); obj.put("sodium", sodium)
                    val potassium = JSObject(); potassium.put("mg", record.potassium?.inMilligrams ?: 0.0); obj.put("potassium", potassium)
                    val calcium = JSObject(); calcium.put("mg", record.calcium?.inMilligrams ?: 0.0); obj.put("calcium", calcium)
                    val iron = JSObject(); iron.put("mg", record.iron?.inMilligrams ?: 0.0); obj.put("iron", iron)
                    val vitA = JSObject(); vitA.put("mcg", record.vitaminA?.inMicrograms ?: 0.0); obj.put("vitaminA", vitA)
                    val vitC = JSObject(); vitC.put("mg", record.vitaminC?.inMilligrams ?: 0.0); obj.put("vitaminC", vitC)
                    val vitD = JSObject(); vitD.put("mcg", record.vitaminD?.inMicrograms ?: 0.0); obj.put("vitaminD", vitD)
                    val vitE = JSObject(); vitE.put("mg", record.vitaminE?.inMilligrams ?: 0.0); obj.put("vitaminE", vitE)
                    val cholesterol = JSObject(); cholesterol.put("mg", record.cholesterol?.inMilligrams ?: 0.0); obj.put("cholesterol", cholesterol)
                    val satFat = JSObject(); satFat.put("grams", record.saturatedFat?.inGrams ?: 0.0); obj.put("saturatedFat", satFat)
                    val unsatFat = JSObject(); unsatFat.put("grams", record.unsaturatedFat?.inGrams ?: 0.0); obj.put("unsaturatedFat", unsatFat)
                    records.put(obj)
                }
                call.resolve(JSObject().put("records", records))
            } catch (e: Exception) { call.reject("Failed to read nutrition: ${e.message}") }
        }
    }

    @PluginMethod
    fun readHydration(call: PluginCall) {
        val client = healthConnectClient ?: run { call.resolve(JSObject().put("records", JSArray())); return }
        val startDate = call.getString("startDate") ?: run { call.reject("startDate required"); return }
        val endDate = call.getString("endDate") ?: run { call.reject("endDate required"); return }
        scope.launch {
            try {
                val response = client.readRecords(ReadRecordsRequest(HydrationRecord::class, TimeRangeFilter.between(parseDate(startDate), parseDateEnd(endDate))))
                val records = JSArray()
                for (record in response.records) {
                    val obj = JSObject()
                    obj.put("id", record.metadata.id)
                    obj.put("volumeMl", record.volume.inMilliliters)
                    obj.put("startTime", record.startTime.toString())
                    obj.put("endTime", record.endTime.toString())
                    records.put(obj)
                }
                call.resolve(JSObject().put("records", records))
            } catch (e: Exception) { call.reject("Failed to read hydration: ${e.message}") }
        }
    }

    // Phase 4a bug fix — write methods disabled. Arnold is a one-way reader.
    // The WRITE permissions were also removed from AndroidManifest.xml, so
    // even if these were ever called, the OS would reject the insert.
    // Kept as inert stubs so the JS bridge's existing call signatures don't
    // break if some legacy caller still references them.

    @PluginMethod
    fun writeNutrition(call: PluginCall) {
        call.reject("Disabled: Arnold is a one-way reader of Health Connect. Cronometer owns nutrition writes.")
    }

    @PluginMethod
    fun writeHydration(call: PluginCall) {
        call.reject("Disabled: Arnold is a one-way reader of Health Connect. Cronometer owns hydration writes.")
    }

    // ─── Phase 4a: Daily-wellness readers ───────────────────────────────────
    // These three return one row per calendar day in the user's local
    // timezone. We READ raw records and aggregate in Kotlin — the
    // aggregateGroupByPeriod API silently returned empty in alpha10 even
    // when records existed in HC, so readRecords + manual sum is the
    // version-safe path (matches the pattern of readExerciseSessions).

    private fun localDateOf(instant: Instant): String {
        return instant.atZone(ZoneId.systemDefault()).toLocalDate().toString()
    }

    @PluginMethod
    fun readSteps(call: PluginCall) {
        val client = healthConnectClient ?: run { call.resolve(JSObject().put("records", JSArray())); return }
        val startDate = call.getString("startDate") ?: run { call.reject("startDate required"); return }
        val endDate   = call.getString("endDate")   ?: run { call.reject("endDate required");   return }
        scope.launch {
            try {
                val start = parseDate(startDate)
                val end   = parseDateEnd(endDate)
                val response = client.readRecords(
                    ReadRecordsRequest(StepsRecord::class, TimeRangeFilter.between(start, end))
                )
                val byDate = mutableMapOf<String, Long>()
                for (record in response.records) {
                    val date = localDateOf(record.startTime)
                    byDate[date] = (byDate[date] ?: 0L) + record.count
                }
                val records = JSArray()
                for ((date, steps) in byDate.toSortedMap().toList().asReversed()) {
                    if (steps <= 0L) continue
                    val obj = JSObject()
                    obj.put("date", date)
                    obj.put("steps", steps)
                    records.put(obj)
                }
                call.resolve(JSObject().put("records", records))
            } catch (e: Exception) { call.reject("Failed to read steps: ${e.message}") }
        }
    }

    @PluginMethod
    fun readActiveCaloriesBurned(call: PluginCall) {
        val client = healthConnectClient ?: run { call.resolve(JSObject().put("records", JSArray())); return }
        val startDate = call.getString("startDate") ?: run { call.reject("startDate required"); return }
        val endDate   = call.getString("endDate")   ?: run { call.reject("endDate required");   return }
        scope.launch {
            try {
                val start = parseDate(startDate)
                val end   = parseDateEnd(endDate)
                val response = client.readRecords(
                    ReadRecordsRequest(ActiveCaloriesBurnedRecord::class, TimeRangeFilter.between(start, end))
                )
                val byDate = mutableMapOf<String, Double>()
                for (record in response.records) {
                    val date = localDateOf(record.startTime)
                    byDate[date] = (byDate[date] ?: 0.0) + record.energy.inKilocalories
                }
                val records = JSArray()
                for ((date, kcal) in byDate.toSortedMap().toList().asReversed()) {
                    if (kcal <= 0.0) continue
                    val obj = JSObject()
                    obj.put("date", date)
                    obj.put("kcal", kcal)
                    records.put(obj)
                }
                call.resolve(JSObject().put("records", records))
            } catch (e: Exception) { call.reject("Failed to read active calories: ${e.message}") }
        }
    }

    @PluginMethod
    fun readTotalCaloriesBurned(call: PluginCall) {
        val client = healthConnectClient ?: run { call.resolve(JSObject().put("records", JSArray())); return }
        val startDate = call.getString("startDate") ?: run { call.reject("startDate required"); return }
        val endDate   = call.getString("endDate")   ?: run { call.reject("endDate required");   return }
        scope.launch {
            try {
                val start = parseDate(startDate)
                val end   = parseDateEnd(endDate)
                val response = client.readRecords(
                    ReadRecordsRequest(TotalCaloriesBurnedRecord::class, TimeRangeFilter.between(start, end))
                )
                val byDate = mutableMapOf<String, Double>()
                for (record in response.records) {
                    val date = localDateOf(record.startTime)
                    byDate[date] = (byDate[date] ?: 0.0) + record.energy.inKilocalories
                }
                val records = JSArray()
                for ((date, kcal) in byDate.toSortedMap().toList().asReversed()) {
                    if (kcal <= 0.0) continue
                    val obj = JSObject()
                    obj.put("date", date)
                    obj.put("kcal", kcal)
                    records.put(obj)
                }
                call.resolve(JSObject().put("records", records))
            } catch (e: Exception) { call.reject("Failed to read total calories: ${e.message}") }
        }
    }
}
