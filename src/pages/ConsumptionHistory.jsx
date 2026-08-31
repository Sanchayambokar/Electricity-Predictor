import "../styles/home.css";
import "../styles/consumptionhistory.css";
import { useState } from "react";
import { Menu, ChevronDown, Zap, BarChart2, Flame, Leaf } from "lucide-react";
import Sidebar_Menu from "./Sidebar_Menu";
import { useNavigate } from "react-router-dom";
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis,
    CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from "recharts";

import { useEffect } from "react";
import dayjs from "dayjs";

const mockData = [
    { month: "Jan", units: 420, season: "Winter" },
    { month: "Feb", units: 390, season: "Winter" },
    { month: "Mar", units: 480, season: "Summer" },
    { month: "Apr", units: 510, season: "Summer" },
    { month: "May", units: 560, season: "Summer" },
    { month: "Jun", units: 530, season: "Monsoon" },
    { month: "Jul", units: 500, season: "Monsoon" },
    { month: "Aug", units: 490, season: "Monsoon" },
    { month: "Sep", units: 470, season: "PostMonsoon" },
    { month: "Oct", units: 440, season: "PostMonsoon" },
    { month: "Nov", units: 500, season: "PostMonsoon" },
    { month: "Dec", units: 460, season: "Winter" },
];

const seasonColors = {
    Winter: "#637be1",
    Summer: "#f8b537",
    Monsoon: "#2ebc7f",
    PostMonsoon: "#995cf1",
};

const getSeason = (monthStr) => {
    const m = monthStr.toLowerCase();
    if (["dec", "jan", "feb"].includes(m)) return "Winter";
    if (["mar", "apr", "may"].includes(m)) return "Summer";
    if (["jun", "jul", "aug", "sep"].includes(m)) return "Monsoon";
    return "PostMonsoon";
};

const parseBillDateToMonthYear = (rawDate) => {
    if (!rawDate || rawDate === "—") return "";
    if (/^[A-Za-z]{3}\s+\d{4}$/.test(rawDate)) {
        return rawDate;
    }
    const clean = rawDate.replace(/[\/\-\s]+/g, " ").trim();
    const parts = clean.split(" ");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (parts.length === 2) {
        let monthPart = parts[0];
        let yearPart = parts[1];
        const monthIdx = months.findIndex(m => m.toLowerCase() === monthPart.toLowerCase().substring(0, 3));
        if (monthIdx !== -1) {
            monthPart = months[monthIdx];
            if (yearPart.length === 2) yearPart = `20${yearPart}`;
            return `${monthPart} ${yearPart}`;
        }
    }
    if (parts.length === 3) {
        let monthPart = parts[1];
        let yearPart = parts[2];
        if (/^\d+$/.test(monthPart)) {
            const idx = parseInt(monthPart, 10) - 1;
            if (idx >= 0 && idx < 12) {
                monthPart = months[idx];
            }
        } else {
            const monthIdx = months.findIndex(m => m.toLowerCase() === monthPart.toLowerCase().substring(0, 3));
            if (monthIdx !== -1) {
                monthPart = months[monthIdx];
            }
        }
        if (yearPart.length === 2) yearPart = `20${yearPart}`;
        if (months.includes(monthPart) && /^\d{4}$/.test(yearPart)) {
            return `${monthPart} ${yearPart}`;
        }
    }
    const d = dayjs(rawDate);
    if (d.isValid()) {
        return d.format("MMM YYYY");
    }
    return rawDate;
};

const parseMonthName = (rawDate) => {
    const parsed = parseBillDateToMonthYear(rawDate);
    if (parsed) {
        return parsed.split(" ")[0];
    }
    return "Jan";
};

const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="ch-tooltip">
                <p className="ch-tooltip-label">{label}</p>
                <p className="ch-tooltip-val">{payload[0].value} KWh</p>
            </div>
        );
    }
    return null;
};

export default function ConsumptionHistory() {
    const [collapsed, setCollapsed] = useState(window.innerWidth < 1024);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [bills, setBills] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
    const user = JSON.parse(localStorage.getItem("user"));

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const token = localStorage.getItem("token");
                const res = await fetch("/api/history/bills", {
                    headers: token ? { "Authorization": `Bearer ${token}` } : {}
                });
                const data = await res.json();
                
                if (res.ok && Array.isArray(data)) {
                    setBills(data);
                } else {
                    setBills([]);
                }
            } catch (err) {
                console.error("Error fetching history:", err);
                setBills([]);
            } finally {
                setLoading(false);
            }
        };
        fetchHistory();
    }, []);

    const consumptionData = bills.map(b => {
        const monthName = parseMonthName(b.billDate);
        return {
            month: monthName,
            units: b.units,
            season: getSeason(monthName)
        };
    });

    const seasonData = Object.entries(
        consumptionData.reduce((acc, d) => {
            acc[d.season] = (acc[d.season] || 0) + d.units;
            return acc;
        }, {})
    ).map(([season, units]) => ({ season, units }));

    const totalUnits = consumptionData.reduce((s, d) => s + d.units, 0);
    const avgUnits = consumptionData.length > 0 ? Math.round(totalUnits / consumptionData.length) : 0;
    const peakMonth = consumptionData.length > 0 ? consumptionData.reduce((a, b) => (a.units > b.units ? a : b)) : { month: "—", units: 0 };

    function handleLogout() {
        localStorage.removeItem("user");
        localStorage.removeItem("token");
        localStorage.removeItem("fallbackHistory");
        navigate("/login");
    }

    return (
        <div className="layout">
            <Sidebar_Menu collapsed={collapsed} setCollapsed={setCollapsed} />
            {!collapsed && (
                <div className="mobile-sidebar-backdrop" onClick={() => setCollapsed(true)} />
            )}
            <div className="main-content">
                <header className="top-navbar">
                    <div className="navbar">
                        <div className="menu" onClick={() => setCollapsed(!collapsed)}>
                            <Menu />
                        </div>
                        <div className="profile" onClick={() => setShowProfileMenu(!showProfileMenu)}>
                            <div className="avatar">{user?.initials}</div>
                            {user?.name}
                            <ChevronDown />
                            {showProfileMenu && (
                                <div className="profile-dropdown">
                                    <div className="dropdown-item logout" onClick={handleLogout}>Logout</div>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                <main className="content">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                        <h2 style={{ margin: 0 }}>Consumption History</h2>
                        <button
                            onClick={() => navigate("/uploadbill")}
                            style={{
                                backgroundColor: "#6D4AFF",
                                color: "white",
                                border: "none",
                                borderRadius: "8px",
                                padding: "9px 18px",
                                cursor: "pointer",
                                fontWeight: "600",
                                fontSize: "14px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px"
                            }}
                        >
                            + Upload New Bill
                        </button>
                    </div>

                    <div className="ch-stats">
                        <div className="ch-stat-card">
                            <div className="ch-stat-icon" id="blue">
                                <Zap size={22} color="#637be1" />
                            </div>
                            <div>
                                <p className="ch-stat-label">Total Units</p>
                                <p className="ch-stat-value">{totalUnits.toLocaleString()} KWh</p>
                            </div>
                        </div>
                        <div className="ch-stat-card">
                            <div className="ch-stat-icon" id="purple">
                                <BarChart2 size={22} color="#995cf1" />
                            </div>
                            <div>
                                <p className="ch-stat-label">Monthly Average</p>
                                <p className="ch-stat-value">{avgUnits} KWh</p>
                            </div>
                        </div>
                        <div className="ch-stat-card">
                            <div className="ch-stat-icon" id="orange">
                                <Flame size={22} color="#f8b537" />
                            </div>
                            <div>
                                <p className="ch-stat-label">Peak Month</p>
                                <p className="ch-stat-value">{peakMonth.month}</p>
                                <p className="ch-stat-sub">{peakMonth.units > 0 ? `${peakMonth.units} KWh` : "—"}</p>
                            </div>
                        </div>
                        <div className="ch-stat-card">
                            <div className="ch-stat-icon" id="green">
                                <Leaf size={22} color="#2ebc7f" />
                            </div>
                            <div>
                                <p className="ch-stat-label">CO₂ Saved (est.)</p>
                                <p className="ch-stat-value">{(totalUnits * 0.82).toFixed(0)} kg</p>
                            </div>
                        </div>
                    </div>

                    {loading ? (
                        <div style={{ textAlign: "center", padding: "60px 0", color: "#6b7280" }}>
                            <p>Loading your consumption history...</p>
                        </div>
                    ) : consumptionData.length === 0 ? (
                        <div style={{
                            background: "#ffffff",
                            border: "1px solid #e5e7eb",
                            borderRadius: "14px",
                            padding: "48px 24px",
                            textAlign: "center",
                            marginTop: "16px"
                        }}>
                            <div style={{
                                width: "64px",
                                height: "64px",
                                background: "#eff6ff",
                                borderRadius: "50%",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                marginBottom: "16px"
                            }}>
                                <Zap size={32} color="#2563eb" />
                            </div>
                            <h3 style={{ fontSize: "1.2rem", color: "#1f2937", marginBottom: "8px" }}>No Consumption Records Yet</h3>
                            <p style={{ color: "#6b7280", maxWidth: "460px", margin: "0 auto 24px", fontSize: "14.5px" }}>
                                Upload your electricity bills to see power consumption trends, seasonal breakdown, and carbon emission analytics for your account ({user?.email}).
                            </p>
                            <button
                                onClick={() => navigate("/uploadbill")}
                                style={{
                                    backgroundColor: "#6D4AFF",
                                    color: "white",
                                    border: "none",
                                    borderRadius: "8px",
                                    padding: "11px 24px",
                                    cursor: "pointer",
                                    fontWeight: "600",
                                    fontSize: "15px"
                                }}
                            >
                                Upload Your First Bill
                            </button>
                        </div>
                    ) : (
                        <div className="ch-charts-grid">
                            <div className="ch-chart-card ch-area">
                                <h3>Monthly Consumption Trend</h3>
                                <ResponsiveContainer width="100%" height={280}>
                                    <AreaChart data={consumptionData} margin={{ top: 10, right: 10, left: -5, bottom: 30 }}>
                                        <defs>
                                            <linearGradient id="unitGradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6D4AFF" stopOpacity={0.35} />
                                                <stop offset="95%" stopColor="#6D4AFF" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid vertical={false} stroke="#E5E7EB" />
                                        <XAxis dataKey="month" tick={{ fontSize: 12 }}
                                            label={{ value: "Month", position: "insideBottom", offset: -20 }} />
                                        <YAxis tick={{ fontSize: 12 }}
                                            label={{ value: "Units (KWh)", angle: -90, position: "insideLeft", offset: 15 }} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Area type="monotone" dataKey="units"
                                            stroke="#6D4AFF" strokeWidth={3}
                                            fill="url(#unitGradient)"
                                            dot={{ r: 5, fill: "#6D4AFF", strokeWidth: 2 }}
                                            activeDot={{ r: 8 }}
                                            animationDuration={1200} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>

                            <div className="ch-chart-card ch-season">
                                <h3>Units by Season</h3>
                                <ResponsiveContainer width="100%" height={280}>
                                    <BarChart data={seasonData} margin={{ top: 10, right: 10, left: -5, bottom: 10 }}>
                                        <CartesianGrid vertical={false} stroke="#E5E7EB" />
                                        <XAxis dataKey="season" tick={{ fontSize: 12 }} />
                                        <YAxis tickFormatter={(v) => `${v}`} tick={{ fontSize: 12 }} />
                                        <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
                                            <div className="ch-tooltip">
                                                <p className="ch-tooltip-label">{label}</p>
                                                <p className="ch-tooltip-val">{payload[0].value} KWh</p>
                                            </div>
                                        ) : null} />
                                        <Bar dataKey="units" radius={[8, 8, 0, 0]} animationDuration={1200}>
                                            {seasonData.map((entry, i) => (
                                                <Cell key={`season-cell-${entry.season || i}`} fill={seasonColors[entry.season] || "#6D4AFF"} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                                <div className="ch-legend">
                                    {Object.entries(seasonColors).map(([s, c]) => (
                                        <div key={s} className="ch-legend-item">
                                            <span className="ch-legend-dot" style={{ background: c }} />
                                            <span>{s}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
