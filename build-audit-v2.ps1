# Builds Arnold-Audit.xlsx using the ImportExcel PowerShell module.
# Auto-installs the module if missing (no Excel COM, works without Excel running).
#
# Output: C:\Users\Superuser\Arnold\Arnold-Audit.xlsx

$outPath = 'C:\Users\Superuser\Arnold\Arnold-Audit.xlsx'

# --- Ensure ImportExcel module is available --------------------------------
if (-not (Get-Module -ListAvailable -Name ImportExcel)) {
    Write-Host 'Installing ImportExcel module from PSGallery...'
    try {
        Install-Module -Name ImportExcel -Force -Scope CurrentUser -AllowClobber -ErrorAction Stop
    } catch {
        Write-Host 'Auto-install failed. Run this once manually:' -ForegroundColor Red
        Write-Host '  Install-Module -Name ImportExcel -Scope CurrentUser -Force' -ForegroundColor Yellow
        Write-Host 'Then re-run this script.'
        exit 1
    }
}
Import-Module ImportExcel -Force

# Clear any prior file
if (Test-Path $outPath) { Remove-Item $outPath -Force }

# --- Helper to keep row construction tidy -----------------------------------
function Row($SourceField, $ArnoldField, $Storage, $SourceSample, $ArnoldSample, $Transform, $Rationale) {
    [PSCustomObject][ordered]@{
        'Source Field'       = $SourceField
        'Arnold Field'       = $ArnoldField
        'Storage Key'        = $Storage
        'Sample Source'      = $SourceSample
        'Sample Arnold'      = $ArnoldSample
        'Transform'          = $Transform
        'Rationale / Notes'  = $Rationale
    }
}

# --- ANOMALIES (open this sheet first) --------------------------------------
$anomalies = @(
    [PSCustomObject][ordered]@{
        Severity = 'HIGH'
        Source = 'Garmin Sleep CSV'
        Field = 'Body Battery Change'
        'Current Mapping' = 'arnold:sleep.bodyBattery'
        'What Happens' = 'Sleep CSV emits "Body Battery Change, +35" -- a daily delta. Parser does find("body","battery") which matches that label and stores +35 as bodyBattery. Tiles reading bodyBattery treat 35 as a "morning Body Battery score" -- wrong semantically.'
        'Fix' = 'Rename target field to bodyBatteryChange. If/when Garmin Connect Wellness sync ships, add separate bodyBatteryMorning field. Until then, any tile labeled "Body Battery" should read "Body Battery overnight gain" or be wired to the wellness sync.'
    }
    [PSCustomObject][ordered]@{
        Severity = 'HIGH'
        Source = 'Garmin Sleep CSV'
        Field = 'Avg Overnight HRV (ms)'
        'Current Mapping' = 'arnold:sleep.hrvStatus'
        'What Happens' = 'Parser stores 36 (numeric ms) into a field named hrvStatus. hrvStatus elsewhere holds qualitative labels like "Balanced". Numeric overnight HRV value gets misnamed; meanwhile the qualitative status from "7d Avg HRV" line is silently dropped because find("hrv") returns first match.'
        'Fix' = 'Two find() calls: find("avg","overnight","hrv") -> overnightHRV (numeric); find("7d","hrv") OR find("hrv","status") -> hrvStatus (string).'
    }
    [PSCustomObject][ordered]@{
        Severity = 'MEDIUM'
        Source = 'Garmin Sleep CSV'
        Field = '7d Avg HRV (Balanced/Low/Elevated)'
        'Current Mapping' = '(unmapped -- dropped)'
        'What Happens' = 'find("hrv") returns first match (numeric ms row) so qualitative status row never read. Status label silently lost on every import.'
        'Fix' = 'Same as above -- split into overnightHRV (numeric) + hrvStatus (label).'
    }
    [PSCustomObject][ordered]@{
        Severity = 'LOW'
        Source = 'Garmin Sleep CSV'
        Field = 'Avg Overnight Heart Rate'
        'Current Mapping' = '(unmapped)'
        'What Happens' = 'Avg HR during sleep is captured by Garmin but never read. Different from restingHR (which is the lowest sustained value during sleep).'
        'Fix' = 'Optional: add overnightHR field for users who want average sleep HR.'
    }
    [PSCustomObject][ordered]@{
        Severity = 'LOW'
        Source = 'Garmin Sleep CSV'
        Field = 'Stress Avg / Restless Moments / Lowest SpO2 / Lowest Respiration'
        'Current Mapping' = '(unmapped)'
        'What Happens' = 'Multiple metrics in the export are dropped on import. Not a bug per se -- just unused.'
        'Fix' = 'Add only if a Start-screen tile or DCY input ever needs them.'
    }
    [PSCustomObject][ordered]@{
        Severity = 'INFO'
        Source = 'HC Heart Rate sync'
        Field = 'restingHR derivation'
        'Current Mapping' = 'min(HR samples for date)'
        'What Happens' = 'HC restingHR is approximated by min(samples). Works if HC includes overnight samples; may drift high if only daytime activity recorded.'
        'Fix' = 'Prefer Sleep CSV restingHR over HC-derived when both available for the same date. Currently the merge order may not enforce this.'
    }
    [PSCustomObject][ordered]@{
        Severity = 'INFO'
        Source = 'HC Daily Energy noise filter'
        Field = 'syncDailyEnergy() guard'
        'Current Mapping' = 'Skip rows where steps<100 AND totalCal=0'
        'What Happens' = 'Intentional: drops fully-empty days. Could mask illness/rest days where only BMR shows.'
        'Fix' = 'Loosen to "steps<100 AND no calories AND no HR samples" -- empty for real, not just BMR-only.'
    }
    [PSCustomObject][ordered]@{
        Severity = 'INFO'
        Source = 'FIT bodyBatteryDrain'
        Field = 'Naming overlap with arnold:sleep.bodyBattery'
        'Current Mapping' = 'arnold:activities.bodyBatteryDrain (a delta -- named honestly)'
        'What Happens' = 'arnold:activities.bodyBatteryDrain is a delta (correct name). arnold:sleep.bodyBattery is ALSO a delta but missing "Drain" suffix. Inconsistent naming makes the sleep one easy to misuse.'
        'Fix' = 'Rename arnold:sleep.bodyBattery -> bodyBatteryChange to match activities-side convention.'
    }
)

# --- Per-source sheets -----------------------------------------------------

$sleepRows = @(
    Row 'Date' 'date' 'arnold:sleep' '2026-04-20' '2026-04-20' 'parseDate, ISO' 'Match'
    Row 'Sleep Score' 'sleepScore' 'arnold:sleep' '67' '67' 'int, capped at 100' 'Match'
    Row 'Sleep Duration' 'durationMinutes' 'arnold:sleep' '5h 9m' '309' 'parse "Xh Ym" -> minutes' 'Match'
    Row 'Quality' 'quality' 'arnold:sleep' 'Fair' 'Fair' 'pass-through' 'Match'
    Row 'Deep Sleep Duration' 'deepSleepMinutes' 'arnold:sleep' '1h 34m' '94' 'parse -> min' 'Match'
    Row 'Light Sleep Duration' 'lightSleepMinutes' 'arnold:sleep' '2h 50m' '170' 'parse -> min' 'Match'
    Row 'REM Duration' 'remSleepMinutes' 'arnold:sleep' '45m' '45' 'parse -> min' 'Match'
    Row 'Awake Time' 'awakeMinutes' 'arnold:sleep' '2m' '2' 'parse -> min' 'Match'
    Row 'Resting Heart Rate' 'restingHR' 'arnold:sleep' '46 bpm' '46' 'int, strips bpm' 'Match'
    Row 'Avg Overnight Heart Rate' '(unmapped)' '--' '50 bpm' '(not stored)' 'Not in parser' 'Could be added as overnightHR'
    Row 'Body Battery Change' 'bodyBattery' 'arnold:sleep' '+35' '35' 'int(find("body","battery"))' 'BUG #1 -- see Anomalies tab. Stores DELTA but field name implies an absolute score.'
    Row 'Avg SpO2' 'pulseOx' 'arnold:sleep' '96%' '96' 'num, strips %' 'Match'
    Row 'Lowest SpO2' '(unmapped)' '--' '86%' '(not stored)' 'Not in parser' 'Could add pulseOxLow'
    Row 'Avg Respiration' 'respiration' 'arnold:sleep' '13 brpm' '13' 'num, strips brpm' 'Match'
    Row 'Lowest Respiration' '(unmapped)' '--' '10 brpm' '(not stored)' 'Not in parser' 'Could add'
    Row 'Avg Overnight HRV' 'hrvStatus' 'arnold:sleep' '36 ms' '36' 'int(find("hrv"))' 'BUG #2 -- see Anomalies tab. Numeric ms goes into a field named hrvStatus.'
    Row '7d Avg HRV' '(dropped)' '--' 'Balanced' '(lost)' 'find("hrv") matches the wrong row first' 'BUG #3 -- see Anomalies tab. Qualitative label silently lost.'
    Row 'Bedtime' 'bedtime' 'arnold:sleep' '11:30 PM' '23:30' 'parseClock to 24h' 'Match'
    Row 'Wake Time' 'wakeTime' 'arnold:sleep' '6:30 AM' '06:30' 'parseClock to 24h' 'Match'
    Row 'Stress Avg' '(unmapped)' '--' '20' '(not stored)' 'Not in parser' 'Could add overnightStress'
    Row 'Restless Moments' '(unmapped)' '--' '33' '(not stored)' 'Not in parser' 'Could add restlessCount'
)

$activityRows = @(
    Row 'Date' 'date' 'arnold:activities' '2026-04-26' '2026-04-26' 'normalizeDate (M/D/YYYY -> YYYY-MM-DD)' 'Match (after Apr-25 fix)'
    Row '(time portion)' 'time' 'arnold:activities' '08:30 AM' '08:30' 'extractTime' 'Match'
    Row 'Activity Type' 'activityType' 'arnold:activities' 'Running' 'Running' 'pass-through' 'Match'
    Row 'Title' 'title' 'arnold:activities' 'Sunday Run' 'Sunday Run' 'pass-through' 'Match'
    Row 'Distance' 'distanceMi' 'arnold:activities' '10.01 mi' '10.01' 'parseFloat' 'Match'
    Row '(computed)' 'distanceKm' 'arnold:activities' '10.01 mi' '16.11' 'distanceMi x 1.60934' 'Match'
    Row 'Calories' 'calories' 'arnold:activities' '1269' '1269' 'int' 'Match'
    Row 'Time' 'durationSecs' 'arnold:activities' '1:41:09' '6069' 'parseTime (H:MM:SS -> s)' 'Match'
    Row 'Time' 'durationFormatted' 'arnold:activities' '1:41:09' '1:41:09' 'fmtDuration' 'Match'
    Row 'Avg HR' 'avgHR' 'arnold:activities' '130' '130' 'int' 'Match'
    Row 'Max HR' 'maxHR' 'arnold:activities' '137' '137' 'int' 'Match'
    Row 'Aerobic TE' 'aerobicTE' 'arnold:activities' '3.4' '3.4' 'parseFloat' 'Match'
    Row 'Avg Run Cadence' 'avgCadence' 'arnold:activities' '167 spm' '167' 'int' 'Match'
    Row 'Max Run Cadence' 'maxCadence' 'arnold:activities' '180 spm' '180' 'int' 'Match'
    Row 'Avg Pace / Avg GAP / Avg Speed' 'avgPaceRaw' 'arnold:activities' '10:06 /mi' '10:06' 'Prefer Pace -> GAP -> Speed' 'Match. Order matters: if Pace blank but GAP populated, GAP wins.'
    Row 'Best Pace / Max Speed' 'bestPaceRaw' 'arnold:activities' '8:34 /mi' '8:34' 'Prefer Best Pace -> Max Speed' 'Match'
    Row 'Total Ascent' 'totalAscentFt' 'arnold:activities' '450 ft' '450' 'int' 'Match'
    Row '(computed)' 'totalAscentM' 'arnold:activities' '450 ft' '137' 'totalAscentFt x 0.3048' 'Match'
    Row 'Total Descent' 'totalDescentFt' 'arnold:activities' '438 ft' '438' 'int' 'Match'
    Row '(computed)' 'totalDescentM' 'arnold:activities' '438 ft' '134' 'totalDescentFt x 0.3048' 'Match'
    Row 'Avg Stride Length' 'avgStrideLength' 'arnold:activities' '1.32 m' '1.32' 'num' 'Match'
    Row 'Avg Power' 'avgPower' 'arnold:activities' '280 W' '280' 'int' 'Match'
    Row 'Max Power' 'maxPower' 'arnold:activities' '420 W' '420' 'int' 'Match'
    Row 'Steps' 'steps' 'arnold:activities' '14210' '14210' 'int' 'Match'
    Row 'Total Reps' 'totalReps' 'arnold:activities' '120' '120' 'int' 'Match (strength only)'
    Row 'Total Sets' 'setsCount' 'arnold:activities' '12' '12' 'int' 'Match (strength only)'
    Row 'Body Battery Drain' 'bodyBatteryDrain' 'arnold:activities' '15' '15' 'int' 'Match (TRUE delta -- name is honest here)'
    Row 'Moving Time' 'movingTimeSecs' 'arnold:activities' '1:38:00' '5880' 'parseTime' 'Match'
    Row 'Training Stress Score' 'trainingStressScore' 'arnold:activities' '92' '92' 'num' 'Match'
)

$fitRows = @(
    Row 'session.startTime' 'date / time' 'arnold:activities' '2026-04-26 08:30:00 LOCAL' '2026-04-26 / 08:30 AM' 'getFullYear/Month/Date (LOCAL -- was UTC, fixed)' 'Match (after UTC fix)'
    Row 'session.sport' 'sport' 'arnold:activities' 'running' 'running' 'lowercase' 'Match'
    Row 'session.subSport' 'subSport' 'arnold:activities' 'generic' 'generic' 'lowercase' 'Match'
    Row 'sport+subSport derivation' 'activityType' 'arnold:activities' 'running/generic' 'Run (outdoor)' 'sport mapping' 'Match. dcyMath.allActivities() relabels to "Running" for downstream filter compat.'
    Row 'session.totalDistance (m)' 'distanceMi / distanceKm / distanceM' 'arnold:activities' '16110 m' '10.01 / 16.11 / 16110' 'm -> mi (/1609.344), m -> km (/1000)' 'Match'
    Row 'session.totalElapsedTime / totalTimerTime' 'durationSecs / durationMins / duration' 'arnold:activities' '6069 s' '6069 / 101 / "1:41:09"' 'h:mm:ss formatting' 'Match'
    Row 'session.avgHeartRate' 'avgHR' 'arnold:activities' '130' '130' 'int, clamped 30-250 bpm' 'Match'
    Row 'session.maxHeartRate' 'maxHR' 'arnold:activities' '137' '137' 'int, same clamp' 'Match'
    Row 'session.avgRunningCadence' 'avgCadence' 'arnold:activities' '83.5 (half-steps)' '167' 'x 2 (Garmin reports per-foot, doubled for spm)' 'Match'
    Row 'session.maxRunningCadence' 'maxCadence' 'arnold:activities' '90' '180' 'x 2' 'Match'
    Row 'session.avgPower' 'avgPowerW' 'arnold:activities' '280' '280' 'int' 'Match'
    Row 'session.maxPower' 'maxPowerW' 'arnold:activities' '420' '420' 'int' 'Match'
    Row 'session.normalizedPower' 'normalizedPower' 'arnold:activities' '295' '295' 'int' 'Match'
    Row 'session.totalAscent (m)' 'totalAscentM / totalAscentFt' 'arnold:activities' '137 m' '137 / 450' 'm -> ft (x 3.28084)' 'Match'
    Row 'session.totalCalories' 'calories' 'arnold:activities' '1269' '1269' 'int' 'Match'
    Row 'session.trainingStressScore' 'trainingStressScore' 'arnold:activities' '92' '92' 'num' 'Match'
    Row 'session.totalTrainingEffect' 'aerobicTrainingEffect' 'arnold:activities' '3.4' '3.4' 'num' 'Match'
    Row 'session.totalAnaerobicTrainingEffect' 'anaerobicTrainingEffect' 'arnold:activities' '0.6' '0.6' 'num' 'Match'
    Row 'session.avgStrideLength (m)' 'avgStrideLength' 'arnold:activities' '1.32' '1.32' 'num' 'Match'
    Row 'session.avgVerticalOscillation (mm)' 'avgVerticalOscillation' 'arnold:activities' '88 mm' '88' 'num (raw mm)' 'Tile registry converts to cm (/ 10) at display'
    Row 'session.avgVerticalRatio (%)' 'avgVerticalRatio' 'arnold:activities' '6.4' '6.4' 'num' 'Match'
    Row 'session.avgStanceTime (ms)' 'avgGroundContactTime' 'arnold:activities' '252' '252' 'int (ms)' 'Match'
    Row 'session.totalTimerTime' 'movingTimeSecs' 'arnold:activities' '5880' '5880' 'int' 'Match'
    Row 'setMesgs.length' 'setsCount' 'arnold:activities' '12 sets' '12' 'count' 'Match (strength)'
    Row 'sum(setMesgs[].repetitions)' 'totalReps' 'arnold:activities' '120' '120' 'sum' 'Match'
    Row 'session.bodyBatteryStart - bodyBatteryEnd' 'bodyBatteryDrain' 'arnold:activities' '85 - 70 = 15' '15' '(start - end)' 'Match (TRUE delta, semantically correct)'
    Row 'session.timeInHrZone[1..5]' 'hrZones' 'arnold:activities' '[120,3000,1800,400,30]' '[120,3000,1800,400,30]' 'array OR fields timeInHrZone_1..5' 'Match (Phase 4b add). null if device did not record zones.'
    Row 'session.totalTrainingLoad' 'totalTrainingLoad' 'arnold:activities' '210' '210' 'int (EPOC equivalent)' 'Match (Phase 4b add)'
    Row 'session.timeFor5k / predictedTime5k' 'racePredictor.t5k' 'arnold:activities' '1320 (22:00)' '1320' 'int sec' 'Match (Phase 4b add). Newer FRs only.'
    Row 'session.timeForHalf / predictedTimeHalfMarathon' 'racePredictor.tHM' 'arnold:activities' '5460 (1:31:00)' '5460' 'int sec' 'Match (Phase 4b add)'
    Row 'recordMesgs[].heartRate / enhancedSpeed' 'aerobicDecoupling' 'arnold:activities' '~5000 1Hz samples' '4.2 (%)' 'Half-split avg HR/speed ratio drift' 'Match (Phase 4b add). Computed at parse time, runs >= 30 min only.'
)

$hrvRows = @(
    Row 'Date' 'date' 'arnold:hrv' 'Apr 25' '2026-04-25' 'Year-aware ISO normalization' 'Match'
    Row 'Overnight HRV' 'overnightHRV' 'arnold:hrv' '36 ms' '36' 'int, strips ms' 'Match'
    Row 'Baseline' 'baselineLow / baselineHigh' 'arnold:hrv' '32ms - 47ms' '32 / 47' 'parse "X - Y" pair' 'Match'
    Row '7-Day Avg / Seven' 'sevenDayAvg' 'arnold:hrv' '40 ms' '40' 'int' 'Match'
    Row '(computed)' 'status' 'arnold:hrv' '36 in [32,47]' 'balanced' 'Compare HRV vs baseline range' 'Match. Note: arnold:hrv.status holds the qualitative label correctly. The arnold:sleep collection has a confusingly-named hrvStatus field that is being misused -- see Anomalies.'
)

$weightRows = @(
    Row 'Date' 'date' 'arnold:weight' 'Apr 6, 2026' '2026-04-06' 'Year-aware ISO' 'Match'
    Row 'Time' 'time' 'arnold:weight' '7:57 AM' '07:57' 'parseClock to 24h' 'Match'
    Row 'Weight' 'weightLbs' 'arnold:weight' '190.5 lbs' '190.5' 'num' 'Match'
    Row '(computed)' 'weightKg' 'arnold:weight' '190.5 lbs' '86.4' 'x 0.453592' 'Match'
    Row 'Change' 'changeLbs' 'arnold:weight' '-0.3 lbs' '-0.3' 'num' 'Match (TRUE delta)'
    Row 'BMI' 'bmi' 'arnold:weight' '24.5' '24.5' 'num' 'Match'
    Row 'Body Fat %' 'bodyFatPct' 'arnold:weight' '17.8%' '17.8' 'num, strips %' 'Match'
    Row 'Skeletal Muscle Mass' 'skeletalMuscleMassLbs / Kg' 'arnold:weight' '88.2 lbs' '88.2 / 40.0' 'num + x0.453592' 'Match'
    Row 'Bone Mass' 'boneMassLbs' 'arnold:weight' '7.6 lbs' '7.6' 'num' 'Match'
    Row 'Body Water %' 'bodyWaterPct' 'arnold:weight' '54.2%' '54.2' 'num, strips %' 'Match'
)

$cronoRows = @(
    Row 'Date' 'date' 'arnold:cronometer' '2026-04-26' '2026-04-26' 'ISO' 'Match'
    Row 'Energy (kcal)' 'calories' 'arnold:cronometer' '1750 kcal' '1750' 'int' 'Match'
    Row 'Protein (g)' 'protein' 'arnold:cronometer' '128 g' '128' 'num' 'Match'
    Row 'Carbs (g)' 'carbs' 'arnold:cronometer' '210 g' '210' 'num' 'Match'
    Row 'Net Carbs' 'netCarbs' 'arnold:cronometer' '180 g' '180' 'num' 'Match'
    Row 'Fat (g)' 'fat' 'arnold:cronometer' '52 g' '52' 'num' 'Match'
    Row 'Fiber (g)' 'fiber' 'arnold:cronometer' '32 g' '32' 'num' 'Match'
    Row 'Sugars (g)' 'sugar' 'arnold:cronometer' '45 g' '45' 'num' 'Match'
    Row 'Saturated Fat' 'saturatedFat' 'arnold:cronometer' '12 g' '12' 'num' 'Match'
    Row 'Omega-3' 'omega3' 'arnold:cronometer' '1.4 g' '1.4' 'num' 'Match'
    Row 'Alcohol' 'alcohol' 'arnold:cronometer' '0 g' '0' 'num' 'Match'
    Row 'Caffeine' 'caffeine' 'arnold:cronometer' '180 mg' '180' 'num' 'Match'
    Row 'Water (g)' 'water' 'arnold:cronometer' '2500 g' '2.5' 'g -> L (/1000)' 'Match. Cronometer reports water in grams; Arnold stores in liters.'
    Row 'Sodium (mg)' 'sodium' 'arnold:cronometer' '2100 mg' '2100' 'int' 'Match'
    Row 'Potassium (mg)' 'potassium' 'arnold:cronometer' '3500 mg' '3500' 'int' 'Match'
    Row 'Magnesium (mg)' 'magnesium' 'arnold:cronometer' '420 mg' '420' 'int' 'Match'
    Row 'Calcium (mg)' 'calcium' 'arnold:cronometer' '1100 mg' '1100' 'int' 'Match'
    Row 'Iron (mg)' 'iron' 'arnold:cronometer' '14 mg' '14' 'num' 'Match'
    Row 'Vitamin D (IU)' 'vitaminD' 'arnold:cronometer' '600 IU' '600' 'num' 'Match'
    Row 'Vitamin C (mg)' 'vitaminC' 'arnold:cronometer' '120 mg' '120' 'num' 'Match'
    Row 'Vitamin A' 'vitaminA' 'arnold:cronometer' '900 ug' '900' 'num' 'Match'
    Row 'B12 (Cobalamin)' 'vitaminB12' 'arnold:cronometer' '5 ug' '5' 'num' 'Match'
    Row 'Folate' 'folate' 'arnold:cronometer' '450 ug' '450' 'num' 'Match'
    Row 'Zinc (mg)' 'zinc' 'arnold:cronometer' '12 mg' '12' 'num' 'Match'
    Row 'Cholesterol (mg)' 'cholesterol' 'arnold:cronometer' '320 mg' '320' 'num' 'Match'
    Row 'Completed' 'completed' 'arnold:cronometer' 'Yes' 'true' 'bool' 'Match'
)

$hcRows = @(
    Row 'SleepSession.startTime / endTime' 'date / durationMinutes' 'arnold:sleep' '2026-04-26T22:00 -> 06:30' '2026-04-26 / 510' 'ms duration / 60000' 'Match'
    Row 'SleepSession.stages[deep,rem,light,awake]' 'deepSleepMinutes / remSleepMinutes / lightSleepMinutes / awakeMinutes' 'arnold:sleep' '8400000 ms (deep)' '140 / etc' 'ms -> min' 'Match'
    Row '(derived)' 'sleepScore' 'arnold:sleep' 'duration%, deep%, REM%, awake%' '78' 'DCY section8 formula' 'Match'
    Row 'WeightRecord.weightKg' 'weightKg' 'arnold:weight' '86.4 kg' '86.4' 'num, rounded' 'Match'
    Row '(derived)' 'weightLbs' 'arnold:weight' '86.4 kg' '190.5' 'x 2.20462' 'Match'
    Row '(derived from profile.height)' 'bmi' 'arnold:weight' '86.4 kg + 1.83 m' '25.8' 'kg / m^2' 'Match'
    Row 'HeartRateRecord.bpm (min per day)' 'restingHR' 'arnold:sleep (merged)' '46' '46' 'min(samples)' 'See Anomalies -- HC restingHR uses min of all samples; may not capture true sleeping RHR if HC has only daytime samples. Sleep CSV path captures it directly.'
    Row 'readSteps()' 'steps' 'arnold:hcDailyEnergy' '12500 steps' '12500' 'int' 'Match'
    Row 'readActiveCaloriesBurned()' 'activeCalories' 'arnold:hcDailyEnergy' '480 kcal' '480' 'int' 'Match'
    Row 'readTotalCaloriesBurned()' 'totalCalories' 'arnold:hcDailyEnergy' '2820 kcal' '2820' 'int' 'Match'
    Row '(noise filter)' 'skipped row' '--' 'steps<100 AND total=0' '(row dropped)' 'guard' 'INTENTIONAL: skips sedentary days with no data. See Anomalies for edge case.'
)

# --- Write each sheet ------------------------------------------------------
$xlConditional = @{ AutoSize = $true; FreezeTopRow = $true; BoldTopRow = $true; TableStyle = 'Medium2' }

Write-Host "Writing Anomalies tab (open this first)..."
$anomalies | Export-Excel -Path $outPath -WorksheetName 'Anomalies' -AutoSize -FreezeTopRow -BoldTopRow -TableStyle 'Medium3' -TableName 'Anomalies'

Write-Host "Writing Sleep (Garmin CSV) tab..."
$sleepRows | Export-Excel -Path $outPath -WorksheetName 'Sleep CSV' @xlConditional -TableName 'SleepCSV'

Write-Host "Writing Activities (Garmin CSV) tab..."
$activityRows | Export-Excel -Path $outPath -WorksheetName 'Activities CSV' @xlConditional -TableName 'ActivitiesCSV'

Write-Host "Writing FIT (Binary) tab..."
$fitRows | Export-Excel -Path $outPath -WorksheetName 'FIT Binary' @xlConditional -TableName 'FITBinary'

Write-Host "Writing HRV CSV tab..."
$hrvRows | Export-Excel -Path $outPath -WorksheetName 'HRV CSV' @xlConditional -TableName 'HRVCSV'

Write-Host "Writing Weight CSV tab..."
$weightRows | Export-Excel -Path $outPath -WorksheetName 'Weight CSV' @xlConditional -TableName 'WeightCSV'

Write-Host "Writing Cronometer tab..."
$cronoRows | Export-Excel -Path $outPath -WorksheetName 'Cronometer' @xlConditional -TableName 'Cronometer'

Write-Host "Writing Health Connect tab..."
$hcRows | Export-Excel -Path $outPath -WorksheetName 'Health Connect' @xlConditional -TableName 'HealthConnect'

Write-Host ""
Write-Host "Done. Audit saved to: $outPath" -ForegroundColor Green
Write-Host "Open it and start with the Anomalies tab -- that is where the bugs live." -ForegroundColor Yellow
