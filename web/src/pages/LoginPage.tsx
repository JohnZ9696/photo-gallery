import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiClientError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
      const from = (location.state as { from?: string } | null)?.from || "/";
      navigate(from, { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : "Không đăng nhập được, vui lòng thử lại",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-visual">
        <div className="auth-visual-inner">
          <div className="wordmark">
            <span className="wordmark-mark">L</span>
            <span>Lumina</span>
          </div>
          <h1>Những khoảnh khắc, được nhìn lại.</h1>
          <p>
            Một album chung cho mọi người. Tải ảnh, tạo phiên bản responsive và
            chỉnh sửa ngay trong trình duyệt.
          </p>
          <div className="auth-art" aria-hidden="true">
            <div className="art-tile art-tile-1" />
            <div className="art-tile art-tile-2" />
            <div className="art-tile art-tile-3" />
            <div className="art-note">shared archive · 2026</div>
          </div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">Chào mừng trở lại</p>
          <h2>Đăng nhập</h2>
          <p className="muted">Xem ảnh của bạn và ảnh từ những người khác.</p>

          <form onSubmit={onSubmit} className="stack">
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="ban@example.com"
              />
            </label>
            <label>
              Mật khẩu
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </label>

            {error ? <p className="form-error">{error}</p> : null}

            <button className="btn btn-primary btn-wide" disabled={submitting}>
              {submitting ? "Đang đăng nhập…" : "Đăng nhập"}
            </button>
          </form>

          <p className="auth-switch">
            Chưa có tài khoản? <Link to="/register">Tạo tài khoản</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
