import { useState } from 'react';
import { Link } from 'react-router-dom';
import '../styles/auth.css';
import axios from 'axios';
import { useNavigate } from 'react-router-dom'


export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setError] = useState('');
  const navigator = useNavigate();
  
  async function handleSubmit(e) {
    e.preventDefault();
    
    // Replace with your actual login logic
    try{
      setLoading(true);
    
      const res = await axios.post(
        "/api/auth/login",
        {
          email: email,
          password: password,
        }
      );
  
      localStorage.setItem("token", res.data.token);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      if (res.data.profileData) {
          localStorage.setItem("profileData", JSON.stringify(res.data.profileData));
      }
      navigator("/uploadbill");
    } catch (err) {
      setError(
        err.response?.data?.message || "Something went wrong"
      );
    } finally {
      setLoading(false);
    }
      
    // setTimeout(() => {
    //   setLoading(false);
    //   alert('Login logic goes here!');
    // }, 1500);
  }

  return (
    <div className="page">

      <div className="brand">
        <Link to="/">Tejas Cyber Solution</Link>
      </div>

      <div className="card">
        <h1>Log in</h1>
        <p className="subtitle">Welcome back. Enter your details below.</p>

        <form onSubmit={handleSubmit} className="form">

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">
              Password
              <Link to="/forgot-password" className="label-link">Forgot password?</Link>
            </label>
            <input
              id="password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="check-row">
            <input
              type="checkbox"
              id="remember"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <label htmlFor="remember">Keep me logged in</label>
          </div>

          <button type="submit" className="btn-submit" disabled={loading}>
            {loading ? 'Logging in…' : 'Log In'}
          </button>

          {err && <p className="error-msg">{err}</p>}

        </form>

        <p className="switch">
          Don't have an account? <Link to="/signup">Sign up</Link>
        </p>
      </div>

    </div>
  );
}