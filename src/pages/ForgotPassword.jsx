import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import '../styles/auth.css';
import { KeyRound, Mail, Lock, CheckCircle2, ArrowLeft, RefreshCw, Eye, EyeOff } from 'lucide-react';

export default function ForgotPassword() {
  const [step, setStep] = useState(1); // 1: Email, 2: Code & New Password, 3: Success
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [devCode, setDevCode] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState(null);
  const navigate = useNavigate();

  // Step 1: Request Password Reset Code
  const handleRequestCode = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setEmailError(null);

    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }

    try {
      setLoading(true);
      const res = await axios.post('/api/auth/forgot-password', { email: email.trim() });
      
      setCode(''); // Keep input empty so user enters the code sent to their email
      if (res.data.code) {
        setDevCode(res.data.code);
      }
      
      setEmailSent(!!res.data.emailSent);
      setEmailError(res.data.emailError || null);
      setSuccessMsg(res.data.message || 'Reset code generated successfully!');
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to find account or send reset code.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Submit Code & Reset Password
  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!code.trim()) {
      setError('Please enter the 6-digit verification code.');
      return;
    }

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      setLoading(true);
      const res = await axios.post('/api/auth/reset-password', {
        email: email.trim(),
        code: code.trim(),
        newPassword: newPassword,
      });

      setSuccessMsg(res.data.message || 'Password reset successfully!');
      setStep(3);
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid or expired code. Please check and try again.');
    } finally {
      setLoading(false);
    }
  };

  // Resend Code
  const handleResendCode = async () => {
    setError('');
    try {
      setLoading(true);
      const res = await axios.post('/api/auth/forgot-password', { email: email.trim() });
      setCode('');
      if (res.data.code) {
        setDevCode(res.data.code);
      }
      setEmailSent(!!res.data.emailSent);
      setEmailError(res.data.emailError || null);
      setSuccessMsg('A new verification code has been generated!');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to resend code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="brand">
        <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}>
          <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#2563eb' }}>⚡ Electricity Analyser</span>
        </Link>
      </div>

      <div className="card">
        {step === 1 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <div style={{ background: '#eff6ff', padding: '8px', borderRadius: '8px', color: '#2563eb' }}>
                <KeyRound size={22} />
              </div>
              <h1 style={{ margin: 0, fontSize: '1.35rem' }}>Forgot Password</h1>
            </div>
            <p className="subtitle">
              Enter your registered email address and we'll generate a verification code to reset your password.
            </p>

            <form onSubmit={handleRequestCode} className="form">
              <div className="field">
                <label htmlFor="email">Email Address</label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    style={{ paddingLeft: '36px' }}
                  />
                  <Mail
                    size={18}
                    style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }}
                  />
                </div>
              </div>

              {error && <p className="error-msg">{error}</p>}

              <button type="submit" className="btn-submit" disabled={loading}>
                {loading ? 'Generating Code...' : 'Send Reset Code'}
              </button>
            </form>
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <div style={{ background: '#eff6ff', padding: '8px', borderRadius: '8px', color: '#2563eb' }}>
                <Lock size={22} />
              </div>
              <h1 style={{ margin: 0, fontSize: '1.35rem' }}>Reset Password</h1>
            </div>
            <p className="subtitle">
              Enter the 6-digit code for <strong>{email}</strong> and set your new password.
            </p>

            {emailSent ? (
              <div style={{
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '8px',
                padding: '10px 14px',
                marginBottom: '16px',
                fontSize: '0.88rem',
                color: '#1e40af'
              }}>
                ✉️ A 6-digit verification code has been sent to your email address.
              </div>
            ) : null}

            <form onSubmit={handleResetPassword} className="form">
              <div className="field">
                <label htmlFor="code">
                  <span>6-Digit Verification Code</span>
                  <button
                    type="button"
                    onClick={handleResendCode}
                    style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <RefreshCw size={12} /> Resend code
                  </button>
                </label>
                <input
                  id="code"
                  type="text"
                  placeholder="e.g. 123456"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  required
                  style={{ letterSpacing: '4px', textAlign: 'center', fontSize: '1.1rem', fontWeight: 600 }}
                />
              </div>

              <div className="field">
                <label htmlFor="newPassword">New Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="newPassword"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="At least 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={8}
                    required
                    style={{ paddingRight: '36px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: '#9ca3af',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="field">
                <label htmlFor="confirmPassword">Confirm New Password</label>
                <input
                  id="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              {error && <p className="error-msg">{error}</p>}
              {successMsg && !error && (
                <div style={{
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  fontSize: '0.85rem',
                  color: '#166534'
                }}>
                  {successMsg}
                </div>
              )}

              <button type="submit" className="btn-submit" disabled={loading}>
                {loading ? 'Updating Password...' : 'Save New Password'}
              </button>
            </form>
          </>
        )}

        {step === 3 && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: '#dcfce7',
              color: '#16a34a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px'
            }}>
              <CheckCircle2 size={32} />
            </div>
            <h1 style={{ fontSize: '1.4rem', marginBottom: '8px' }}>Password Reset Complete</h1>
            <p className="subtitle" style={{ marginBottom: '24px' }}>
              Your password has been successfully updated. You can now log in using your new credentials.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="btn-submit"
              style={{ display: 'inline-block', width: '100%' }}
            >
              Back to Login
            </button>
          </div>
        )}

        {step !== 3 && (
          <p className="switch" style={{ marginTop: '24px' }}>
            <Link to="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <ArrowLeft size={16} /> Back to Log In
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
