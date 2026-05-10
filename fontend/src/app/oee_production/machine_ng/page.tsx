"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);
import { useDashboardSocket } from "@/app/hooks/useDashboardSocket";
import config from "@/app/config";
import LoadingSpinner from "@/app/components/LoadingSpinner";

type CellValue = string | number | boolean | null | undefined;
type StationValues = Record<string, number>;
type NgDailyData = {
    has_production?: boolean;
    stations: StationValues;
    Machine_Output?: CellValue;
    Total_Output?: CellValue;
    All?: CellValue;
    Visual_NG?: CellValue;
};
type MachineNgReport = {
    machine_name: string;
    machine_type?: string;
    oee_mode?: string;
    model_info: {
        model_type?: string;
        model_name?: string;
        process_name?: string;
    };
    dailyData: Record<string, NgDailyData>;
    stations: string[];
    holidays?: string[];
};
type RealtimePayload = {
    shiftDate?: string;
    machines?: Record<string, { daily?: { totalOutput?: number; ngQty?: number } }>;
};
type RowDefinition = {
    label: string;
    key: string;
    isStation: boolean;
    showZero: boolean;
};

export default function MachineNgPage() {
    return (
        <Suspense fallback={<LoadingSpinner message="Loading Report..." />}>
            <MachineNgReportPage />
        </Suspense>
    );
}

function MachineNgReportPage() {
    const [areas, setAreas] = useState<string[]>([]);
    const [types, setTypes] = useState<string[]>([]);
    const [selectedMonth, setSelectedMonth] = useState(dayjs().format("YYYY-MM"));
    const [selectedArea, setSelectedArea] = useState("all");
    const [selectedType, setSelectedType] = useState("all");
    const [reportData, setReportData] = useState<MachineNgReport[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const init = async () => {
            const fetchedAreas = await fetchAreas();
            const initialArea = fetchedAreas[0] || "all";
            setSelectedArea(initialArea);
            const fetchedTypes = await fetchTypes(initialArea);
            const initialType = fetchedTypes[0] || "all";
            setSelectedType(initialType);
            await fetchReport(dayjs().format("YYYY-MM"), initialArea, initialType);
        };
        init();
    }, []);

    const handleRealtimeUpdate = useCallback((data: RealtimePayload) => {
        if (dayjs(selectedMonth).format("YYYY-MM") !== dayjs().format("YYYY-MM")) return;
        if (!data?.shiftDate || !data?.machines) return;
        const shiftDate = data.shiftDate;

        setReportData(prev => prev.map(machine => {
            const socketData = data.machines?.[machine.machine_name];
            if (!socketData?.daily) return machine;

            const updatedDailyData = { ...machine.dailyData };
            const existing = updatedDailyData[shiftDate] || { stations: {} };
            updatedDailyData[shiftDate] = {
                ...existing,
                has_production: true,
                Machine_Output: socketData.daily.totalOutput ?? existing.Machine_Output ?? 0,
                Total_Output: socketData.daily.totalOutput ?? existing.Total_Output ?? 0,
                Visual_NG: socketData.daily.ngQty ?? existing.Visual_NG ?? 0,
            };
            return { ...machine, oee_mode: "auto", dailyData: updatedDailyData };
        }));
    }, [selectedMonth]);

    const dashboardEvents = useMemo(() => [
        { event: "realtime_update", handler: handleRealtimeUpdate },
    ], [handleRealtimeUpdate]);
    const { socketConnected, serverTimeStr } = useDashboardSocket<RealtimePayload>({ events: dashboardEvents });

    const fetchAreas = async () => {
        try {
            const res = await axios.get<{ results: { machine_area: string }[] }>(`${config.apiServer}/api/machine/listArea`);
            const arr = res.data.results.map(row => row.machine_area);
            setAreas(arr);
            return arr;
        } catch (e) {
            console.error(e);
            return [];
        }
    };

    const fetchTypes = async (area: string) => {
        if (!area || area === "all") {
            setTypes([]);
            return [];
        }
        try {
            const res = await axios.get(`${config.apiServer}/api/machine/listType/${area}`);
            const arr = res.data.results || [];
            setTypes(arr);
            return arr;
        } catch (e) {
            console.error(e);
            return [];
        }
    };

    const fetchReport = async (month: string, area: string, type: string) => {
        setLoading(true);
        try {
            const res = await axios.get(`${config.apiServer}/api/report/machine-ng-report`, {
                params: { month, area, type },
            });
            setReportData((res.data.results || []).map((machine: MachineNgReport) => ({ ...machine, oee_mode: "auto" })));
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleAreaChange = async (area: string) => {
        setSelectedArea(area);
        localStorage.setItem("report_filter_area", area);
        const fetchedTypes = await fetchTypes(area);
        const nextType = fetchedTypes[0] || "all";
        setSelectedType(nextType);
        localStorage.setItem("report_filter_type", nextType);
        await fetchReport(selectedMonth, area, nextType);
    };

    const handleTypeChange = async (type: string) => {
        setSelectedType(type);
        localStorage.setItem("report_filter_type", type);
        await fetchReport(selectedMonth, selectedArea, type);
    };

    const handleMonthChange = async (month: string) => {
        setSelectedMonth(month);
        await fetchReport(month, selectedArea, selectedType);
    };

    const daysInMonth = dayjs(selectedMonth).daysInMonth();
    const daysArray = Array.from({ length: daysInMonth }, (_, index) => index + 1);
    const rowDefinitions = (stations: string[]): RowDefinition[] => [
        ...stations.map(station => ({ label: station, key: station, isStation: true, showZero: false })),
        { label: "Total Output", key: "Total_Output", isStation: false, showZero: true },
        { label: "NG Total (All Station)", key: "All", isStation: false, showZero: false },
        { label: "NG Qty", key: "Visual_NG", isStation: false, showZero: true },
    ];

    const isHoliday = (machine: MachineNgReport, day: number) => {
        const dateKey = `${selectedMonth}-${String(day).padStart(2, "0")}`;
        return machine.holidays?.includes(dateKey) || false;
    };

    const isFutureDay = (day: number) => dayjs(`${selectedMonth}-${String(day).padStart(2, "0")}`).isAfter(dayjs(), "day");

    const renderValue = (value: CellValue, showZero: boolean) => {
        if (value === undefined || value === null || value === "" || value === "-") return "-";
        const num = Number(value);
        if (!Number.isFinite(num)) return String(value);
        if (num === 0 && !showZero) return "-";
        return Number.isInteger(num) ? num.toLocaleString() : num.toFixed(2);
    };

    const getRowTotal = (dailyData: Record<string, NgDailyData>, row: RowDefinition) => {
        let total = 0;
        for (const data of Object.values(dailyData)) {
            const value = row.isStation ? data.stations?.[row.key] : data[row.key as keyof NgDailyData];
            const num = Number(value || 0);
            if (Number.isFinite(num)) total += num;
        }
        return total;
    };

    return (
        <div className="p-3">
            <div className="d-flex justify-content-between align-items-center mb-3">
                <div>
                    <h2 className="mb-1">Machine NG Report</h2>
                    <div className="text-muted small">NG is calculated automatically from machine data and updates in realtime.</div>
                </div>
                <div className="text-end small">
                    <div className={socketConnected ? "text-success" : "text-danger"}>{socketConnected ? "Realtime connected" : "Realtime disconnected"}</div>
                    <div className="text-muted">{serverTimeStr}</div>
                </div>
            </div>

            <div className="d-flex gap-2 mb-3">
                <input type="month" className="form-control" style={{ maxWidth: 180 }} value={selectedMonth} onChange={e => handleMonthChange(e.target.value)} />
                <select className="form-select" style={{ maxWidth: 220 }} value={selectedArea} onChange={e => handleAreaChange(e.target.value)}>
                    {areas.map(area => <option key={area} value={area}>{area}</option>)}
                </select>
                <select className="form-select" style={{ maxWidth: 220 }} value={selectedType} onChange={e => handleTypeChange(e.target.value)}>
                    <option value="all">All Types</option>
                    {types.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
                <button className="btn btn-outline-primary" onClick={() => fetchReport(selectedMonth, selectedArea, selectedType)}>
                    Refresh
                </button>
            </div>

            {loading ? (
                <LoadingSpinner />
            ) : (
                <div className="table-responsive" style={{ maxHeight: "calc(100vh - 210px)" }}>
                    <table className="table table-sm table-bordered align-middle text-center">
                        <thead className="table-light" style={{ position: "sticky", top: 0, zIndex: 5 }}>
                            <tr>
                                <th style={{ minWidth: 110 }}>Machine</th>
                                <th style={{ minWidth: 100 }}>Type</th>
                                <th style={{ minWidth: 180 }}>Model</th>
                                <th style={{ minWidth: 180 }}>Data</th>
                                {daysArray.map(day => <th key={day} style={{ minWidth: 60 }}>{day}</th>)}
                                <th style={{ minWidth: 90 }}>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {reportData.map(machine => {
                                const rows = rowDefinitions(machine.stations || []);
                                return rows.map((row, rowIndex) => (
                                    <tr key={`${machine.machine_name}-${row.key}`}>
                                        {rowIndex === 0 && (
                                            <>
                                                <td rowSpan={rows.length} className="fw-bold">{machine.machine_name}</td>
                                                <td rowSpan={rows.length}>{machine.machine_type || "-"}</td>
                                                <td rowSpan={rows.length}>{machine.model_info?.model_name || "-"}</td>
                                            </>
                                        )}
                                        <td className="text-start fw-semibold">{row.label}</td>
                                        {daysArray.map(day => {
                                            const dateKey = `${selectedMonth}-${String(day).padStart(2, "0")}`;
                                            const data = machine.dailyData[dateKey];
                                            const value: CellValue = row.isStation
                                                ? data?.stations?.[row.key]
                                                : data?.[row.key as "Machine_Output" | "Total_Output" | "All" | "Visual_NG"];
                                            const muted = isFutureDay(day) || isHoliday(machine, day) || !data?.has_production;
                                            return (
                                                <td key={`${machine.machine_name}-${row.key}-${day}`} className={muted ? "text-muted bg-light" : ""}>
                                                    {muted ? "-" : renderValue(value, row.showZero)}
                                                </td>
                                            );
                                        })}
                                        <td className="fw-bold table-warning">{renderValue(getRowTotal(machine.dailyData, row), row.showZero)}</td>
                                    </tr>
                                ));
                            })}
                            {reportData.length === 0 && (
                                <tr>
                                    <td colSpan={daysArray.length + 5} className="text-muted py-4">No Data</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
