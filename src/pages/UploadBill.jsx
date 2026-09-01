import "../styles/home.css";
import "../styles/uploadbill.css";
import { useState, useRef, useMemo, useEffect } from "react";
import {
    Menu, ChevronDown, Upload, Camera, Image, Clipboard,
    CheckCircle, FileText, AlertCircle, Download, RefreshCw,
    Globe, Phone, User, CreditCard, Plug, Calendar, BadgeCheck,
    Banknote, Wallet, Zap, Loader2
} from "lucide-react";
import Sidebar_Menu from "./Sidebar_Menu";
import { useNavigate } from "react-router-dom";
import tataPowerLogo from "../assets/tata-power-logo.png";
import msedclLogo from "../assets/MSEDCL-logo.png";
import adaniLogo from "../assets/Adani-logo.png";
import torrentLogo from "../assets/torrent-power-logo.png";
import bestLogo from "../assets/Best-power-logo.png";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const COMPANY_LOGOS = {
    "tata": tataPowerLogo,
    "msedcl": msedclLogo,
    "adani": adaniLogo,
    "torrent": torrentLogo,
    "best": bestLogo,
};

function getCompanyLogo(name) {
    if (!name || name === "—") return null;
    const lower = name.toLowerCase();
    for (const key in COMPANY_LOGOS) {
        if (lower.includes(key)) return COMPANY_LOGOS[key];
    }
    return null;
}

export default function UploadBill() {
    const [collapsed, setCollapsed] = useState(window.innerWidth < 1024);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [activeTab, setActiveTab] = useState("upload");
    const [dragOver, setDragOver] = useState(false);
    const [files, setFiles] = useState([]);          // array of { file, preview }
    const [activeFileIdx, setActiveFileIdx] = useState(0); // which file to OCR
    const [processing, setProcessing] = useState(false);
    const [extracted, setExtracted] = useState(null);
    const [error, setError] = useState(null);
    // manualMode: true when user explicitly skips OCR or when OCR validation fails
    const [manualMode, setManualMode] = useState(false);
    // validationWarnings: populated when server returns 422 + requiresManualOverride
    const [validationWarnings, setValidationWarnings] = useState([]);
    const fileRef = useRef();
    const cameraRef = useRef();
    const navigate = useNavigate();
    const user = JSON.parse(localStorage.getItem("user"));

    function handleLogout() {
        localStorage.removeItem("user");
        localStorage.removeItem("token");
        localStorage.removeItem("fallbackHistory");
        navigate("/login");
    }

    function buildEntries(rawFiles) {
        const allowed = ["application/pdf", "image/jpeg", "image/png", "image/jpg", "image/webp"];
        return Array.from(rawFiles)
            .filter(f => allowed.includes(f.type))
            .map(f => ({
                file: f,
                preview: f.type === "application/pdf" ? null : URL.createObjectURL(f),
            }));
    }

    function addFiles(rawFiles) {
        const entries = buildEntries(rawFiles);
        if (!entries.length) {
            setError("Unsupported file type. Use PDF, JPG, or PNG.");
            return;
        }
        setFiles(prev => {
            const updated = [...prev, ...entries];
            setActiveFileIdx(prev.length); // select first newly added
            return updated;
        });
        setExtracted(null);
        setError(null);
    }

    function removeFile(idx) {
        setFiles(prev => {
            const updated = prev.filter((_, i) => i !== idx);
            setActiveFileIdx(Math.max(0, idx - 1));
            return updated;
        });
        setExtracted(null);
        setError(null);
    }

    async function processAllFiles() {
        if (!files.length) return;
        setProcessing(true);
        setExtracted(null);
        setError(null);
        setValidationWarnings([]);

        try {
            const formData = new FormData();
            files.forEach(entry => {
                formData.append("files", entry.file);
            });
            const token = localStorage.getItem("token");
            const headers = token ? { Authorization: `Bearer ${token}` } : {};

            const res = await fetch("/api/extract", { method: "POST", body: formData, headers });
            const data = await res.json();

            // Handle 422 validation errors gracefully: show warnings and let user review/override
            if (res.status === 422 && data.requiresManualOverride) {
                setValidationWarnings(data.validationErrors || []);
                // Still show the parsed bill so user can review + manually correct fields
                if (data.parsedBill) {
                    setExtracted({ ...data.parsedBill, _confidence: data._confidence });
                    setActiveTab("details");
                }
                setProcessing(false);
                return;
            }

            if (!res.ok) throw new Error(data.detail || data.error || data.message || "Extraction failed");

            setExtracted(data);
            setProcessing(false);
            setActiveTab("details");
        } catch (err) {
            let msg = err.message || "Could not extract bill details. Try a clearer image.";
            if (msg.toLowerCase().includes("token") || msg.toLowerCase().includes("expired")) {
                msg = "Session expired. Please log out and log back in.";
            }
            setError(msg);
            setProcessing(false);
        }
    }

    /** Returns a confidence badge element for a field based on _confidence metadata. */
    function getConfidenceBadge(fieldName) {
        const conf = extracted?._confidence?.[fieldName];
        if (!conf) return null;
        if (conf.confidence > 80) {
            return <span className="ub-conf-badge ub-conf-high" title="High confidence OCR extraction">From OCR ✓</span>;
        } else if (conf.confidence > 0) {
            return <span className="ub-conf-badge ub-conf-review" title="Needs review — moderate confidence">Needs Review ⚠</span>;
        } else {
            return <span className="ub-conf-badge ub-conf-manual" title="Could not be extracted — please enter manually">Manual Required ✎</span>;
        }
    }

    /** Returns the CSS class to apply to a field row based on confidence. */
    function getFieldClass(fieldName) {
        const conf = extracted?._confidence?.[fieldName];
        if (!conf) return "";
        if (conf.confidence > 80) return "ub-field-ocr-high";
        if (conf.confidence > 0)  return "ub-field-ocr-review";
        return "ub-field-manual";
    }

    function handleDrop(e) {
        e.preventDefault();
        setDragOver(false);
        addFiles(e.dataTransfer.files);
    }

    function handleFileInput(e) {
        addFiles(e.target.files);
        e.target.value = ""; // allow re-selecting same file
    }

    function handleReExtract() {
        setFiles([]);
        setActiveFileIdx(0);
        setExtracted(null);
        setProcessing(false);
        setError(null);
    }

    async function handlePasteFromClipboard() {
        try {
            const clipboardItems = await navigator.clipboard.read();
            for (const clipboardItem of clipboardItems) {
                const imageTypes = clipboardItem.types.filter(type => type.startsWith('image/'));
                for (const imageType of imageTypes) {
                    const blob = await clipboardItem.getType(imageType);
                    const file = new File([blob], "pasted-image.png", { type: imageType });
                    addFiles([file]);
                    return;
                }
            }
            setError("No image found in clipboard.");
        } catch (err) {
            console.error("Clipboard access failed:", err);
            setError("Could not read from clipboard. Try allowing permissions or use Ctrl+V.");
        }
    }

    // Global paste handler
    useEffect(() => {
        const handleGlobalPaste = (e) => {
            if (activeTab !== "upload") return;
            const items = e.clipboardData?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.startsWith("image/")) {
                    const file = items[i].getAsFile();
                    if (file) addFiles([file]);
                }
            }
        };
        window.addEventListener("paste", handleGlobalPaste);
        return () => window.removeEventListener("paste", handleGlobalPaste);
    }, [activeTab]);

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
                    <h2>Upload Your Bill &amp; View Details</h2>
                    <p className="ub-subtitle">Upload your electricity bill PDF or image to extract and view important details.</p>

                    {/* ── Persistent Skip OCR / Enter Manually banner ── */}
                    <div className="ub-manual-banner">
                        <span className="ub-manual-banner-text">
                            Prefer to enter details yourself?
                        </span>
                        <button
                            className="ub-manual-toggle-btn"
                            onClick={() => { setManualMode(m => !m); setActiveTab("upload"); }}
                        >
                            {manualMode ? "← Back to OCR Upload" : "Skip OCR / Enter Manually"}
                        </button>
                    </div>

                    {/* ── Validation warnings from server ── */}
                    {validationWarnings.length > 0 && (
                        <div className="ub-validation-warn">
                            <AlertCircle size={16} color="#b45309" style={{ flexShrink: 0 }} />
                            <div>
                                <strong>OCR Validation Warnings</strong> — please review and correct highlighted fields:
                                <ul style={{ margin: "6px 0 0", paddingLeft: "18px" }}>
                                    {validationWarnings.map((w, i) => <li key={i}>{w}</li>)}
                                </ul>
                            </div>
                        </div>
                    )}

                    <div className="ub-tabs">
                        <button className={`ub-tab ${activeTab === "upload" ? "active" : ""}`} onClick={() => setActiveTab("upload")}>
                            Upload &amp; Extract
                        </button>
                        <button className={`ub-tab ${activeTab === "details" ? "active" : ""}`} onClick={() => setActiveTab("details")}>
                            Extracted Details
                        </button>
                    </div>                    {activeTab === "upload" && (
                        <div className="ub-body">
                            <div className="ub-left">
                                {/* ── Drop Zone ── */}
                                <div
                                    className={`ub-dropzone ${dragOver ? "dragover" : ""} ${processing ? "processing" : ""} ${extracted ? "done" : ""} ${error ? "err" : ""}`}
                                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                                    onDragLeave={() => setDragOver(false)}
                                    onDrop={handleDrop}
                                    onClick={() => !processing && fileRef.current.click()}>
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                                        multiple
                                        style={{ display: "none" }}
                                        onChange={handleFileInput} />
                                    <input
                                        ref={cameraRef}
                                        type="file"
                                        accept="image/*"
                                        capture="environment"
                                        style={{ display: "none" }}
                                        onChange={handleFileInput} />

                                    {files.length === 0 && !processing && !error && (
                                        <>
                                            <div className="ub-drop-icon"><Upload size={40} color="#6D4AFF" /></div>
                                            <p className="ub-drop-title">Drag & drop your bills here</p>
                                            <p className="ub-drop-sub">Supports PDF, JPG, PNG — multiple files allowed</p>
                                            <p className="ub-drop-or">or</p>
                                            <button className="ub-choose-btn" onClick={(e) => { e.stopPropagation(); fileRef.current.click(); }}>
                                                Choose Files
                                            </button>

                                            <div className="ub-other-ways-inline" onClick={e => e.stopPropagation()}>
                                                <p className="ub-other-title-inline">Other ways to upload</p>
                                                <div className="ub-other-list-inline">
                                                    <div className="ub-other-item-inline" onClick={(e) => { e.stopPropagation(); cameraRef.current.click(); }}>
                                                        <Camera size={16} color="#6D4AFF" />
                                                        <p className="ub-other-name-inline">Take a Photo</p>
                                                    </div>
                                                    <div className="ub-other-item-inline" onClick={(e) => { e.stopPropagation(); fileRef.current.click(); }}>
                                                        <Image size={16} color="#6D4AFF" />
                                                        <p className="ub-other-name-inline">Gallery</p>
                                                    </div>
                                                    <div className="ub-other-item-inline" onClick={(e) => { e.stopPropagation(); handlePasteFromClipboard(); }}>
                                                        <Clipboard size={16} color="#6D4AFF" />
                                                        <p className="ub-other-name-inline">Paste Image</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {processing && (() => {
                                        const entry = files[0];
                                        const displayName = files.length > 1 ? `${files.length} files` : entry?.file?.name;
                                        return (
                                            <div className="ub-processing">
                                                {/* File preview thumbnail */}
                                                <div className="ub-ocr-preview-wrap">
                                                    {entry?.preview ? (
                                                        <img
                                                            src={entry.preview}
                                                            alt={displayName}
                                                            className="ub-ocr-preview-img" />
                                                    ) : (
                                                        <div className="ub-ocr-preview-pdf">
                                                            <FileText size={36} color="#6D4AFF" />
                                                            <span>PDF</span>
                                                        </div>
                                                    )}
                                                    {/* Animated scan overlay */}
                                                    <div className="ub-ocr-scan-line" />
                                                </div>
                                                <div className="ub-ocr-status">
                                                    <Loader2 size={20} color="#6D4AFF" className="ub-spin-icon" />
                                                    <p>Extracting Details from Bill...</p>
                                                </div>
                                                <p className="ub-file-name">{displayName}</p>
                                            </div>
                                        );
                                    })()}

                                    {extracted && !processing && (() => {
                                        const entry = files[0];
                                        const displayName = files.length > 1 ? `${files.length} files` : entry?.file?.name;
                                        return (
                                            <div className="ub-success">
                                                <div className="ub-ocr-preview-wrap" style={{ marginBottom: "8px" }}>
                                                    {entry?.preview ? (
                                                        <img
                                                            src={entry.preview}
                                                            alt={displayName}
                                                            className="ub-ocr-preview-img" />
                                                    ) : (
                                                        <div className="ub-ocr-preview-pdf">
                                                            <FileText size={24} color="#6D4AFF" />
                                                            <span>PDF</span>
                                                        </div>
                                                    )}
                                                </div>
                                                <CheckCircle size={28} color="#16A34A" />
                                                <p className="ub-success-title">Extraction Successful!</p>
                                                <p className="ub-file-name">{displayName}</p>
                                                <button className="ub-choose-btn" style={{ marginTop: "16px" }} onClick={(e) => { e.stopPropagation(); setActiveTab("details"); }}>
                                                    View Extracted Details
                                                </button>
                                            </div>
                                        );
                                    })()}

                                    {error && !processing && (
                                        <div className="ub-error-state">
                                            <AlertCircle size={44} color="#ef4444" />
                                            <p className="ub-error-title">Extraction Failed</p>
                                            <p className="ub-file-name">{error}</p>
                                            <button className="ub-choose-btn" style={{ marginTop: "12px" }} onClick={(e) => { e.stopPropagation(); handleReExtract(); }}>
                                                Try Again
                                            </button>
                                        </div>
                                    )}

                                    {/* ── File Previews Inside Dropzone ── */}
                                    {files.length > 0 && !processing && !extracted && !error && (
                                        <div className="ub-preview-section" style={{ width: "100%", margin: 0, border: "none", boxShadow: "none", padding: 0, background: "transparent" }} onClick={(e) => e.stopPropagation()}>
                                            <div className="ub-preview-header">
                                                <p className="ub-preview-title"><FileText size={15} color="#6D4AFF" /> {files.length} file{files.length > 1 ? "s" : ""} selected</p>
                                                <button className="ub-add-more-btn" onClick={(e) => { e.stopPropagation(); fileRef.current.click(); }}>
                                                    + Add More
                                                </button>
                                            </div>
                                            <div className="ub-preview-grid">
                                                {files.map((entry, idx) => (
                                                    <div
                                                        key={idx}
                                                        className={`ub-preview-card ${idx === activeFileIdx ? "active" : ""}`}
                                                        onClick={(e) => { e.stopPropagation(); setActiveFileIdx(idx); setExtracted(null); setError(null); }}>
                                                        {/* Remove button */}
                                                        <button
                                                            className="ub-preview-remove"
                                                            onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                                                            title="Remove">
                                                            ×
                                                        </button>
                                                        {/* Thumbnail or PDF icon */}
                                                        {entry.preview ? (
                                                            <img src={entry.preview} alt={entry.file.name} className="ub-preview-img" />
                                                        ) : (
                                                            <div className="ub-preview-pdf-icon">
                                                                <FileText size={32} color="#6D4AFF" />
                                                                <span>PDF</span>
                                                            </div>
                                                        )}
                                                        <p className="ub-preview-name" title={entry.file.name}>{entry.file.name}</p>
                                                        <p className="ub-preview-size">{(entry.file.size / 1024).toFixed(0)} KB</p>
                                                    </div>
                                                ))}
                                            </div>
                                            {/* Extract button */}
                                            <button
                                                className="ub-extract-btn"
                                                onClick={(e) => { e.stopPropagation(); processAllFiles(); }}>
                                                <Zap size={16} /> Extract Data from {files.length > 1 ? `All ${files.length} Bills` : "Bill"}
                                            </button>
                                        </div>
                                    )}
                                </div>

                            </div>

                            <div className="ub-right">
                                <div className="ub-info-card">
                                    <h4 className="ub-info-title">How it works?</h4>
                                    <div className="ub-steps">
                                        {[
                                            "Upload your electricity bill (PDF or image)",
                                            "OCR engine reads all text from the bill",
                                            "Fields like units, amount & dates are auto-extracted",
                                            "Review the data and use it to predict your next bill",
                                        ].map((step, i) => (
                                            <div key={i} className="ub-step">
                                                <div className="ub-step-num">{i + 1}</div>
                                                <p>{step}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="ub-info-card">
                                    <div className="ub-formats-header">
                                        <FileText size={18} color="#6D4AFF" />
                                        <h4>Supported Formats</h4>
                                    </div>
                                    <div className="ub-format-tags">
                                        {["PDF", "JPG", "PNG"].map(f => (
                                            <span key={f} className="ub-format-tag">{f}</span>
                                        ))}
                                    </div>
                                    <p className="ub-max-size">Max file size: 20MB</p>
                                </div>

                                <div className="ub-info-card ub-note-card">
                                    <div className="ub-formats-header">
                                        <AlertCircle size={18} color="#f59e0b" />
                                        <h4>Note</h4>
                                    </div>
                                    <p className="ub-note-text">
                                        Make sure the bill is clear and all details are visible for best results. Blurry or low-resolution images may reduce accuracy.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === "upload" && extracted && (
                        <div className="ub-extracted-section">
                            <ExtractedHeader extracted={extracted} files={files} onReExtract={handleReExtract} />
                            <ExtractedContent data={extracted} />
                        </div>
                    )}

                    {activeTab === "details" && (
                        <div className="ub-extracted-section">
                            {extracted ? (
                                <>
                                    <ExtractedHeader extracted={extracted} files={files} onReExtract={handleReExtract} />
                                    <ExtractedContent data={extracted} />
                                </>
                            ) : (
                                <div className="ub-no-data">
                                    <FileText size={56} color="#c4b5fd" />
                                    <p style={{ fontSize: '16px', color: '#6b7280', fontWeight: '500' }}>Upload a bill to see details here</p>
                                    <button className="ub-choose-btn" onClick={() => setActiveTab("upload")}>Go to Upload</button>
                                </div>
                            )}
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}

function ExtractedHeader({ files, onReExtract }) {
    const displayName = files?.length > 1 ? `${files.length} Files Uploaded` : files?.[0]?.file?.name;
    return (
        <div className="ub-extracted-header">
            <div className="ub-extracted-title-row">
                <h3>Extracted Bill Details</h3>
                <span className="ub-success-badge"><CheckCircle size={13} /> Success</span>
            </div>
            <div className="ub-header-actions">
                <span className="ub-filename-chip"><FileText size={13} /> {displayName}</span>
                <button className="ub-reextract-btn" onClick={onReExtract}><RefreshCw size={14} /> Re-extract</button>
            </div>
        </div>
    );
}

function ExtractedContent({ data: d }) {
    const logo = getCompanyLogo(d.company?.name);
    const navigate = useNavigate();

    const paymentUrl = useMemo(() => {
        if (!d.company?.name || d.company?.name === "—") return null;
        const companyName = d.company.name.toLowerCase();

        const PAYMENT_URLS = {
            mahavitaran: "https://otheronlinepayment.mahadiscom.in/OtherReceipts/onlinePayment.jsp",
            adani: "https://www.adanielectricity.com/pay-your-bill/online-payments",
            best: "https://www.bestundertaking.net/",
            torrent: "https://connect.torrentpower.com/tplcp/preloginpaynow",
            tata: "https://pgi.billdesk.com/pgidsk/pgmerc/tatapwr/TATAPWRDetails.jsp"
        };

        for (const key in PAYMENT_URLS) {
            if (companyName.includes(key)) return PAYMENT_URLS[key];
        }

        if (
            companyName.includes("msedcl") ||
            companyName.includes("mahavitaran") ||
            companyName.includes("महावितरण") ||
            companyName.includes("mahadiscom")
        ) {
            return PAYMENT_URLS.mahavitaran;
        }

        return null;
    }, [d.company?.name]);

    const totalAmountDisplay = useMemo(() => {
        if (d.summary?.total && d.summary?.total !== "—") return d.summary.total;
        if (d.usage?.currAmount && d.usage?.currAmount !== "—") return d.usage.currAmount;

        const parseVal = (v) => {
            if (!v || v === "—") return 0;
            const match = String(v).match(/[\d,.]+/);
            if (!match) return 0;
            return parseFloat(match[0].replace(/,/g, "")) || 0;
        };

        const sum =
            parseVal(d.summary?.energy) +
            parseVal(d.summary?.fixed) +
            parseVal(d.summary?.fac) +
            parseVal(d.summary?.wheeling) +
            parseVal(d.summary?.duty) +
            parseVal(d.summary?.other);

        if (sum > 0) return `₹${sum.toFixed(2)}`;
        return "—";
    }, [d]);

    function handleGoToPredict() {
        navigate("/predictbill", { state: { billDetails: d } });
    }

    function handleDownloadPDF() {
        // Sanitize: replace ₹ with Rs., — with -, strip other unsupported unicode
        const s = (val) => {
            if (!val) return "-";
            return String(val)
                .replace(/₹/g, "Rs.")
                .replace(/—/g, "-")
                .replace(/[^\t\n\r -~]/g, "?"); // replace any remaining non-ASCII
        };

        const doc = new jsPDF();
        doc.setFont("helvetica");

        // ── Header ──────────────────────────────────────────────
        doc.setFontSize(22);
        doc.setTextColor(109, 74, 255);
        doc.text("Electricity Bill Report", 14, 22);

        doc.setDrawColor(109, 74, 255);
        doc.setLineWidth(0.5);
        doc.line(14, 26, 196, 26);

        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        const dateStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
        doc.text(`Generated on: ${dateStr}`, 14, 32);

        // ── Company Info ─────────────────────────────────────────
        doc.setFontSize(12);
        doc.setTextColor(30, 30, 30);
        doc.setFont("helvetica", "bold");
        doc.text("Company Information", 14, 42);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(60, 60, 60);
        let cy = 50;
        doc.text(`Company : ${s(d.company?.name)}`, 14, cy); cy += 7;
        if (d.company?.gstin && d.company.gstin !== "—") { doc.text(`GSTIN   : ${s(d.company.gstin)}`, 14, cy); cy += 7; }
        if (d.company?.toll && d.company.toll !== "—") { doc.text(`Helpline: ${s(d.company.toll)}`, 14, cy); cy += 7; }
        if (d.company?.website && d.company.website !== "—") { doc.text(`Website : ${s(d.company.website)}`, 14, cy); cy += 7; }

        // ── Consumer Details table ────────────────────────────────
        autoTable(doc, {
            startY: cy + 4,
            head: [["Field", "Details"]],
            body: [
                ["Consumer Name", s(d.consumer?.name)],
                ["Consumer ID", s(d.consumer?.id)],
                ["Connection No.", s(d.consumer?.connection)],
                ["Bill Date", s(d.consumer?.billDate)],
                ["Due Date", s(d.consumer?.dueDate)],
                ["Tariff Category", s(d.consumer?.tariffCategory)],
                ["Bill Status", s(d.usage?.status)],
            ],
            styles: { font: "helvetica", fontSize: 10, cellPadding: 3 },
            headStyles: { fillColor: [109, 74, 255], textColor: 255, fontStyle: "bold" },
            alternateRowStyles: { fillColor: [245, 243, 255] },
            columnStyles: { 0: { fontStyle: "bold", cellWidth: 55 } },
        });

        // ── Usage Comparison ─────────────────────────────────────
        autoTable(doc, {
            startY: doc.lastAutoTable.finalY + 8,
            head: [["Usage", "Previous Month", "Current Month"]],
            body: [
                ["Units Consumed", s(d.usage?.prevUnits), s(d.usage?.currUnits)],
                ["Bill Amount", s(d.usage?.prevAmount), s(d.usage?.currAmount)],
            ],
            styles: { font: "helvetica", fontSize: 10, cellPadding: 3 },
            headStyles: { fillColor: [109, 74, 255], textColor: 255, fontStyle: "bold" },
            alternateRowStyles: { fillColor: [245, 243, 255] },
            columnStyles: { 0: { fontStyle: "bold", cellWidth: 55 } },
        });

        // ── Bill Summary ─────────────────────────────────────────
        autoTable(doc, {
            startY: doc.lastAutoTable.finalY + 8,
            head: [["Bill Summary", "Amount"]],
            body: [
                ["Energy Charges", s(d.summary?.energy) || "Rs. 0.00"],
                ["Fixed Charge", s(d.summary?.fixed) || "Rs. 0.00"],
                ["Fuel Adjustment (FAC)", s(d.summary?.fac) || "Rs. 0.00"],
                ["Wheeling Charge", s(d.summary?.wheeling) || "Rs. 0.00"],
                ["Electricity Duty", s(d.summary?.duty) || "Rs. 0.00"],
                ["Other Charges", s(d.summary?.other) || "Rs. 0.00"],
                ["TOTAL PAYABLE", s(d.summary?.total || d.usage?.currAmount) || "-"],
            ],
            styles: { font: "helvetica", fontSize: 10, cellPadding: 3 },
            headStyles: { fillColor: [109, 74, 255], textColor: 255, fontStyle: "bold" },
            alternateRowStyles: { fillColor: [245, 243, 255] },
            columnStyles: { 0: { fontStyle: "bold", cellWidth: 80 } },
            didParseCell: (data) => {
                if (data.row.index === 6) {
                    data.cell.styles.fontStyle = "bold";
                    data.cell.styles.fillColor = [220, 210, 255];
                    data.cell.styles.textColor = [40, 10, 120];
                }
            },
        });

        // ── Tariff Slabs ─────────────────────────────────────────
        if (d.slabs && d.slabs.length > 0) {
            autoTable(doc, {
                startY: doc.lastAutoTable.finalY + 8,
                head: [["Slab Range (Units)", "Rate (Rs./Unit)", "Description"]],
                body: d.slabs.map(sl => [s(sl.range), s(sl.rate), s(sl.desc)]),
                styles: { font: "helvetica", fontSize: 10, cellPadding: 3 },
                headStyles: { fillColor: [109, 74, 255], textColor: 255, fontStyle: "bold" },
                alternateRowStyles: { fillColor: [245, 243, 255] },
            });
        }

        // ── Billing History ──────────────────────────────────────
        if (d.history && d.history.length > 0) {
            if (doc.lastAutoTable.finalY > 220) doc.addPage();
            autoTable(doc, {
                startY: doc.lastAutoTable.finalY + 8,
                head: [["Month", "Units Consumed", "Amount"]],
                body: d.history.map(h => [s(h.date), s(h.units), s(h.amount)]),
                styles: { font: "helvetica", fontSize: 10, cellPadding: 3 },
                headStyles: { fillColor: [109, 74, 255], textColor: 255, fontStyle: "bold" },
                alternateRowStyles: { fillColor: [245, 243, 255] },
            });
        }

        // ── Footer on every page ─────────────────────────────────
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.setTextColor(160);
            const pw = doc.internal.pageSize.width;
            const ph = doc.internal.pageSize.height;
            doc.line(14, ph - 14, pw - 14, ph - 14);
            doc.text(`Page ${i} of ${pageCount}  |  Electricity Bill Predictor`, 14, ph - 8);
            doc.text(dateStr, pw - 14, ph - 8, { align: "right" });
        }

        const fileName = s(d.consumer?.name || "bill").replace(/\s+/g, "_") + "_bill.pdf";
        doc.save(fileName);
    }

    return (
        <>
            <div className="ub-company-card">
                <h4>Company Information</h4>
                <div className="ub-company-body">
                    <div className="ub-company-left">
                        <div className="ub-company-logo">
                            {logo
                                ? <img src={logo} alt={d.company.name} className="ub-company-logo-img" />
                                : <Zap size={28} color="#6D4AFF" />
                            }
                        </div>
                        <div>
                            <p className="ub-company-name">{d.company?.name}</p>
                            {d.company?.cin !== "—" && <p className="ub-company-detail">CIN: {d.company.cin}</p>}
                            {d.company?.website !== "—" && <p className="ub-company-detail ub-detail-row"><Globe size={13} /> {d.company.website}</p>}
                            {d.company?.toll !== "—" && <p className="ub-company-detail ub-detail-row"><Phone size={13} /> {d.company.toll} (Toll Free)</p>}
                        </div>
                    </div>
                    {d.company?.office !== "—" && (
                        <div className="ub-company-right">
                            <p className="ub-company-label">Registered Office</p>
                            <p className="ub-company-detail">{d.company.office}</p>
                        </div>
                    )}
                    {d.company?.gstin !== "—" && (
                        <div>
                            <p className="ub-company-label">GSTIN</p>
                            <p className="ub-company-detail">{d.company.gstin}</p>
                        </div>
                    )}
                </div>
            </div>

            <div className="ub-consumer-grid">
                {[
                    { label: "Consumer Name", value: d.consumer?.name, icon: <User size={13} /> },
                    { label: "Consumer ID", value: d.consumer?.id, icon: <CreditCard size={13} /> },
                    { label: "Connection No.", value: d.consumer?.connection, icon: <Plug size={13} /> },
                    { label: "Bill Date", value: d.consumer?.billDate, icon: <Calendar size={13} /> },
                    { label: "Due Date", value: d.consumer?.dueDate, icon: <Calendar size={13} /> },
                    { label: "Tariff Category", value: d.consumer?.tariffCategory, icon: <Zap size={13} /> },
                    { label: "Bill Status", value: d.usage?.status, icon: <BadgeCheck size={13} />, highlight: true },
                ].map((item, i) => (
                    <div key={i} className="ub-consumer-cell">
                        <p className="ub-cell-label ub-detail-row">{item.icon} {item.label}</p>
                        <p className={`ub-cell-value ${item.highlight ? "paid" : ""}`}>{item.value || "—"}</p>
                    </div>
                ))}
            </div>

            <div className="ub-usage-grid">
                {[
                    { label: "Previous Month Units", value: d.usage?.prevUnits, icon: <Zap size={13} /> },
                    { label: "Previous Amount", value: d.usage?.prevAmount, icon: <Banknote size={13} /> },
                    { label: "Current Month Units", value: d.usage?.currUnits, icon: <Zap size={13} /> },
                    { label: "Current Amount", value: d.usage?.currAmount, icon: <Wallet size={13} /> },
                ].map((item, i) => (
                    <div key={i} className="ub-usage-cell">
                        <p className="ub-cell-label ub-detail-row">{item.icon} {item.label}</p>
                        <p className="ub-cell-value">{item.value || "—"}</p>
                    </div>
                ))}
            </div>

            {d.history && d.history.length > 0 && (
                <div className="ub-history-card" style={{
                    backgroundColor: "white",
                    borderRadius: "12px",
                    padding: "20px",
                    boxShadow: "0 1px 3px 0 rgba(0,0,0,0.05)",
                    marginBottom: "24px",
                    border: "1px solid #f3f4f6"
                }}>
                    <h4 style={{ fontSize: "16px", fontWeight: "600", color: "#111827", marginBottom: "4px", display: "flex", alignItems: "center", gap: "8px" }}>
                        <Banknote size={16} color="#6D4AFF" /> Billing &amp; Payment History ({d.history.length} Months)
                    </h4>
                    <p style={{ fontSize: "12.5px", color: "#6b7280", marginBottom: "16px" }}>Extracted historical payments from the bill</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "12px" }}>
                        {d.history.map((h, i) => (
                            <div key={i} style={{
                                backgroundColor: "#f9fafb",
                                borderRadius: "8px",
                                padding: "10px 14px",
                                border: "1px solid #e5e7eb",
                                display: "flex",
                                flexDirection: "column",
                                gap: "2px"
                            }}>
                                <span style={{ fontSize: "11px", color: "#6b7280", fontWeight: "500" }}>{h.date}</span>
                                <span style={{ fontSize: "16px", color: "#111827", fontWeight: "700" }}>
                                    {h.amount && h.amount !== "—" ? h.amount : h.units}
                                </span>
                                {h.amount && h.amount !== "—" && h.units && h.units !== "—" && (
                                    <span style={{ fontSize: "11px", color: "#6b7280" }}>{h.units}</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="ub-bottom-grid">
                <div className="ub-slab-card">
                    <h4>Slab Wise Unit Charges</h4>
                    <p className="ub-slab-sub">Range based tariff structure</p>
                    <table className="ub-slab-table">
                        <thead>
                            <tr>
                                <th>Slab Range (Units)</th>
                                <th>Unit Charge (₹/Unit)</th>
                                <th>Description</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(d.slabs || []).map((s, i) => (
                                <tr key={i}>
                                    <td>{s.range}</td>
                                    <td>{s.rate}</td>
                                    <td>{s.desc}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="ub-slab-note">* Above rates are indicative and may vary as per your electricity provider.</p>
                </div>

                <div className="ub-summary-card">
                    <h4>Bill Summary</h4>
                    <div className="ub-summary-rows">
                        <div className="ub-summary-row"><span>Energy Charges</span><span>{d.summary?.energy || "₹0.00"}</span></div>
                        <div className="ub-summary-row"><span>Fixed Charge</span><span>{d.summary?.fixed || "₹0.00"}</span></div>
                        <div className="ub-summary-row"><span>Fuel Adjustment (FAC)</span><span>{d.summary?.fac || "₹0.00"}</span></div>
                        <div className="ub-summary-row"><span>Wheeling Charge</span><span>{d.summary?.wheeling || "₹0.00"}</span></div>
                        <div className="ub-summary-row"><span>Electricity Duty</span><span>{d.summary?.duty || "₹0.00"}</span></div>
                        <div className="ub-summary-row"><span>Other Charges</span><span>{d.summary?.other || "₹0.00"}</span></div>
                        <div className="ub-summary-total">
                            <span>Total Amount</span>
                            <span>{totalAmountDisplay}</span>
                        </div>
                    </div>
                    {paymentUrl && (
                        <a
                            href={paymentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ub-pay-btn"
                        >
                            <CreditCard size={16} /> Pay Bill Online
                        </a>
                    )}
                    <button className="ub-download-btn" onClick={handleDownloadPDF}>
                        <Download size={16} /> Download Extracted Data
                    </button>
                    <button className="ub-predict-action-btn" onClick={handleGoToPredict} style={{
                        marginTop: "12px",
                        backgroundColor: "#6D4AFF",
                        color: "white",
                        padding: "10px 16px",
                        borderRadius: "8px",
                        border: "none",
                        fontWeight: "600",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                        cursor: "pointer",
                        width: "100%"
                    }}>
                        <Zap size={16} /> Predict Next Month Bill
                    </button>
                </div>
            </div>
        </>
    );
}
