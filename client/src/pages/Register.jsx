import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../services/api.js";

function Register({ setUser }) {
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    // ⚠️ لا نستخدم trim() أثناء الكتابة حتى لا نمنع المستخدم من كتابة
    // مسافة داخل اسم المستخدم أو كلمة المرور أثناء الإدخال
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) setError("");
  };

  const validateForm = () => {
    if (
      !formData.username.trim() ||
      !formData.email.trim() ||
      !formData.password ||
      !formData.confirmPassword
    ) {
      setError("جميع الحقول مطلوبة");
      return false;
    }

    const usernameRegex = /^[a-zA-Z0-9\u0600-\u06FF\s]{3,30}$/;
    if (!usernameRegex.test(formData.username.trim())) {
      setError("اسم المستخدم يجب أن يكون 3-30 حرفاً (أحرف وأرقام فقط)");
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email.trim())) {
      setError("البريد الإلكتروني غير صالح");
      return false;
    }

    if (formData.password.length < 8) {
      setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
      return false;
    }

    if (!/[A-Z]/.test(formData.password)) {
      setError("كلمة المرور يجب أن تحتوي على حرف كبير (A-Z)");
      return false;
    }

    if (!/[a-z]/.test(formData.password)) {
      setError("كلمة المرور يجب أن تحتوي على حرف صغير (a-z)");
      return false;
    }

    if (!/\d/.test(formData.password)) {
      setError("كلمة المرور يجب أن تحتوي على رقم");
      return false;
    }

    if (formData.password !== formData.confirmPassword) {
      setError("كلمتا المرور غير متطابقتين");
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
      const response = await api.post("/auth/register", {
        username: formData.username.trim(),
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
      });

      const { user } = response.data;
      if (!user) throw new Error("بيانات الاستجابة غير مكتملة");

      setUser(user);
      navigate("/", { replace: true });
    } catch (err) {
      console.error("Register error:", err);
      if (err.response?.status === 409) {
        setError("تعذر إنشاء الحساب بالبيانات المقدمة");
      } else if (err.response?.status === 400) {
        setError(err.response.data?.message || "بيانات غير صالحة");
      } else if (err.response?.status === 429) {
        setError("محاولات كثيرة. الرجاء المحاولة لاحقاً");
      } else if (err.response?.status === 500) {
        setError("خطأ في الخادم. الرجاء المحاولة لاحقاً");
      } else {
        setError("فشل إنشاء الحساب. تأكد من اتصالك بالإنترنت");
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
          <p>إنشاء حساب جديد</p>
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
            <label htmlFor="username">اسم المستخدم</label>
            <input
              type="text"
              id="username"
              name="username"
              value={formData.username}
              onChange={handleChange}
              placeholder="اسمك المستعار"
              autoComplete="username"
              required
              minLength="3"
              maxLength="30"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">البريد الإلكتروني</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="example@email.com"
              autoComplete="email"
              required
              maxLength="100"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">كلمة المرور</label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="8+ أحرف، حرف كبير وصغير ورقم"
              autoComplete="new-password"
              required
              minLength="8"
              maxLength="128"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">تأكيد كلمة المرور</label>
            <input
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="أعد كتابة كلمة المرور"
              autoComplete="new-password"
              required
              minLength="8"
              maxLength="128"
              disabled={loading}
            />
          </div>

          <button type="submit" className="auth-submit-btn" disabled={loading}>
            {loading ? "جاري إنشاء الحساب..." : "إنشاء الحساب"}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            لديك حساب بالفعل؟{" "}
            <Link to="/login" className="auth-link">
              تسجيل الدخول
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Register;
