import { Link } from 'react-router-dom';
import '../styles/Landings.css';
import { User, Rocket, ArrowRight, Plug, BarChart3, Lightbulb, Zap } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="landing-page-root">
      {/* HEADER / NAVIGATION */}
      <header className="landing-header">
        <div className="container nav">
          <div className="logo">
            <img className="logo-pic" src="/logo.png" alt="Tejyash Cyber Solutions" />
          </div>
          <div className="nav-links">
            <Link to="/login" className="nav-login-link">Login</Link>
            <Link to="/signup" className="btn-primary-nav">
              <User size={16} />
              <span>Sign Up</span>
            </Link>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main>
        {/* HERO SECTION */}
        <section className="hero container">
          <div className="hero-content">
            <h1 className="hero-title">
              Track Your Electricity.<br />
              <span className="hero-highlight">
                Reduce Your Bills.
                <svg className="hero-underline-svg" viewBox="0 0 280 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 12C70 4 195 3 275 10" stroke="#16a34a" strokeWidth="5" strokeLinecap="round" />
                </svg>
              </span>
            </h1>

            <p className="hero-desc">
              EnergyTrack helps you monitor appliance-wise electricity consumption,
              spot wastage, and take action — all from one simple dashboard.
            </p>

            <div className="hero-actions">
              <Link to="/signup" className="btn-hero-primary">
                <Rocket size={18} />
                <span>Get Started</span>
                <ArrowRight size={17} />
              </Link>
              <Link to="/login" className="btn-hero-secondary">
                <User size={18} />
                <span>Log In</span>
              </Link>
            </div>
          </div>

          <div className="hero-image-wrapper">
            <img 
              src="/hero-illustration.png" 
              alt="Smart electricity monitoring with solar and consumption tracking" 
              className="hero-illustration-img" 
            />
          </div>
        </section>

        {/* 3 FEATURE CARDS */}
        <section className="features-section container">
          {/* Card 1: Appliance Monitoring */}
          <div className="feature-card feature-green">
            <div className="card-blob blob-green"></div>
            <div className="card-inner">
              <div className="feature-icon-badge badge-green">
                <Plug size={24} />
              </div>
              <h3 className="card-title">Appliance Monitoring</h3>
              <p className="card-desc">See exactly how much each appliance in your home is consuming.</p>
            </div>
          </div>

          {/* Card 2: Usage Reports */}
          <div className="feature-card feature-blue">
            <div className="card-blob blob-blue"></div>
            <div className="card-inner">
              <div className="feature-icon-badge badge-blue">
                <BarChart3 size={24} />
              </div>
              <h3 className="card-title">Usage Reports</h3>
              <p className="card-desc">Daily and monthly breakdowns to understand your energy patterns.</p>
            </div>
          </div>

          {/* Card 3: Smart Suggestions */}
          <div className="feature-card feature-amber">
            <div className="card-blob blob-amber"></div>
            <div className="card-inner">
              <div className="feature-icon-badge badge-amber">
                <Lightbulb size={24} />
              </div>
              <h3 className="card-title">Smart Suggestions</h3>
              <p className="card-desc">Get tips on when and how to use appliances more efficiently.</p>
            </div>
          </div>
        </section>

        {/* BOTTOM MOTTO DIVIDER */}
        <div className="landing-bottom-bar">
          <div className="leaf-icon-wrapper">
            <Zap size={22} className="leaf-svg" />
          </div>
          <div className="divider-text-wrap">
            <span className="divider-line"></span>
            <span className="divider-text">Track Consumption &nbsp;•&nbsp; Predict Bills &nbsp;•&nbsp; Reduce Costs</span>
            <span className="divider-line"></span>
          </div>
        </div>
      </main>

      {/* BOTTOM SOFT WAVES */}
      <div className="bottom-wave-container">
        <svg viewBox="0 0 1440 100" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" className="bottom-wave-svg">
          <path d="M0,45 C280,85 520,15 820,50 C1120,85 1300,25 1440,40 L1440,100 L0,100 Z" fill="#dcfce7" fillOpacity="0.45"/>
          <path d="M0,65 C340,30 620,85 980,45 C1220,15 1360,65 1440,55 L1440,100 L0,100 Z" fill="#bbf7d0" fillOpacity="0.35"/>
        </svg>
      </div>
    </div>
  );
}