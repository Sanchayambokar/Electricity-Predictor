import "../styles/home.css";
import "../styles/billhistory.css";
import { useState } from "react";
import { Menu, ChevronDown, TrendingUp, TrendingDown, IndianRupee, Calendar } from "lucide-react";
import Sidebar_Menu from "./Sidebar_Menu";
import { useNavigate } from "react-router-dom";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Cell
} from "recharts";

import { useEffect } from "react";
import dayjs from "dayjs";

const mockData = [
    { month: "Jan 2026", units: 420, amount: 3780, status: "Paid" },
    { month: "Feb 2026", units: 390, amount: 3510, status: "Paid" },
    { month: "Mar 2026", units: 480, amount: 4320, status: "Paid" },
    { month: "Apr 2026", units: 510, amount: 4590, status: "Paid" },
    { month: "May 2026", units: 560, amount: 5040, status: "Paid" },
    { month: "Jun 2026", units: 530, amount: 4770, status: "Paid" },
    { month: "Jul 2026", units: 500, amount: 4500, status: "Paid" },
    { month: "Aug 2026", units: 490, amount: 4410, status: "Paid" },
    { month: "Sep 2026", units: 470, amount: 4230, status: "Paid" },
    { month: "Oct 2026", units: 440, amount: 3960, status: "Paid" },
    { month: "Nov 2026", units: 500, amount: 4500, status: "Paid" },
    { month: "Dec 2026", units: 460, amount: 4140, status: "Pending" },
];

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

const parseBillDate = (rawDate) => {
    return parseBillDateToMonthYear(rawDate) || "Unknown";
};

const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div className="bh-tooltip">
                <p className="bh-tooltip-month">{label}</p>
                <p className="bh-tooltip-val">₹ {payload[0].value.toLocaleString()}</p>
            </div>
        );
    }
    return null;
};

export default function BillHistory() {
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

    const billData = bills.map(b => ({
        month: parseBillDate(b.billDate),
        units: b.units,
        amount: b.amount,
        status: "Paid"
    }));

    const totalPaid = billData.reduce((s, d) => s + d.amount, 0);
    const avgBill = billData.length > 0 ? Math.round(totalPaid / billData.length) : 0;
    const highest = billData.length > 0 ? billData.reduce((a, b) => (a.amount > b.amount ? a : b)) : { month: "—", amount: 0 };

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
                        <h2 style={{ margin: 0 }}>Bill History</h2>
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

                    <div className="bh-stats">
                        <div className="bh-stat-card">
                            <div className="bh-stat-icon" id="purple">
                                <IndianRupee size={22} color="#995cf1" />
                            </div>
                            <div>
                                <p className="bh-stat-label">Total Paid</p>
                                <p className="bh-stat-value">₹{totalPaid.toLocaleString()}</p>
                            </div>
                        </div>
                        <div className="bh-stat-card">
                            <div className="bh-stat-icon" id="blue">
                                <TrendingUp size={22} color="#637be1" />
                            </div>
                            <div>
                                <p className="bh-stat-label">Average Monthly Bill</p>
                                <p className="bh-stat-value">₹{avgBill.toLocaleString()}</p>
                            </div>
                        </div>
                        <div className="bh-stat-card">
                            <div className="bh-stat-icon" id="orange">
                                <TrendingDown size={22} color="#f8b537" />
                            </div>
                            <div>
                                <p className="bh-stat-label">Highest Bill Month</p>
                                <p className="bh-stat-value">{highest.month}</p>
                                <p className="bh-stat-sub">₹{highest.amount.toLocaleString()}</p>
                            </div>
                        </div>
                        <div className="bh-stat-card">
                            <div className="bh-stat-icon" id="green">
                                <Calendar size={22} color="#2ebc7f" />
                            </div>
                            <div>
                                <p className="bh-stat-label">Bills Recorded</p>
                                <p className="bh-stat-value">{billData.length} {billData.length === 1 ? "Month" : "Months"}</p>
                            </div>
                        </div>
                    </div>

                    {loading ? (
                        <div style={{ textAlign: "center", padding: "60px 0", color: "#6b7280" }}>
                            <p>Loading your bill history...</p>
                        </div>
                    ) : billData.length === 0 ? (
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
                                background: "#f5f3ff",
                                borderRadius: "50%",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                marginBottom: "16px"
                            }}>
                                <IndianRupee size={32} color="#6D4AFF" />
                            </div>
                            <h3 style={{ fontSize: "1.2rem", color: "#1f2937", marginBottom: "8px" }}>No Bills Uploaded Yet</h3>
                            <p style={{ color: "#6b7280", maxWidth: "460px", margin: "0 auto 24px", fontSize: "14.5px" }}>
                                Upload your electricity bill PDF or photo to track your monthly payments, bill trends, and payment records for your account ({user?.email}).
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
                        <div className="bh-main-grid">
                            <div className="bh-chart-card">
                                <h3>Monthly Bill Overview</h3>
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={billData} margin={{ top: 10, right: 10, left: -5, bottom: 30 }}>
                                        <CartesianGrid vertical={false} stroke="#E5E7EB" />
                                        <XAxis dataKey="month" tick={{ fontSize: 11 }}
                                            tickFormatter={(v) => v.split(" ")[0]}
                                            label={{ value: "Month", position: "insideBottom", offset: -20 }} />
                                        <YAxis tickFormatter={(v) => `${v / 1000}K`} tick={{ fontSize: 12 }} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Bar dataKey="amount" radius={[6, 6, 0, 0]} animationDuration={1200}>
                                            {billData.map((entry, i) => (
                                                <Cell key={`cell-${entry.month || i}`} fill={entry.amount === highest.amount ? "#6D4AFF" : "#C4B5FD"} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            <div className="bh-table-card">
                                <h3>Bill Details</h3>
                                <div className="bh-table-wrap">
                                    <table className="bh-table">
                                        <thead>
                                            <tr>
                                                <th>Month</th>
                                                <th>Units (KWh)</th>
                                                <th>Amount</th>
                                                <th>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {[...billData].reverse().map((row, i) => (
                                                <tr key={`row-${row.month || i}`}>
                                                    <td>{row.month}</td>
                                                    <td>{row.units}</td>
                                                    <td>₹{row.amount.toLocaleString()}</td>
                                                    <td>
                                                        <span className={`bh-badge ${row.status === "Paid" ? "paid" : "pending"}`}>
                                                            {row.status}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
