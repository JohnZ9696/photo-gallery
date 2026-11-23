import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout().catch(() => undefined);
    navigate("/login", { replace: true });
  };

  return (
    <header className="site-header">
      <Link className="wordmark wordmark-small" to="/">
        <span className="wordmark-mark">L</span>
        <span>Lumina</span>
      </Link>

      <div className="header-right">
        {user ? (
          <>
            <div className="user-chip" title={user.email}>
              <span className="user-avatar">
                {user.displayName.trim().charAt(0).toUpperCase() || "U"}
              </span>
              <span className="user-name">{user.displayName}</span>
            </div>
            <button className="btn btn-ghost" onClick={onLogout}>
              Đăng xuất
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}
