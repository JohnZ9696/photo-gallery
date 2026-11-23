import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiClientError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Mật khẩu xác nhận không khớp");
      return;
    }
    if (password.length < 8) {
      setError("Mật khẩu cần ít nhất 8 ký tự");
      return;
    }

    setSubmitting(true);
    try {
      await register(email, displayName, password);
      navigate("/", { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : "Không tạo được tài khoản, vui lòng thử lại",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-visual auth-visual-alt">
        <div className="auth-visual-inner">
          <div className="wordmark">
            <span className="wordmark-mark">L</span>
            <span>Lumina</span>
          </div>
          <h1>Một tài khoản. Một thư viện chung.</h1>
          <p>
            Ảnh của bạn được chuẩn hóa, tạo các kích thước phù hợp và lưu trữ
            trên SeaweedFS. Mọi người có thể xem, bạn giữ quyền chỉnh sửa.
          </p>
          <div className="auth-art auth-art-register" aria-hidden="true">
            <div className="art-tile art-tile-1" />
            <div className="art-tile art-tile-2" />
            <div className="art-tile art-tile-3" />
            <div className="art-note">create · share · remix</div>
          </div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">Bắt đầu</p>
          <h2>Tạo tài khoản</h2>
          <p className="muted">Chỉ mất một phút để có album riêng.</p>

          <form onSubmit={onSubmit} className="stack">
            <label>
              Tên hiển thị
              <input
                required
                minLength={2}
                maxLength={50}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Nguyễn An"
              />
            </label>
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
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Ít nhất 8 ký tự"
              />
            </label>
            <label>
              Nhập lại mật khẩu
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="••••••••"
              />
            </label>

            {error ? <p className="form-error">{error}</p> : null}

            <button className="btn btn-primary btn-wide" disabled={submitting}>
              {submitting ? "Đang tạo…" : "Tạo tài khoản"}
            </button>
          </form>

          <p className="auth-switch">
            Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
