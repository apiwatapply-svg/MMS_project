param(
  [string]$From = "2026-05-05",
  [string]$To = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$connectionString = "Server=localhost,1433;Database=db_oee;User ID=sa;Password=sa@admin;Encrypt=False;TrustServerCertificate=True;"
$hours = @("07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22","23","00","01","02","03","04","05","06")
$typeCt = @{
  "AHV" = 4.2; "ABR" = 3.5; "ACP" = 4.1; "ACR" = 5.0; "DLC" = 6.4
  "GE2" = 3.4; "GE3" = 3.8; "HEL" = 4.0; "LSW" = 4.7; "VNS" = 5.8
  "ACI" = 4.6; "AIU" = 4.9; "AOC" = 4.3; "ART" = 4.5; "ATX" = 5.1
}
$modelByType = @{
  "AHV" = "Dorado 10D"; "ABR" = "V4G"; "ACP" = "Sierra 8D"; "ACR" = "Orion 7D"
  "DLC" = "Delta 4D"; "GE2" = "Helios 9D"; "GE3" = "Helios 9D"; "HEL" = "Nova 6D"
  "LSW" = "Luna 5D"; "VNS" = "Vega 11D"
}

function Open-Db {
  $conn = New-Object System.Data.SqlClient.SqlConnection($connectionString)
  $conn.Open()
  return $conn
}

function New-Cmd($conn, $sql, $tx = $null) {
  $cmd = $conn.CreateCommand()
  $cmd.CommandTimeout = 240
  $cmd.CommandText = $sql
  if ($tx) { $cmd.Transaction = $tx }
  return $cmd
}

function Add-Param($cmd, $name, $value) {
  if ($null -eq $value) {
    $param = $cmd.Parameters.Add($name, [System.Data.SqlDbType]::NVarChar)
    $param.Value = [DBNull]::Value
    return
  }
  if ($value -is [int]) {
    $param = $cmd.Parameters.Add($name, [System.Data.SqlDbType]::Int)
  } elseif ($value -is [long]) {
    $param = $cmd.Parameters.Add($name, [System.Data.SqlDbType]::BigInt)
  } elseif ($value -is [double] -or $value -is [decimal] -or $value -is [float]) {
    $param = $cmd.Parameters.Add($name, [System.Data.SqlDbType]::Float)
  } elseif ($value -is [datetime]) {
    $param = $cmd.Parameters.Add($name, [System.Data.SqlDbType]::DateTime)
  } else {
    $param = $cmd.Parameters.Add($name, [System.Data.SqlDbType]::NVarChar, 4000)
  }
  $param.Value = $value
}

function Exec-NonQuery($conn, $sql, $params = @{}, $tx = $null) {
  $cmd = New-Cmd $conn $sql $tx
  foreach ($key in $params.Keys) { Add-Param $cmd "@$key" $params[$key] }
  [void]$cmd.ExecuteNonQuery()
}

function Exec-Scalar($conn, $sql, $params = @{}, $tx = $null) {
  $cmd = New-Cmd $conn $sql $tx
  foreach ($key in $params.Keys) { Add-Param $cmd "@$key" $params[$key] }
  return $cmd.ExecuteScalar()
}

function Exec-Table($conn, $sql, $params = @{}) {
  $cmd = New-Cmd $conn $sql
  foreach ($key in $params.Keys) { Add-Param $cmd "@$key" $params[$key] }
  $adapter = New-Object System.Data.SqlClient.SqlDataAdapter($cmd)
  $table = New-Object System.Data.DataTable
  [void]$adapter.Fill($table)
  return ,$table
}

function Date-Only([datetime]$date) {
  return [datetime]::SpecifyKind($date.Date, [System.DateTimeKind]::Unspecified)
}

function Hour-DateTime([datetime]$date, [string]$hour) {
  $h = [int]$hour
  $day = Date-Only $date
  if ($h -lt 7) { $day = $day.AddDays(1) }
  return $day.AddHours($h)
}

function Active-Hours([datetime]$date, [datetime]$thaiNow) {
  $dateOnly = Date-Only $date
  if ($dateOnly -lt (Date-Only $thaiNow)) { return $hours }
  $active = @()
  foreach ($hour in $hours) {
    if ((Hour-DateTime $dateOnly $hour) -le $thaiNow) { $active += $hour }
  }
  return $active
}

function Ideal-Ct($machineType, $index) {
  if ($typeCt.ContainsKey($machineType)) { return [double]$typeCt[$machineType] }
  return [math]::Round(3.8 + (($index % 8) * 0.35), 2)
}

function Model-Name($machineType) {
  if ($modelByType.ContainsKey($machineType)) { return $modelByType[$machineType] }
  return "$machineType model"
}

function Hour-Column-Sql($prefix, $values) {
  ($hours | ForEach-Object { "[$prefix`_$_] = @${prefix}_$_" }) -join ", "
}

function Build-Profile($machine, [int]$machineIndex, [int]$dayIndex, $activeHours) {
  $idealCt = Ideal-Ct $machine.machine_type $machineIndex
  $effTarget = 88 + ($machineIndex % 7)
  $availabilityBase = 86 + ($machineIndex % 10)
  $performanceBase = 88 + ($machineIndex % 9)
  $qualityBase = 98.6 - (($machineIndex % 5) * 0.25)
  $target = @{}; $actual = @{}; $cycle = @{}; $eff = @{}; $avail = @{}; $runtime = @{}; $excluded = @{}; $ng = @{}

  for ($i = 0; $i -lt $hours.Count; $i++) {
    $hour = $hours[$i]
    $isActive = $activeHours -contains $hour
    $wave = (($dayIndex + $i + $machineIndex) % 7) - 3
    $plannedStopMin = if ($isActive -and ($i -eq 4 -or $i -eq 12)) { 10 } else { 0 }
    $minorStopMin = if ($isActive -and (($i + $machineIndex + $dayIndex) % 13 -eq 0)) { 7 } else { 0 }
    $excludedMin = $plannedStopMin + $minorStopMin
    $operatingSec = if ($isActive) { [math]::Max(0, 3600 - ($excludedMin * 60)) } else { 0 }
    $targetVal = if ($isActive) { [math]::Floor(($operatingSec / $idealCt) * ($effTarget / 100.0)) } else { 0 }
    $availability = if ($isActive) { [math]::Max(62, [math]::Min(99, $availabilityBase + ($wave * 1.25))) } else { 0 }
    $performance = if ($isActive) { [math]::Max(60, [math]::Min(112, $performanceBase + ($wave * 1.1))) } else { 0 }
    $runtimeSec = $operatingSec * ($availability / 100.0)
    $output = if ($isActive) { [math]::Floor(($runtimeSec / $idealCt) * ($performance / 100.0)) } else { 0 }
    $quality = if ($isActive) { [math]::Max(95, [math]::Min(99.8, $qualityBase - ([math]::Max(0, $wave) * 0.18))) } else { 0 }
    $ngVal = if ($output -gt 0) { [math]::Min($output, [math]::Round($output * (1 - ($quality / 100.0)))) } else { 0 }
    $actualCt = if ($output -gt 0 -and $runtimeSec -gt 0) { $runtimeSec / $output } else { $idealCt }

    $target[$hour] = [int]$targetVal
    $actual[$hour] = [int]$output
    $cycle[$hour] = [math]::Round($actualCt, 2)
    $eff[$hour] = [math]::Round($performance, 2)
    $avail[$hour] = [math]::Round($availability, 2)
    $runtime[$hour] = [math]::Round($runtimeSec / 60.0, 2)
    $excluded[$hour] = [math]::Round($excludedMin, 2)
    $ng[$hour] = [int]$ngVal
  }

  $targetTotal = ($hours | ForEach-Object { $target[$_] } | Measure-Object -Sum).Sum
  $actualTotal = ($hours | ForEach-Object { $actual[$_] } | Measure-Object -Sum).Sum
  $ngTotal = ($hours | ForEach-Object { $ng[$_] } | Measure-Object -Sum).Sum
  $ok = [math]::Max(0, $actualTotal - $ngTotal)
  $activeCount = [math]::Max(1, $activeHours.Count)
  $avgCt = [math]::Round((($hours | Where-Object { $actual[$_] -gt 0 } | ForEach-Object { $cycle[$_] } | Measure-Object -Average).Average), 2)
  if ([double]::IsNaN($avgCt)) { $avgCt = $idealCt }
  $avgEff = [math]::Round((($hours | Where-Object { $eff[$_] -gt 0 } | ForEach-Object { $eff[$_] } | Measure-Object -Average).Average), 2)
  $avgAvail = [math]::Round((($hours | Where-Object { $avail[$_] -gt 0 } | ForEach-Object { $avail[$_] } | Measure-Object -Average).Average), 2)
  $qualityActual = if ($actualTotal -gt 0) { [math]::Round(($ok / $actualTotal) * 100.0, 2) } else { 0 }
  $oee = [math]::Round(($avgAvail * $avgEff * $qualityActual) / 10000.0, 2)

  return @{
    target = $target; actual = $actual; cycle = $cycle; eff = $eff; avail = $avail; runtime = $runtime; excluded = $excluded; ng = $ng
    targetTotal = [int]$targetTotal; actualTotal = [int]$actualTotal; ngTotal = [int]$ngTotal
    avgCt = [double]$avgCt; avgEff = [double]$avgEff; avgAvail = [double]$avgAvail; quality = [double]$qualityActual; oee = [double]$oee
    effTarget = [double]$effTarget; activeHourCount = [int]$activeCount; idealCt = [double]$idealCt
  }
}

function Add-Hour-Params($params, $prefix, $values) {
  foreach ($hour in $hours) { $params["${prefix}_$hour"] = $values[$hour] }
}

function Upsert-Hourly($conn, $table, $keyWhere, $insertColumns, $updateSql, $params, $tx) {
  $columns = ($insertColumns | ForEach-Object { "[$_]" }) -join ", "
  $values = ($insertColumns | ForEach-Object { "@$_" }) -join ", "
  $sql = @"
IF EXISTS (SELECT 1 FROM [$table] WHERE $keyWhere)
BEGIN
  UPDATE [$table] SET $updateSql WHERE $keyWhere;
END
ELSE
BEGIN
  INSERT INTO [$table] ($columns) VALUES ($values);
END
"@
  Exec-NonQuery $conn $sql $params $tx
}

function Ensure-Master($conn, $tx) {
  for ($i = 1; $i -le 20; $i++) {
    $emp = "OP{0:D3}" -f $i
    Exec-NonQuery $conn "IF NOT EXISTS (SELECT 1 FROM tbm_operator WHERE emp_no=@emp_no) INSERT INTO tbm_operator (operator_name, emp_no, picture_path, status) VALUES (@name, @emp_no, @pic, 'active');" @{
      emp_no = $emp; name = "Demo Operator $i"; pic = "/image/operator/demo-$i.png"
    } $tx
  }
}

function Ensure-Machine-Master($conn, $tx, $machine) {
  $model = Model-Name $machine.machine_type
  Exec-NonQuery $conn "IF NOT EXISTS (SELECT 1 FROM tbm_model WHERE model_name=@model) INSERT INTO tbm_model (model_name, status) VALUES (@model, 'active');" @{ model = $model } $tx
  Exec-NonQuery $conn "IF NOT EXISTS (SELECT 1 FROM tbm_model_type WHERE model_type=@type) INSERT INTO tbm_model_type (model_type, status) VALUES (@type, 'active');" @{ type = $machine.machine_type } $tx
  Exec-NonQuery $conn "IF NOT EXISTS (SELECT 1 FROM tbm_process WHERE machine_type=@type AND process_name=@process) INSERT INTO tbm_process (machine_type, process_name, status) VALUES (@type, @process, 'active');" @{ type = $machine.machine_type; process = $machine.full_machine_type } $tx
  Exec-NonQuery $conn "IF NOT EXISTS (SELECT 1 FROM tb_machine_plan_config WHERE machine_name=@machine_name) INSERT INTO tb_machine_plan_config (machine_name, eff_target, cycle_time_target, process_name, model_name, model_type, active_hours, oee_mode) VALUES (@machine_name, @eff, @ct, @process, @model, @type, @active_hours, 'auto');" @{
    machine_name = $machine.machine_name; eff = 90.0; ct = (Ideal-Ct $machine.machine_type 0); process = $machine.full_machine_type; model = $model; type = $machine.machine_type; active_hours = ($hours -join ",")
  } $tx
  for ($s = 1; $s -le 5; $s++) {
    Exec-NonQuery $conn "IF NOT EXISTS (SELECT 1 FROM tbm_machine_station WHERE machine_name=@machine_name AND station_number=@station_number) INSERT INTO tbm_machine_station (machine_name, ng_id, station_number, station_name, status, created_at, updated_at) VALUES (@machine_name, @station_number, @station_number, @station_name, 'active', GETDATE(), GETDATE());" @{
      machine_name = $machine.machine_name; station_number = $s; station_name = "Station $s"
    } $tx
  }
}

function Seed-Machine-Day($conn, $tx, $machine, [datetime]$date, [int]$dayIndex, [int]$machineIndex, [datetime]$thaiNow) {
  $activeHours = Active-Hours $date $thaiNow
  $profile = Build-Profile $machine $machineIndex $dayIndex $activeHours
  $model = Model-Name $machine.machine_type
  $dateOnly = Date-Only $date
  $baseParams = @{ date = $dateOnly; machine_name = $machine.machine_name; model_name = $model }

  $targetParams = @{} + $baseParams
  $targetParams.pc_target = $profile.targetTotal
  $targetParams.cycle_time_target = $profile.idealCt
  $targetParams.eff_target = $profile.effTarget
  $targetParams.accum_target = $profile.targetTotal
  $targetParams.model_type = $machine.machine_type
  $targetParams.process_name = $machine.full_machine_type
  Add-Hour-Params $targetParams "target" $profile.target
  Upsert-Hourly $conn "tb_output_target" "date=@date AND machine_name=@machine_name AND model_name=@model_name" (@("date","machine_name","model_name","pc_target","cycle_time_target","eff_target","accum_target","model_type","process_name") + ($hours | ForEach-Object { "target_$_" })) "pc_target=@pc_target, cycle_time_target=@cycle_time_target, eff_target=@eff_target, accum_target=@accum_target, model_type=@model_type, process_name=@process_name, $(Hour-Column-Sql 'target' $profile.target)" $targetParams $tx

  $actualParams = @{} + $baseParams
  $actualParams.Overall = $profile.actualTotal
  Add-Hour-Params $actualParams "actual" $profile.actual
  Upsert-Hourly $conn "tb_output_actual" "date=@date AND machine_name=@machine_name AND model_name=@model_name" (@("date","machine_name","model_name","Overall") + ($hours | ForEach-Object { "actual_$_" })) "Overall=@Overall, $(Hour-Column-Sql 'actual' $profile.actual)" $actualParams $tx

  $cycleParams = @{ date = $dateOnly; machine_name = $machine.machine_name; cycle_time = $profile.avgCt }
  Add-Hour-Params $cycleParams "cycle" $profile.cycle
  Upsert-Hourly $conn "tb_cycle_time_actual" "date=@date AND machine_name=@machine_name" (@("date","machine_name","cycle_time") + ($hours | ForEach-Object { "cycle_$_" })) "cycle_time=@cycle_time, $(Hour-Column-Sql 'cycle' $profile.cycle)" $cycleParams $tx

  $effParams = @{ date = $dateOnly; machine_name = $machine.machine_name; eff_actual = $profile.avgEff }
  Add-Hour-Params $effParams "eff" $profile.eff
  Upsert-Hourly $conn "tb_efficiency_actual" "date=@date AND machine_name=@machine_name" (@("date","machine_name","eff_actual") + ($hours | ForEach-Object { "eff_$_" })) "eff_actual=@eff_actual, $(Hour-Column-Sql 'eff' $profile.eff)" $effParams $tx

  $availParams = @{ date = $dateOnly; machine_name = $machine.machine_name; avail_actual = $profile.avgAvail }
  Add-Hour-Params $availParams "avail" $profile.avail
  Upsert-Hourly $conn "tb_availability_actual" "date=@date AND machine_name=@machine_name" (@("date","machine_name","avail_actual") + ($hours | ForEach-Object { "avail_$_" })) "avail_actual=@avail_actual, $(Hour-Column-Sql 'avail' $profile.avail)" $availParams $tx

  $runtimeParams = @{ date = $dateOnly; machine_name = $machine.machine_name; runtime_total = (($hours | ForEach-Object { $profile.runtime[$_] } | Measure-Object -Sum).Sum); excluded_total = (($hours | ForEach-Object { $profile.excluded[$_] } | Measure-Object -Sum).Sum) }
  Add-Hour-Params $runtimeParams "runtime" $profile.runtime
  Add-Hour-Params $runtimeParams "excluded" $profile.excluded
  Upsert-Hourly $conn "tb_mc_runtime_hourly" "date=@date AND machine_name=@machine_name" (@("date","machine_name","runtime_total","excluded_total") + ($hours | ForEach-Object { "runtime_$_" }) + ($hours | ForEach-Object { "excluded_$_" })) "runtime_total=@runtime_total, excluded_total=@excluded_total, $(Hour-Column-Sql 'runtime' $profile.runtime), $(Hour-Column-Sql 'excluded' $profile.excluded)" $runtimeParams $tx

  Exec-NonQuery $conn @"
IF EXISTS (SELECT 1 FROM tb_oee WHERE date=@date AND machine_name=@machine_name)
  UPDATE tb_oee SET availability=@availability, performance=@performance, quality=@quality, oee_value=@oee_value, ng_qty=@ng_qty WHERE date=@date AND machine_name=@machine_name;
ELSE
  INSERT INTO tb_oee (date, machine_name, availability, performance, quality, oee_value, ng_qty) VALUES (@date, @machine_name, @availability, @performance, @quality, @oee_value, @ng_qty);
"@ @{ date = $dateOnly; machine_name = $machine.machine_name; availability = $profile.avgAvail; performance = $profile.avgEff; quality = $profile.quality; oee_value = $profile.oee; ng_qty = $profile.ngTotal } $tx

  $stationId = Exec-Scalar $conn "SELECT TOP 1 id FROM tbm_machine_station WHERE machine_name=@machine_name AND status='active' ORDER BY station_number" @{ machine_name = $machine.machine_name } $tx
  if ($stationId) {
    $ngParams = @{ date = $dateOnly; machine_name = $machine.machine_name; station_id = [int]$stationId; Overall_ng = $profile.ngTotal }
    Add-Hour-Params $ngParams "ng" $profile.ng
    Upsert-Hourly $conn "tb_machine_ng" "date=@date AND machine_name=@machine_name AND station_id=@station_id" (@("date","machine_name","station_id","Overall_ng") + ($hours | ForEach-Object { "ng_$_" })) "Overall_ng=@Overall_ng, $(Hour-Column-Sql 'ng' $profile.ng)" $ngParams $tx
  }

  foreach ($shift in @("A","B","C")) {
    $shiftStartHour = if ($shift -eq "A") { 7 } elseif ($shift -eq "B") { 15 } else { 23 }
    $startTime = (Date-Only $date).AddHours($shiftStartHour)
    if ($shift -eq "C") { $endTime = (Date-Only $date).AddDays(1).AddHours(7) } else { $endTime = $startTime.AddHours(8) }
    if ($startTime -gt $thaiNow) { continue }
    if ($endTime -gt $thaiNow) { $endTime = $thaiNow }
    $emp = "OP{0:D3}" -f ((($machineIndex + [int][char]$shift[0]) % 20) + 1)
    Exec-NonQuery $conn "DELETE FROM tb_history_working WHERE date=@date AND machine_name=@machine_name AND shift=@shift; INSERT INTO tb_history_working (date, machine_name, emp_no, shift, start_time, end_time) VALUES (@date, @machine_name, @emp_no, @shift, @start_time, @end_time);" @{
      date = $dateOnly; machine_name = $machine.machine_name; emp_no = $emp; shift = $shift; start_time = $startTime; end_time = $endTime
    } $tx
  }

  $start = $dateOnly
  $end = $dateOnly.AddDays(1)
  Exec-NonQuery $conn "DELETE FROM tb_MCStatus WHERE MC=@machine_name AND Datetime >= @start AND Datetime < @end AND Remark='portfolio_seed'; DELETE FROM tb_MCAlarm WHERE MC=@machine_name AND Datetime >= @start AND Datetime < @end;" @{ machine_name = $machine.machine_name; start = $start; end = $end } $tx
  $statusRows = @(
    @{ time = "07:00"; status = "Run_Time" },
    @{ time = "10:50"; status = "Plan_Stop" },
    @{ time = "11:00"; status = "Run_Time" },
    @{ time = "14:30"; status = if ((($machineIndex + $dayIndex) % 10) -eq 0) { "MC_Alarm" } else { "Run_Time" } },
    @{ time = "14:45"; status = "Run_Time" },
    @{ time = "19:00"; status = "Break_Time" },
    @{ time = "19:10"; status = "Run_Time" },
    @{ time = "23:00"; status = "Plan_Stop" }
  )
  foreach ($row in $statusRows) {
    $parts = $row.time.Split(":")
    $dt = $dateOnly.AddHours([int]$parts[0]).AddMinutes([int]$parts[1])
    if ($dt -gt $thaiNow) { continue }
    Exec-NonQuery $conn "INSERT INTO tb_MCStatus (Datetime, MC, MCStatus, UTC_Time, Remark) VALUES (@dt, @machine_name, @status, @dt, 'portfolio_seed');" @{ dt = $dt; machine_name = $machine.machine_name; status = $row.status } $tx
    if ($row.status -eq "MC_Alarm") {
      Exec-NonQuery $conn "INSERT INTO tb_MCAlarm (Datetime, MC, MCAlarm, UTC_Time) VALUES (@dt, @machine_name, @alarm, @dt);" @{ dt = $dt; machine_name = $machine.machine_name; alarm = "Portfolio seed: pressure/vacuum check required" } $tx
    }
  }
}

$conn = Open-Db
try {
  $thaiNow = [datetime]::UtcNow.AddHours(7)
  $toDate = if ($To) { [datetime]::Parse($To) } else { Date-Only $thaiNow }
  $fromDate = [datetime]::Parse($From)
  $machines = Exec-Table $conn "SELECT machine_area, machine_type, machine_name, status, ISNULL(full_machine_type, machine_type) AS full_machine_type FROM tbm_machine WHERE status='active' ORDER BY machine_area, machine_type, machine_name"
  Write-Output "Portfolio MSSQL seed range: $($fromDate.ToString('yyyy-MM-dd'))..$($toDate.ToString('yyyy-MM-dd')) | machines=$($machines.Rows.Count) | nowTH=$($thaiNow.ToString('yyyy-MM-dd HH:mm:ss'))"
  if ($DryRun) { return }

  $tx = $conn.BeginTransaction()
  try {
    Ensure-Master $conn $tx
    Exec-NonQuery $conn "DELETE FROM tb_machine_holiday WHERE holiday_date >= @from AND holiday_date <= @to;" @{ from = $fromDate; to = $toDate } $tx
    $dayIndex = 0
    for ($date = Date-Only $fromDate; $date -le (Date-Only $toDate); $date = $date.AddDays(1)) {
      for ($machineIndex = 0; $machineIndex -lt $machines.Rows.Count; $machineIndex += 1) {
        $machine = $machines.Rows.Item($machineIndex)
        $machineObj = [pscustomobject]@{
          machine_area = [string]$machine.Item("machine_area")
          machine_type = [string]$machine.Item("machine_type")
          machine_name = [string]$machine.Item("machine_name")
          status = [string]$machine.Item("status")
          full_machine_type = [string]$machine.Item("full_machine_type")
        }
        Ensure-Machine-Master $conn $tx $machineObj
        Seed-Machine-Day $conn $tx $machineObj $date $dayIndex $machineIndex $thaiNow
      }
      Write-Output "Seeded $($date.ToString('yyyy-MM-dd'))"
      $dayIndex += 1
    }
    Exec-NonQuery $conn "DELETE FROM tb_MCStatus WHERE UTC_Time > SYSUTCDATETIME(); DELETE FROM tb_MCAlarm WHERE UTC_Time > SYSUTCDATETIME();" @{} $tx
    $tx.Commit()
  } catch {
    $tx.Rollback()
    throw
  }

  $summary = Exec-Table $conn @"
SELECT 'tb_output_target' AS table_name, COUNT(*) AS rows_count FROM tb_output_target WHERE date >= @from AND date <= @to
UNION ALL SELECT 'tb_output_actual', COUNT(*) FROM tb_output_actual WHERE date >= @from AND date <= @to
UNION ALL SELECT 'tb_cycle_time_actual', COUNT(*) FROM tb_cycle_time_actual WHERE date >= @from AND date <= @to
UNION ALL SELECT 'tb_efficiency_actual', COUNT(*) FROM tb_efficiency_actual WHERE date >= @from AND date <= @to
UNION ALL SELECT 'tb_availability_actual', COUNT(*) FROM tb_availability_actual WHERE date >= @from AND date <= @to
UNION ALL SELECT 'tb_mc_runtime_hourly', COUNT(*) FROM tb_mc_runtime_hourly WHERE date >= @from AND date <= @to
UNION ALL SELECT 'tb_oee', COUNT(*) FROM tb_oee WHERE date >= @from AND date <= @to
UNION ALL SELECT 'tb_machine_ng', COUNT(*) FROM tb_machine_ng WHERE date >= @from AND date <= @to
UNION ALL SELECT 'tb_history_working', COUNT(*) FROM tb_history_working WHERE date >= @from AND date <= @to
UNION ALL SELECT 'tb_MCStatus', COUNT(*) FROM tb_MCStatus WHERE Datetime >= @from AND Datetime < DATEADD(day, 1, @to)
UNION ALL SELECT 'tb_MCAlarm', COUNT(*) FROM tb_MCAlarm WHERE Datetime >= @from AND Datetime < DATEADD(day, 1, @to);
"@ @{ from = $fromDate; to = $toDate }
  $summary | Format-Table -AutoSize
} finally {
  $conn.Close()
}
