"use client";

import { Suspense, useEffect, useState } from "react";
import axios from "axios";
import config from "@/app/config";
import { getSocket } from "@/app/lib/socketManager";
import LoadingSpinner from "@/app/components/LoadingSpinner";

type MachineOee = {
    machine_name: string;
    machine_type?: string;
    oee_mode?: string;
    total_output?: number;
    ng_qty?: number;
    availability?: number;
    performance?: number;
    quality?: number;
    oee_value?: number;
    display_date?: string;
};

export default function Page() {
    return (
        <Suspense fallback={<LoadingSpinner message="Loading..." />}>
            <UpdateOeePage />
        </Suspense>
    );
}

function UpdateOeePage() {
    const [areas, setAreas] = useState<string[]>([]);
    const [types, setTypes] = useState<string[]>([]);
    const [selectedArea, setSelectedArea] = useState(() => {
        if (typeof window !== "undefined") return localStorage.getItem("updateOee_area") || "all";
        return "all";
    });
    const [selectedType, setSelectedType] = useState(() => {
        if (typeof window !== "undefined") return localStorage.getItem("updateOee_type") || "all";
        return "all";
    });
    const [machines, setMachines] = useState<MachineOee[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchAreas();
    }, []);

    useEffect(() => {
        if (selectedArea !== "all") fetchTypes(selectedArea);
    }, []);

    useEffect(() => {
        if (selectedArea !== "all") fetchData();
        else setMachines([]);
    }, [selectedArea, selectedType]);

    useEffect(() => {
        const socket = getSocket();
        const handler = (data: any) => {
            if (!data?.machines) return;
            setMachines(prev => prev.map(machine => {
                const rt = data.machines[machine.machine_name];
                if (!rt?.daily) return machine;
                return {
                    ...machine,
                    oee_mode: "auto",
                    ng_qty: rt.daily.ngQty ?? machine.ng_qty,
                    quality: rt.daily.quality ?? machine.quality,
                    availability: rt.daily.availability ?? machine.availability,
                    performance: rt.daily.performance ?? machine.performance,
                    oee_value: rt.daily.oee ?? machine.oee_value,
                    total_output: rt.daily.totalOutput ?? machine.total_output,
                };
            }));
        };
        socket.on("realtime_update", handler);
        return () => { socket.off("realtime_update", handler); };
    }, []);

    const fetchAreas = async () => {
        try {
            const res = await axios.get(`${config.apiServer}/api/machine/listArea`);
            setAreas(res.data.results.map((x: any) => x.machine_area));
        } catch (e) {
            console.error(e);
        }
    };

    const fetchTypes = async (area: string) => {
        if (area === "all") {
            setTypes([]);
            return;
        }
        try {
            const res = await axios.get(`${config.apiServer}/api/machine/listType/${area}`);
            setTypes(res.data.results || []);
        } catch (e) {
            console.error(e);
        }
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${config.apiServer}/api/oee-update/list`, {
                params: { area: selectedArea, type: selectedType },
            });
            setMachines((res.data.results || []).map((m: MachineOee) => ({ ...m, oee_mode: "auto" })));
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleAreaChange = async (area: string) => {
        setSelectedArea(area);
        setSelectedType("all");
        localStorage.setItem("updateOee_area", area);
        localStorage.setItem("updateOee_type", "all");
        await fetchTypes(area);
    };

    const formatNumber = (value?: number, digits = 2) => {
        const num = Number(value || 0);
        return Number.isFinite(num) ? num.toFixed(digits) : "0.00";
    };

    return (
        <div className="card mt-3">
            <div className="card-header position-relative fs-2 text-dark"
                style={{ background: "linear-gradient(90deg, #f8f9fa 0%, #ffffff 100%)", borderBottom: "1px solid #e0e0e0", fontWeight: 600, fontSize: "1.8rem" }}>
                <div className="d-flex align-items-center gap-2">
                    <i className="fa fa-sync-alt fs-4 text-primary"></i>
                    <span>Auto OEE / NG Monitor</span>
                </div>
            </div>

            <div className="card-body">
                <div className="d-flex gap-3 align-items-end mb-3">
                    <div style={{ flex: 1 }}>
                        <div className="fs-5 mb-1">Select Area</div>
                        <select className="form-select" value={selectedArea} onChange={e => handleAreaChange(e.target.value)}>
                            <option value="all">-- Select Area --</option>
                            {areas.map(area => <option key={area}>{area}</option>)}
                        </select>
                    </div>
                    <div style={{ flex: 1 }}>
                        <div className="fs-5 mb-1">Select Type</div>
                        <select className="form-select" value={selectedType} onChange={e => {
                            setSelectedType(e.target.value);
                            localStorage.setItem("updateOee_type", e.target.value);
                        }}>
                            <option value="all">-- All Types --</option>
                            {types.map(type => <option key={type}>{type}</option>)}
                        </select>
                    </div>
                    <button className="btn btn-outline-primary btn-sm px-3" onClick={fetchData} disabled={loading}
                        style={{ whiteSpace: "nowrap", height: "38px" }}>
                        <i className={`fa ${loading ? "fa-spinner fa-spin" : "fa-refresh"} me-1`}></i>Refresh
                    </button>
                </div>

                {selectedArea === "all" ? (
                    <div className="text-center py-5 text-muted">
                        <i className="fa fa-hand-pointer" style={{ fontSize: "2.5rem", opacity: 0.4 }}></i>
                        <p className="mt-3">Select Area to view auto OEE / NG values</p>
                    </div>
                ) : loading ? (
                    <LoadingSpinner />
                ) : (
                    <div className="rounded-3 shadow-sm" style={{ background: "#fff", border: "1px solid #e0e0e0", overflow: "hidden" }}>
                        <div className="table-responsive">
                            <table className="table table-hover align-middle mb-0" style={{ fontSize: "0.88rem" }}>
                                <thead>
                                    <tr style={{ background: "linear-gradient(90deg, #f8f9fa, #fff)", borderBottom: "2px solid #e0e0e0" }}>
                                        <th style={{ width: "40px" }}>#</th>
                                        <th>Machine</th>
                                        <th>Type</th>
                                        <th className="text-center">Mode</th>
                                        <th className="text-end">Output</th>
                                        <th className="text-end">NG</th>
                                        <th className="text-end">A %</th>
                                        <th className="text-end">P %</th>
                                        <th className="text-end">Q %</th>
                                        <th className="text-end">OEE %</th>
                                        <th className="text-center">Date</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {machines.map((machine, index) => (
                                        <tr key={machine.machine_name}>
                                            <td className="text-muted">{index + 1}</td>
                                            <td className="fw-bold">{machine.machine_name}</td>
                                            <td className="text-muted">{machine.machine_type}</td>
                                            <td className="text-center">
                                                <span className="badge bg-success" style={{ fontSize: "0.75rem" }}>Auto</span>
                                            </td>
                                            <td className="text-end">{Number(machine.total_output || 0).toLocaleString()}</td>
                                            <td className="text-end">{Number(machine.ng_qty || 0).toLocaleString()}</td>
                                            <td className="text-end">{formatNumber(machine.availability)}</td>
                                            <td className="text-end">{formatNumber(machine.performance)}</td>
                                            <td className="text-end">{formatNumber(machine.quality)}</td>
                                            <td className="text-end fw-bold">{formatNumber(machine.oee_value)}</td>
                                            <td className="text-center text-muted">{machine.display_date || "-"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="d-flex justify-content-between align-items-center px-3 py-2" style={{ borderTop: "1px solid #e0e0e0", background: "#f8f9fa", fontSize: "0.82rem" }}>
                            <span className="text-muted">Showing {machines.length} auto machines</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
