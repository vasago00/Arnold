# Builds Arnold-Audit.xlsx — every attribute Arnold ingests from Garmin /
# Cronometer / Health Connect, mapped to its internal storage field, with
# sample source values, predicted Arnold values, and rationale per row.
#
# Anomalies tab surfaces the real bugs found during the field-by-field walk
# (Body Battery Change → bodyBattery, hrvStatus type mismatch, etc.).
#
# Requires Excel installed (uses Excel.Application COM object).
# Output: C:\Users\Superuser\Arnold\Arnold-Audit.xlsx

$outPath = 'C:\Users\Superuser\Arnold\Arnold-Audit.xlsx'

# Each row: SourceField, ArnoldField, Storage, SourceSample, ArnoldSample, Transform, Rationale
function New-Row($SourceField, $ArnoldField, $Storage, $SourceSample, $ArnoldSample, $Transform, $Rationale) {
    [PSCustomObject]@{
        'Source Field'    = $SourceField
        'Arnold Field'    = $ArnoldField
        'Storage Key'     = $Storage
        'Sample Source'   = $SourceSample
        'Sample Arnold'   = $ArnoldSample
        'Transform'       = $Transform
        'Rationale / Notes' = $Rationale
    }
}

# ─── SHEET DEFINITIONS ──────────────────────────────────────────────────────

$sleepRows = @(
    New-Row 'Date'                       'date'                'arnold:sleep'   '2026-04-20'        '2026-04-20'        'parseDate, ISO'                                'Pass-through'
    New-Row 'Sleep Score'                'sleepScore'          'arnold:sleep'   '67'                '67'                'int, capped at 100'                            'Match'
    New-Row 'Sleep Duration'             'durationMinutes'     'arnold:sleep'   '5h 9m'             '309'               'parse "Xh Ym" to minutes'                      'Match'
    New-Row 'Quality'                    'quality'             'arnold:sleep'   'Fair'              'Fair'              'Pass-through string'                           'Match'
    New-Row 'Deep Sleep Duration'        'deepSleepMinutes'    'arnold:sleep'   '1h 34m'            '94'                'parse "Xh Ym" to minutes'                      'Match'
    New-Row 'Light Sleep Duration'       'lightSleepMinutes'   'arnold:sleep'   '2h 50m'            '170'               'parse "Xh Ym" to minutes'                      'Match'
    New-Row 'REM Duration'               'remSleepMinutes'     'arnold:sleep'   '45m'               '45'                'parse to minutes'                              'Match'
    New-Row 'Awake Time'                 'awakeMinutes'        'arnold:sleep'   '2m'                '2'                 'parse to minutes'                              'Match'
    New-Row 'Resting Heart Rate'         'restingHR'           'arnold:sleep'   '46 bpm'            '46'                'int, strips bpm suffix'                        'Match'
    New-Row 'Avg Overnight Heart Rate'   '(unmapped)'          '—'              '50 bpm'            '(not stored)'      'Not in parser'                                 'Garmin emits but Arnold does not capture; could be added as overnightHR'
    New-Row 'Body Battery Change'        'bodyBattery'         'arnold:sleep'   '+35'               '35'                'int(find("body","battery"))'                   'BUG: parser stores DELTA (overnight gain) but field name implies an absolute score. Should map to bodyBatteryChange or be split into bodyBatteryStart/End from a different field.'
    New-Row 'Avg SpO2'                   'pulseOx'             'arnold:sleep'   '96%'               '96'                'num, strips %'                                 'Match'
    New-Row 'Lowest SpO2'                '(unmapped)'          '—'              '86%'               '(not stored)'      'Not in parser'                                 'Could be added as pulseOxLow'
    New-Row 'Avg Respiration'            'respiration'         'arnold:sleep'   '13 brpm'           '13'                'num, strips brpm'                              'Match'
    New-Row 'Lowest Respiration'         '(unmapped)'          '—'              '10 brpm'           '(not stored)'      'Not in parser'                                 'Could be added'
    New-Row 'Avg Overnight HRV'          'hrvStatus'           'arnold:sleep'   '36 ms'             '36'                'int(find("hrv"))'                              'BUG: parser stores 36 (ms value) into a field called hrvStatus. hrvStatus should hold the qualitative label ("Balanced"). Currently Avg Overnight HRV value (which is a separate metric) gets misnamed AND the qualitative status gets dropped.'
    New-Row '7d Avg HRV (status)'        '(unmapped)'          '—'              'Balanced'          '(not stored)'      'Currently overwritten/lost'                    'BUG: This is the actual qualitative HRV status from Garmin. Parser drops it because find("hrv") returns the FIRST match (the numeric ms value above). Status label never captured.'
    New-Row 'Bedtime'                    'bedtime'             'arnold:sleep'   '11:30 PM'          '23:30'             'parseClock to 24h'                             'Match'
    New-Row 'Wake Time'                  'wakeTime'            'arnold:sleep'   '6:30 AM'           '06:30'             'parseClock to 24h'                             'Match'
    New-Row 'Stress Avg'                 '(unmapped)'          '—'              '20'                '(not stored)'      'Not in parser'                                 'Could be added as overnightStress'
    New-Row 'Restless Moments'           '(unmapped)'          '—'              '33'                '(not stored)'      'Not in parser'                                 'Could be added as restlessCount'
)

$activityRows = @(
    New-Row 'Date'                  'date'              'arnold:activities' '2026-04-26'    '2026-04-26'    'normalizeDate (M/D/YYYY → YYYY-MM-DD)'   'Match (after Apr-25 fix)'
    New-Row '(time portion)'        'time'              'arnold:activities' '08:30 AM'      '08:30'         'extractTime from datetime'               'Match'
    New-Row 'Activity Type'         'activityType'      'arnold:activities' 'Running'       'Running'       'Pass-through'                            'Match'
    New-Row 'Title'                 'title'             'arnold:activities' 'Sunday Run'    'Sunday Run'    'Pass-through'                            'Match'
    New-Row 'Distance'              'distanceMi'        'arnold:activities' '10.01 mi'      '10.01'         'parseFloat'                              'Match'
    New-Row '(computed)'            'distanceKm'        'arnold:activities' '10.01 mi'      '16.11'         'distanceMi × 1.60934'                    'Match'
    New-Row 'Calories'              'calories'          'arnold:activities' '1269'          '1269'          'int'                                     'Match'
    New-Row 'Time'                  'durationSecs'      'arnold:activities' '1:41:09'       '6069'          'parseTime (H:MM:SS to s)'                'Match'
    New-Row 'Time'                  'durationFormatted' 'arnold:activities' '1:41:09'       '1:41:09'       'fmtDuration'                             'Match'
    New-Row 'Avg HR'                'avgHR'             'arnold:activities' '130'           '130'           'int'                                     'Match'
    New-Row 'Max HR'                'maxHR'             'arnold:activities' '137'           '137'           'int'                                     'Match'
    New-Row 'Aerobic TE'            'aerobicTE'         'arnold:activities' '3.4'           '3.4'           'parseFloat'                              'Match'
    New-Row 'Avg Run Cadence'       'avgCadence'        'arnold:activities' '167 spm'       '167'           'int'                                     'Match'
    New-Row 'Max Run Cadence'       'maxCadence'        'arnold:activities' '180 spm'       '180'           'int'                                     'Match'
    New-Row 'Avg Pace / Avg GAP / Avg Speed' 'avgPaceRaw' 'arnold:activities' '10:06 /mi'    '10:06'         'Prefer Pace → GAP → Speed'               'Match. Note: order of preference matters — if Pace blank but GAP populated, GAP wins.'
    New-Row 'Best Pace / Max Speed' 'bestPaceRaw'       'arnold:activities' '8:34 /mi'      '8:34'          'Prefer Best Pace → Max Speed'            'Match'
    New-Row 'Total Ascent'          'totalAscentFt'     'arnold:activities' '450 ft'        '450'           'int'                                     'Match'
    New-Row '(computed)'            'totalAscentM'      'arnold:activities' '450 ft'        '137'           'totalAscentFt × 0.3048'                  'Match'
    New-Row 'Total Descent'         'totalDescentFt'    'arnold:activities' '438 ft'        '438'           'int'                                     'Match'
    New-Row '(computed)'            'totalDescentM'     'arnold:activities' '438 ft'        '134'           'totalDescentFt × 0.3048'                 'Match'
    New-Row 'Avg Stride Length'     'avgStrideLength'   'arnold:activities' '1.32 m'        '1.32'          'num'                                     'Match'
    New-Row 'Avg Power'             'avgPower'          'arnold:activities' '280 W'         '280'           'int'                                     'Match'
    New-Row 'Max Power'             'maxPower'          'arnold:activities' '420 W'         '420'           'int'                                     'Match'
    New-Row 'Steps'                 'steps'             'arnold:activities' '14210'         '14210'         'int'                                     'Match'
    New-Row 'Total Reps'            'totalReps'         'arnold:activities' '120'           '120'           'int'                                     'Match (strength only)'
    New-Row 'Total Sets'            'setsCount'         'arnold:activities' '12'            '12'            'int'                                     'Match (strength only)'
    New-Row 'Body Battery Drain'    'bodyBatteryDrain'  'arnold:activities' '15'            '15'            'int'                                     'Match (this IS a delta, intentional)'
    New-Row 'Moving Time'           'movingTimeSecs'    'arnold:activities' '1:38:00'       '5880'          'parseTime'                               'Match'
    New-Row 'Training Stress Score' 'trainingStressScore' 'arnold:activities' '92'         '92'            'num'                                     'Match'
)

$fitRows = @(
    New-Row 'session.startTime'                       'date / time'                'arnold:activities' '2026-04-26 08:30:00 LOCAL' '2026-04-26 / 08:30 AM' 'getFullYear/Month/Date (LOCAL — was UTC, fixed)' 'Match (after UTC fix)'
    New-Row 'session.sport'                           'sport'                      'arnold:activities' 'running'                  'running'              'lowercase'                                       'Match'
    New-Row 'session.subSport'                        'subSport'                   'arnold:activities' 'generic'                  'generic'              'lowercase'                                       'Match'
    New-Row 'sport+subSport derivation'               'activityType'               'arnold:activities' 'running/generic'          'Run (outdoor)'        'sport mapping'                                   'Match. NOTE: dcyMath.allActivities() now relabels to "Running" for downstream filter compat.'
    New-Row 'session.totalDistance (m)'               'distanceMi / distanceKm / distanceM' 'arnold:activities' '16110 m'         '10.01 / 16.11 / 16110' 'm → mi (÷1609.344), m → km (÷1000)'              'Match'
    New-Row 'session.totalElapsedTime / totalTimerTime' 'durationSecs / durationMins / duration' 'arnold:activities' '6069 s'    '6069 / 101 / "1:41:09"' 'h:mm:ss formatting'                              'Match'
    New-Row 'session.avgHeartRate'                    'avgHR'                      'arnold:activities' '130'                      '130'                  'int, clamped 30–250 (physio range)'              'Match'
    New-Row 'session.maxHeartRate'                    'maxHR'                      'arnold:activities' '137'                      '137'                  'int, same clamp'                                 'Match'
    New-Row 'session.avgRunningCadence'               'avgCadence'                 'arnold:activities' '83.5 (half-steps)'        '167'                  '× 2 (Garmin reports per-foot, doubled for spm)'  'Match'
    New-Row 'session.maxRunningCadence'               'maxCadence'                 'arnold:activities' '90'                       '180'                  '× 2'                                             'Match'
    New-Row 'session.avgPower'                        'avgPowerW'                  'arnold:activities' '280'                      '280'                  'int'                                             'Match'
    New-Row 'session.maxPower'                        'maxPowerW'                  'arnold:activities' '420'                      '420'                  'int'                                             'Match'
    New-Row 'session.normalizedPower'                 'normalizedPower'            'arnold:activities' '295'                      '295'                  'int'                                             'Match'
    New-Row 'session.totalAscent (m)'                 'totalAscentM / totalAscentFt' 'arnold:activities' '137 m'                  '137 / 450'            'm → ft (× 3.28084)'                              'Match'
    New-Row 'session.totalCalories'                   'calories'                   'arnold:activities' '1269'                     '1269'                 'int'                                             'Match'
    New-Row 'session.trainingStressScore'             'trainingStressScore'        'arnold:activities' '92'                       '92'                   'num'                                             'Match'
    New-Row 'session.totalTrainingEffect'             'aerobicTrainingEffect'      'arnold:activities' '3.4'                      '3.4'                  'num'                                             'Match'
    New-Row 'session.totalAnaerobicTrainingEffect'    'anaerobicTrainingEffect'    'arnold:activities' '0.6'                      '0.6'                  'num'                                             'Match'
    New-Row 'session.avgStrideLength (m)'             'avgStrideLength'            'arnold:activities' '1.32'                     '1.32'                 'num'                                             'Match'
    New-Row 'session.avgVerticalOscillation (mm)'     'avgVerticalOscillation'     'arnold:activities' '88 mm'                    '88'                   'num (raw mm)'                                    'NOTE: tile registry converts to cm (÷ 10) at display time'
    New-Row 'session.avgVerticalRatio (%)'            'avgVerticalRatio'           'arnold:activities' '6.4'                      '6.4'                  'num'                                             'Match'
    New-Row 'session.avgStanceTime (ms)'              'avgGroundContactTime'       'arnold:activities' '252'                      '252'                  'int (ms)'                                        'Match'
    New-Row 'session.totalTimerTime'                  'movingTimeSecs'             'arnold:activities' '5880'                     '5880'                 'int'                                             'Match'
    New-Row 'setMesgs.length'                         'setsCount'                  'arnold:activities' '12 sets'                  '12'                   'count'                                           'Match (strength)'
    New-Row 'sum(setMesgs[].repetitions)'             'totalReps'                  'arnold:activities' '120'                      '120'                  'sum'                                             'Match'
    New-Row 'session.bodyBatteryStart - bodyBatteryEnd' 'bodyBatteryDrain'         'arnold:activities' '85 - 70 = 15'             '15'                   '(start − end)'                                   'Match (a TRUE delta, semantically correct here)'
    New-Row 'session.timeInHrZone[1..5]'              'hrZones'                    'arnold:activities' '[120,3000,1800,400,30]'   '[120,3000,1800,400,30]' 'array OR fields timeInHrZone_1..5'              'Match (Phase 4b add). null if device did not record zones.'
    New-Row 'session.totalTrainingLoad'               'totalTrainingLoad'          'arnold:activities' '210'                      '210'                  'int (EPOC equivalent)'                           'Match (Phase 4b add)'
    New-Row 'session.timeFor5k / predictedTime5k'     'racePredictor.t5k'          'arnold:activities' '1320 (22:00)'             '1320'                 'int sec'                                         'Match (Phase 4b add). Newer FRs only.'
    New-Row 'session.timeForHalf / predictedTimeHalfMarathon' 'racePredictor.tHM'  'arnold:activities' '5460 (1:31:00)'           '5460'                 'int sec'                                         'Match (Phase 4b add)'
    New-Row 'recordMesgs[].heartRate / enhancedSpeed' 'aerobicDecoupling'          'arnold:activities' '~5000 1Hz samples'        '4.2 (%)'              'Half-split avg HR÷speed ratio drift'             'Match (Phase 4b add). Computed at parse time, runs ≥ 30 min only.'
)

$hrvRows = @(
    New-Row 'Date'                'date'           'arnold:hrv' 'Apr 25'       '2026-04-25'    'Year-aware ISO normalization' 'Match'
    New-Row 'Overnight HRV'       'overnightHRV'   'arnold:hrv' '36 ms'        '36'            'int, strips ms'              'Match'
    New-Row 'Baseline'            'baselineLow / baselineHigh' 'arnold:hrv' '32ms - 47ms' '32 / 47' 'parse "X - Y" pair'   'Match'
    New-Row '7-Day Avg / Seven'   'sevenDayAvg'    'arnold:hrv' '40 ms'        '40'            'int'                          'Match'
    New-Row '(computed)'          'status'         'arnold:hrv' '36 in [32,47]' 'balanced'      'Compare HRV vs baseline range' 'Match. NOTE: This is named status (in arnold:hrv collection). The arnold:sleep collection has a DIFFERENT field named hrvStatus that is being misused — see Sleep tab and Anomalies tab.'
)

$weightRows = @(
    New-Row 'Date'                          'date'                       'arnold:weight' 'Apr 6, 2026'  '2026-04-06'  'Year-aware ISO'        'Match'
    New-Row 'Time'                          'time'                       'arnold:weight' '7:57 AM'      '07:57'       'parseClock to 24h'     'Match'
    New-Row 'Weight'                        'weightLbs'                  'arnold:weight' '190.5 lbs'    '190.5'       'num'                   'Match'
    New-Row '(computed)'                    'weightKg'                   'arnold:weight' '190.5 lbs'    '86.4'        '× 0.453592'            'Match'
    New-Row 'Change'                        'changeLbs'                  'arnold:weight' '-0.3 lbs'     '-0.3'        'num'                   'Match (a TRUE delta)'
    New-Row 'BMI'                           'bmi'                        'arnold:weight' '24.5'         '24.5'        'num'                   'Match'
    New-Row 'Body Fat %'                    'bodyFatPct'                 'arnold:weight' '17.8%'        '17.8'        'num, strips %'         'Match'
    New-Row 'Skeletal Muscle Mass'          'skeletalMuscleMassLbs / Kg' 'arnold:weight' '88.2 lbs'     '88.2 / 40.0' 'num + ×0.453592'       'Match'
    New-Row 'Bone Mass'                     'boneMassLbs'                'arnold:weight' '7.6 lbs'      '7.6'         'num'                   'Match'
    New-Row 'Body Water %'                  'bodyWaterPct'               'arnold:weight' '54.2%'        '54.2'        'num, strips %'         'Match'
)

$cronoRows = @(
    New-Row 'Date'              'date'         'arnold:cronometer' '2026-04-26' '2026-04-26' 'ISO'          'Match'
    New-Row 'Energy (kcal)'     'calories'     'arnold:cronometer' '1750 kcal'   '1750'      'int'           'Match'
    New-Row 'Protein (g)'       'protein'      'arnold:cronometer' '128 g'       '128'       'num'           'Match'
    New-Row 'Carbs (g)'         'carbs'        'arnold:cronometer' '210 g'       '210'       'num'           'Match'
    New-Row 'Net Carbs'         'netCarbs'     'arnold:cronometer' '180 g'       '180'       'num'           'Match'
    New-Row 'Fat (g)'           'fat'          'arnold:cronometer' '52 g'        '52'        'num'           'Match'
    New-Row 'Fiber (g)'         'fiber'        'arnold:cronometer' '32 g'        '32'        'num'           'Match'
    New-Row 'Sugars (g)'        'sugar'        'arnold:cronometer' '45 g'        '45'        'num'           'Match'
    New-Row 'Saturated Fat'     'saturatedFat' 'arnold:cronometer' '12 g'        '12'        'num'           'Match'
    New-Row 'Omega-3'           'omega3'       'arnold:cronometer' '1.4 g'       '1.4'       'num'           'Match'
    New-Row 'Alcohol'           'alcohol'      'arnold:cronometer' '0 g'         '0'         'num'           'Match'
    New-Row 'Caffeine'          'caffeine'     'arnold:cronometer' '180 mg'      '180'       'num'           'Match'
    New-Row 'Water (g)'         'water'        'arnold:cronometer' '2500 g'      '2.5'       'g → L (÷1000)' 'Match. NOTE: Cronometer reports water in grams; Arnold stores in liters.'
    New-Row 'Sodium (mg)'       'sodium'       'arnold:cronometer' '2100 mg'     '2100'      'int'           'Match'
    New-Row 'Potassium (mg)'    'potassium'    'arnold:cronometer' '3500 mg'     '3500'      'int'           'Match'
    New-Row 'Magnesium (mg)'    'magnesium'    'arnold:cronometer' '420 mg'      '420'       'int'           'Match'
    New-Row 'Calcium (mg)'      'calcium'      'arnold:cronometer' '1100 mg'     '1100'      'int'           'Match'
    New-Row 'Iron (mg)'         'iron'         'arnold:cronometer' '14 mg'       '14'        'num'           'Match'
    New-Row 'Vitamin D (IU)'    'vitaminD'     'arnold:cronometer' '600 IU'      '600'       'num'           'Match'
    New-Row 'Vitamin C (mg)'    'vitaminC'     'arnold:cronometer' '120 mg'      '120'       'num'           'Match'
    New-Row 'Vitamin A'         'vitaminA'     'arnold:cronometer' '900 µg'      '900'       'num'           'Match'
    New-Row 'B12 (Cobalamin)'   'vitaminB12'   'arnold:cronometer' '5 µg'        '5'         'num'           'Match'
    New-Row 'Folate'            'folate'       'arnold:cronometer' '450 µg'      '450'       'num'           'Match'
    New-Row 'Zinc (mg)'         'zinc'         'arnold:cronometer' '12 mg'       '12'        'num'           'Match'
    New-Row 'Cholesterol (mg)'  'cholesterol'  'arnold:cronometer' '320 mg'      '320'       'num'           'Match'
    New-Row 'Completed'         'completed'    'arnold:cronometer' 'Yes'         'true'      'bool'          'Match'
)

$hcRows = @(
    New-Row 'SleepSession.startTime / endTime'          'date / durationMinutes' 'arnold:sleep'         '2026-04-26T22:00 → 06:30'  '2026-04-26 / 510'  'ms duration / 60000' 'Match'
    New-Row 'SleepSession.stages[deep,rem,light,awake]' 'deepSleepMinutes / remSleepMinutes / lightSleepMinutes / awakeMinutes' 'arnold:sleep' '8400000 ms (deep)' '140 / etc' 'ms → min' 'Match'
    New-Row '(derived)'                                  'sleepScore'             'arnold:sleep'         'duration%, deep%, REM%, awake%' '78' 'DCY §8 formula' 'Match'
    New-Row 'WeightRecord.weightKg'                      'weightKg'               'arnold:weight'        '86.4 kg'                   '86.4'              'num, rounded'        'Match'
    New-Row '(derived)'                                  'weightLbs'              'arnold:weight'        '86.4 kg'                   '190.5'             '× 2.20462'           'Match'
    New-Row '(derived from profile.height)'              'bmi'                    'arnold:weight'        '86.4 kg + 1.83 m'          '25.8'              'kg / m^2'            'Match'
    New-Row 'HeartRateRecord.bpm (min per day)'          'restingHR'              'arnold:sleep (merged)' '46'                       '46'                'min(samples)'        'NOTE: HC restingHR uses MIN of samples across the day. If HC only has daytime samples, true sleeping RHR may be missed. Sleep CSV path captures it directly.'
    New-Row 'readSteps()'                                'steps'                  'arnold:hcDailyEnergy' '12500 steps'               '12500'             'int'                 'Match'
    New-Row 'readActiveCaloriesBurned()'                 'activeCalories'         'arnold:hcDailyEnergy' '480 kcal'                  '480'               'int'                 'Match'
    New-Row 'readTotalCaloriesBurned()'                  'totalCalories'          'arnold:hcDailyEnergy' '2820 kcal'                 '2820'              'int'                 'Match'
    New-Row '(noise filter)'                             'skipped row'            '—'                    'steps<100 AND total=0'     '(row dropped)'     'guard'               'INTENTIONAL: skips sedentary days with no data, but could mask edge cases like illness days when only BMR shows.'
)

$anomalyRows = @(
    [PSCustomObject]@{
        'Severity'   = 'HIGH'
        'Source'     = 'Garmin Sleep CSV'
        'Field'      = 'Body Battery Change'
        'Current Mapping' = '→ bodyBattery (arnold:sleep)'
        'What Happens' = 'Stores the OVERNIGHT DELTA (e.g. +35) as if it were a Body Battery score. UI tiles that read bodyBattery treat 35 as the "morning Body Battery" — which is wrong.'
        'Fix Recommendation' = 'Rename field to bodyBatteryChange and add a separate bodyBatteryMorning field if/when Garmin Connect Wellness sync provides the morning value. Until then, tiles consuming bodyBattery should label it "Body Battery overnight gain" not "Body Battery score".'
    }
    [PSCustomObject]@{
        'Severity'   = 'HIGH'
        'Source'     = 'Garmin Sleep CSV'
        'Field'      = 'Avg Overnight HRV (numeric)'
        'Current Mapping' = '→ hrvStatus (arnold:sleep)'
        'What Happens' = 'Parser stores 36 (numeric ms value) into a field named hrvStatus. Naming conflict: hrvStatus elsewhere holds qualitative labels like "Balanced". The numeric overnight HRV value should land in a separate overnightHRV field on arnold:sleep.'
        'Fix Recommendation' = 'Add overnightHRV field on arnold:sleep, populate from Avg Overnight HRV. Map "7d Avg HRV" qualitative label to hrvStatus. Two distinct find() calls instead of one.'
    }
    [PSCustomObject]@{
        'Severity'   = 'MEDIUM'
        'Source'     = 'Garmin Sleep CSV'
        'Field'      = '7d Avg HRV (Balanced/Low/Elevated)'
        'Current Mapping' = '(unmapped — dropped on import)'
        'What Happens' = 'find("hrv") returns first match (the numeric Avg Overnight HRV row), so the qualitative status row is never read. Status label silently lost.'
        'Fix Recommendation' = 'Same as above — split into overnightHRV (numeric) and hrvStatus (label).'
    }
    [PSCustomObject]@{
        'Severity'   = 'LOW'
        'Source'     = 'Garmin Sleep CSV'
        'Field'      = 'Avg Overnight Heart Rate'
        'Current Mapping' = '(unmapped)'
        'What Happens' = 'Captured by Garmin but never read by parser. Different from restingHR (which is the lowest sustained value).'
        'Fix Recommendation' = 'Add overnightHR field for users who want average sleep HR (different metric than RHR — useful for sleep-quality analysis).'
    }
    [PSCustomObject]@{
        'Severity'   = 'LOW'
        'Source'     = 'Garmin Sleep CSV'
        'Field'      = 'Stress Avg / Restless Moments / Lowest SpO2 / Lowest Respiration'
        'Current Mapping' = '(unmapped)'
        'What Happens' = 'Multiple metrics in the export are dropped on import.'
        'Fix Recommendation' = 'Optional additions if any tile in the registry needs them; until then, leaving them out is fine.'
    }
    [PSCustomObject]@{
        'Severity'   = 'INFO'
        'Source'     = 'HC Heart Rate sync'
        'Field'      = 'restingHR (derivation)'
        'Current Mapping' = 'min(HR samples for day)'
        'What Happens' = 'Approximates resting HR by taking the minimum of all HR samples HC has for that day. Works if HC includes overnight samples; can drift high if only daytime activity is recorded.'
        'Fix Recommendation' = 'Prefer Sleep CSV restingHR over HC-derived if both are available for the same date.'
    }
    [PSCustomObject]@{
        'Severity'   = 'INFO'
        'Source'     = 'HC Daily Energy noise filter'
        'Field'      = 'syncDailyEnergy() guard'
        'Current Mapping' = 'Skip rows where steps<100 AND totalCal==0'
        'What Happens' = 'Intentional dedup of empty days; could hide illness/rest days where only BMR is recorded.'
        'Fix Recommendation' = 'Loosen guard to "steps<100 AND no calories AND no HR samples" — i.e. treat as truly empty rather than just BMR-only.'
    }
    [PSCustomObject]@{
        'Severity'   = 'INFO'
        'Source'     = 'FIT bodyBatteryDrain'
        'Field'      = 'Naming overlap with arnold:sleep bodyBattery'
        'Current Mapping' = 'arnold:activities.bodyBatteryDrain (a delta)'
        'What Happens' = 'Both arnold:activities.bodyBatteryDrain and arnold:sleep.bodyBattery actually hold deltas, despite the latter being named without "Drain". Inconsistent naming makes it easy to misuse the sleep one.'
        'Fix Recommendation' = 'Rename arnold:sleep.bodyBattery → bodyBatteryChange to match the activities-side naming convention.'
    }
)

# ─── BUILD WORKBOOK VIA EXCEL COM ────────────────────────────────────────────

Write-Host 'Opening Excel...'
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Add()

# Remove default sheets
while ($wb.Worksheets.Count -gt 1) { $wb.Worksheets.Item(1).Delete() }

function Write-Sheet($name, $rows, $columns) {
    $sheet = $wb.Worksheets.Add()
    $sheet.Move([System.Reflection.Missing]::Value, $wb.Worksheets.Item($wb.Worksheets.Count))
    $sheet.Name = $name

    # Header
    for ($c = 0; $c -lt $columns.Count; $c++) {
        $sheet.Cells.Item(1, $c + 1) = $columns[$c]
    }
    $headerRange = $sheet.Range($sheet.Cells.Item(1, 1), $sheet.Cells.Item(1, $columns.Count))
    $headerRange.Font.Bold = $true
    $headerRange.Interior.Color = 3355443    # dark grey
    $headerRange.Font.Color = 16777215       # white

    # Data
    $r = 2
    foreach ($row in $rows) {
        for ($c = 0; $c -lt $columns.Count; $c++) {
            $v = $row.($columns[$c])
            $sheet.Cells.Item($r, $c + 1) = "$v"
        }
        $r++
    }

    # Format
    $usedRange = $sheet.UsedRange
    $usedRange.Font.Name = 'Arial'
    $usedRange.Font.Size = 10
    $usedRange.WrapText = $true
    $usedRange.VerticalAlignment = -4160   # xlTop
    $usedRange.EntireColumn.AutoFit()

    # Cap column width
    foreach ($col in $usedRange.Columns) {
        if ($col.ColumnWidth -gt 50) { $col.ColumnWidth = 50 }
    }

    # Freeze top row
    $sheet.Activate()
    $excel.ActiveWindow.SplitRow = 1
    $excel.ActiveWindow.FreezePanes = $true
}

$mainCols = @('Source Field', 'Arnold Field', 'Storage Key', 'Sample Source', 'Sample Arnold', 'Transform', 'Rationale / Notes')
$anomCols = @('Severity', 'Source', 'Field', 'Current Mapping', 'What Happens', 'Fix Recommendation')

Write-Host 'Building Anomalies sheet (read this first)...'
Write-Sheet 'Anomalies' $anomalyRows $anomCols

Write-Host 'Building Sleep CSV sheet...'
Write-Sheet 'Sleep (Garmin CSV)' $sleepRows $mainCols

Write-Host 'Building Activities CSV sheet...'
Write-Sheet 'Activities (Garmin CSV)' $activityRows $mainCols

Write-Host 'Building FIT sheet...'
Write-Sheet 'FIT (Garmin Binary)' $fitRows $mainCols

Write-Host 'Building HRV CSV sheet...'
Write-Sheet 'HRV (Garmin CSV)' $hrvRows $mainCols

Write-Host 'Building Weight CSV sheet...'
Write-Sheet 'Weight (Garmin CSV)' $weightRows $mainCols

Write-Host 'Building Cronometer sheet...'
Write-Sheet 'Cronometer' $cronoRows $mainCols

Write-Host 'Building Health Connect sheet...'
Write-Sheet 'Health Connect' $hcRows $mainCols

# Reorder so Anomalies is first
$wb.Worksheets.Item('Anomalies').Move($wb.Worksheets.Item(1))

# Save
Write-Host "Saving to $outPath..."
if (Test-Path $outPath) { Remove-Item $outPath -Force }
$wb.SaveAs($outPath, 51) # 51 = xlOpenXMLWorkbook (.xlsx)
$wb.Close($false)
$excel.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null

Write-Host "Done. Audit saved to: $outPath"
Write-Host "Open it and start with the Anomalies tab — that's where the bugs are."
