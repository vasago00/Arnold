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

    private val allPermissions = setOf(
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(WeightRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(NutritionRecord::class),
        HealthPermission.getReadPermission(HydrationRecord::class),
        HealthPermission.getWritePermission(NutritionRecord::class),
        HealthPermission.getWritePermission(HydrationRecord::class),
        HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(DistanceRecord::class),
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

    @PluginMethod
    fun writeNutrition(call: PluginCall) {
        val client = healthConnectClient ?: run { call.reject("Health Connect not available"); return }
        val recordObj = call.getObject("record") ?: run { call.reject("record required"); return }
        scope.launch {
            try {
                val startTime = Instant.parse(recordObj.getString("startTime"))
                val endTime = Instant.parse(recordObj.getString("endTime"))
                val zoneOffset = ZoneId.systemDefault().rules.getOffset(startTime)
                val record = NutritionRecord(
                    startTime = startTime, startZoneOffset = zoneOffset,
                    endTime = endTime, endZoneOffset = zoneOffset,
                    name = recordObj.optString("name", ""),
                    mealType = recordObj.optInt("mealType", 0),
                    energy = if (recordObj.has("calories")) androidx.health.connect.client.units.Energy.kilocalories(recordObj.getDouble("calories")) else null,
                    protein = if (recordObj.has("protein")) androidx.health.connect.client.units.Mass.grams(recordObj.getDouble("protein")) else null,
                    totalCarbohydrate = if (recordObj.has("carbs")) androidx.health.connect.client.units.Mass.grams(recordObj.getDouble("carbs")) else null,
                    totalFat = if (recordObj.has("fat")) androidx.health.connect.client.units.Mass.grams(recordObj.getDouble("fat")) else null,
                )
                val insertResult = client.insertRecords(listOf(record))
                val resp = JSObject()
                resp.put("success", true)
                if (insertResult.recordIdsList.isNotEmpty()) resp.put("id", insertResult.recordIdsList[0])
                call.resolve(resp)
            } catch (e: Exception) { call.reject("Failed to write nutrition: ${e.message}") }
        }
    }

    @PluginMethod
    fun writeHydration(call: PluginCall) {
        val client = healthConnectClient ?: run { call.reject("Health Connect not available"); return }
        val recordObj = call.getObject("record") ?: run { call.reject("record required"); return }
        scope.launch {
            try {
                val startTime = Instant.parse(recordObj.getString("startTime"))
                val endTime = Instant.parse(recordObj.getString("endTime"))
                val zoneOffset = ZoneId.systemDefault().rules.getOffset(startTime)
                val record = HydrationRecord(
                    startTime = startTime, startZoneOffset = zoneOffset,
                    endTime = endTime, endZoneOffset = zoneOffset,
                    volume = androidx.health.connect.client.units.Volume.milliliters(recordObj.getDouble("volumeMl")),
                )
                client.insertRecords(listOf(record))
                call.resolve(JSObject().apply { put("success", true) })
            } catch (e: Exception) { call.reject("Failed to write hydration: ${e.message}") }
        }
    }
}
