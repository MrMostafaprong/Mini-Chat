import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../services/api.js";

function Login({ setUser }) {
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    // ⚠️ لا نستخدم trim() أثناء الكتابة حتى لا نمنع المستخدم من كتابة
    // مسافة داخل كلمة المرور أو في نهايتها أثناء الإدخال
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) setError("");
  };

  const validateForm = () => {
    if (!formData.email.trim() || !formData.password) {
      setError("جميع الحقول مطلوبة");
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email.trim())) {
      setError("البريد الإلكتروني غير صالح");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setLoading(true);
    setError("");

    try {
      const response = await api.post("/auth/login", {
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
      });

      const { user } = response.data;
      if (!user) throw new Error("بيانات الاستجابة غير مكتملة");

      setUser(user);
      navigate("/", { replace: true });
    } catch (err) {
      console.error("Login error:", err);
      if (err.response?.status === 401) {
        setError("البريد الإلكتروني أو كلمة المرور غير صحيحة");
      } else if (err.response?.status === 429) {
        setError("محاولات كثيرة. الرجاء المحاولة لاحقاً");
      } else if (err.response?.status === 500) {
        setError("خطأ في الخادم. الرجاء المحاولة لاحقاً");
      } else {
        setError("فشل تسجيل الدخول. تأكد من اتصالك بالإنترنت");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-header">
          <div className="auth-logo">💬</div>
          <h1>MiniChat</h1>
          <p>تسجيل الدخول إلى حسابك</p>
        </div>

        {error && (
          <div className="auth-error" role="alert">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="form-group">
            <label htmlFor="email">البريد الإلكتروني</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="example@email.com"
              autoComplete="username email"
              required
              maxLength="100"
              disabled={loading}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck="false"
            />
          </div>

          <div className="form-group">
            <label htmlFor="login-password">كلمة المرور</label>
            <input
              type="password"
              id="login-password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              minLength="6"
              maxLength="128"
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={loading}
          >
            {loading ? "جاري تسجيل الدخول..." : "تسجيل الدخول"}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            ليس لديك حساب؟{" "}
            <Link to="/register" className="auth-link">
              إنشاء حساب جديد
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;