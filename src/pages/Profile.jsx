import "../styles/home.css";
import "../styles/profile.css";
import { useState, useEffect } from "react";
import { Menu, ChevronDown, User, Mail, Phone, MapPin, Zap, Hash, Shield, Edit2, Save } from "lucide-react";
import Sidebar_Menu from "./Sidebar_Menu";
import { useNavigate } from "react-router-dom";

export default function Profile() {
    const [collapsed, setCollapsed] = useState(window.innerWidth < 1024);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const navigate = useNavigate();
    const user = JSON.parse(localStorage.getItem("user"));

    // Static defaults — shown the very first time, before any edits
    const DEFAULTS = {
        phone: "+91 ",
        address: "Mumbai, Maharashtra",
        provider: "MSEDCL",
        meterNumber: "MH-2045-87632",
        plan: "Residential LT-1",
        connectionType: "Single Phase",
    };

    // Load previously saved profile data from localStorage; fall back to defaults
    const getSavedData = () => {
        try {
            const saved = localStorage.getItem("profileData");
            return saved ? { ...DEFAULTS, ...JSON.parse(saved) } : { ...DEFAULTS };
        } catch {
            return { ...DEFAULTS };
        }
    };

    const [form, setForm] = useState(getSavedData);
    // Draft holds in-progress edits; only committed on Save
    const [draft, setDraft] = useState({ ...form });

    const [stats, setStats] = useState({ predictions: 0, memberSince: new Date().getFullYear(), avgBill: "₹0" });

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const token = localStorage.getItem("token");
                const headers = token ? { Authorization: `Bearer ${token}` } : {};

                const [predRes, billsRes] = await Promise.all([
                    fetch("/api/history/predictions", { headers }),
                    fetch("/api/history/bills", { headers })
                ]);

                let predictionsData = [];
                if (predRes.ok) predictionsData = await predRes.json();

                let billsData = [];
                if (billsRes.ok) billsData = await billsRes.json();

                const numPredictions = predictionsData.length;

                let totalAmount = 0;
                let count = 0;

                if (billsData.length > 0) {
                    billsData.forEach(b => {
                        totalAmount += Number(b.amount) || 0;
                        count++;
                    });
                } else if (predictionsData.length > 0) {
                    predictionsData.forEach(p => {
                        totalAmount += Number(p.predictAmount) || 0;
                        count++;
                    });
                }

                let avg = count > 0 ? (totalAmount / count) : 0;

                let formattedAvg = "₹0";
                if (avg >= 1000) {
                    formattedAvg = "₹" + (avg / 1000).toFixed(1) + "K";
                } else if (avg > 0) {
                    formattedAvg = "₹" + Math.round(avg);
                }

                let memberSince = new Date().getFullYear();
                let dates = [];

                predictionsData.forEach(p => {
                    if (p.createdAt) dates.push(new Date(p.createdAt).getFullYear());
                });

                billsData.forEach(b => {
                    if (b.createdAt) dates.push(new Date(b.createdAt).getFullYear());
                });

                if (dates.length > 0) {
                    memberSince = Math.min(...dates);
                }

                setStats({
                    predictions: numPredictions,
                    memberSince,
                    avgBill: formattedAvg
                });
            } catch (err) {
                console.error("Error fetching stats:", err);
            }
        };
        fetchStats();
    }, []);

    function handleEdit() {
        setDraft({ ...form }); // reset draft to current saved state
        setEditMode(true);
    }

    function handleChange(e) {
        setDraft(prev => ({ ...prev, [e.target.name]: e.target.value }));
    }

    function handleSave() {
        setForm({ ...draft });
        localStorage.setItem("profileData", JSON.stringify(draft));
        setEditMode(false); 
    }

    function handleCancel() {
        setDraft({ ...form }); // discard changes
        setEditMode(false);
    }

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
                    <h2>Profile</h2>

                    <div className="pf-grid">
                        <div className="pf-left">
                            <div className="pf-avatar-card">
                                <div className="pf-big-avatar">{user?.initials}</div>
                                <h3 className="pf-name">{user?.name}</h3>
                                <p className="pf-email">{user?.email}</p>
                                <span className="pf-role-badge">Residential User</span>
                                <div className="pf-stats-row">
                                    <div className="pf-stat">
                                        <p className="pf-stat-val">{stats.predictions}</p>
                                        <p className="pf-stat-lbl">Predictions</p>
                                    </div>
                                    <div className="pf-stat-divider" />
                                    <div className="pf-stat">
                                        <p className="pf-stat-val">{stats.memberSince}</p>
                                        <p className="pf-stat-lbl">Member Since</p>
                                    </div>
                                    <div className="pf-stat-divider" />
                                    <div className="pf-stat">
                                        <p className="pf-stat-val">{stats.avgBill}</p>
                                        <p className="pf-stat-lbl">Avg Bill</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="pf-right">
                            <div className="pf-section-card">
                                <div className="pf-section-header">
                                    <div className="pf-section-title">
                                        <User size={18} color="#6D4AFF" />
                                        <h4>Personal Information</h4>
                                    </div>
                                    <div style={{ display: "flex", gap: "8px" }}>
                                        {editMode && (
                                            <button className="pf-edit-btn" onClick={handleCancel} style={{ background: "#f3f4f6", color: "#374151", border: "1px solid #d1d5db" }}>
                                                Cancel
                                            </button>
                                        )}
                                        <button
                                            className={`pf-edit-btn ${editMode ? "save" : ""}`}
                                            onClick={() => editMode ? handleSave() : handleEdit()}>
                                            {editMode ? <><Save size={15} /> Save</> : <><Edit2 size={15} /> Edit</>}
                                        </button>
                                    </div>
                                </div>

                                <div className="pf-fields">
                                    <div className="pf-field">
                                        <label><User size={14} /> Full Name</label>
                                        <input value={user?.name || ""} disabled className="pf-input disabled" />
                                    </div>
                                    <div className="pf-field">
                                        <label><Mail size={14} /> Email Address</label>
                                        <input value={user?.email || ""} disabled className="pf-input disabled" />
                                    </div>
                                    <div className="pf-field">
                                        <label><Phone size={14} /> Phone Number</label>
                                        <input
                                            name="phone"
                                            maxLength="10"
                                            value={editMode ? draft.phone : form.phone}
                                            onChange={(e) => {
                                                e.target.value = e.target.value.replace(/[^0-9]/g, '');
                                                handleChange(e);
                                            }}
                                            disabled={!editMode}
                                            className={`pf-input ${!editMode ? "disabled" : ""}`} />
                                    </div>
                                    <div className="pf-field">
                                        <label><MapPin size={14} /> Address</label>
                                        <input
                                            name="address"
                                            value={editMode ? draft.address : form.address}
                                            onChange={handleChange}
                                            disabled={!editMode}
                                            className={`pf-input ${!editMode ? "disabled" : ""}`} />
                                    </div>
                                </div>
                            </div>

                            <div className="pf-section-card">
                                <div className="pf-section-header">
                                    <div className="pf-section-title">
                                        <Zap size={18} color="#6D4AFF" />
                                        <h4>Electricity Details</h4>
                                    </div>
                                    <div className="pf-verified-badge">
                                        <Shield size={13} />
                                        Verified
                                    </div>
                                </div>

                                <div className="pf-fields">
                                    <div className="pf-field">
                                        <label><Zap size={14} /> Provider</label>
                                        <input
                                            name="provider"
                                            value={editMode ? draft.provider : form.provider}
                                            onChange={handleChange}
                                            disabled={!editMode}
                                            className={`pf-input ${!editMode ? "disabled" : ""}`} />
                                    </div>
                                    <div className="pf-field">
                                        <label><Hash size={14} /> Meter Number</label>
                                        <input
                                            name="meterNumber"
                                            value={editMode ? draft.meterNumber : form.meterNumber}
                                            onChange={handleChange}
                                            disabled={!editMode}
                                            className={`pf-input ${!editMode ? "disabled" : ""}`} />
                                    </div>
                                    <div className="pf-field">
                                        <label><Shield size={14} /> Tariff Plan</label>
                                        <input
                                            name="plan"
                                            value={editMode ? draft.plan : form.plan}
                                            onChange={handleChange}
                                            disabled={!editMode}
                                            className={`pf-input ${!editMode ? "disabled" : ""}`} />
                                    </div>
                                    <div className="pf-field">
                                        <label><Zap size={14} /> Connection Type</label>
                                        <input
                                            name="connectionType"
                                            value={editMode ? draft.connectionType : form.connectionType}
                                            onChange={handleChange}
                                            disabled={!editMode}
                                            className={`pf-input ${!editMode ? "disabled" : ""}`} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}
