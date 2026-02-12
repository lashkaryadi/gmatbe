// src/controllers/authController.js
import ParentProfile from "../models/ParentProfile.js";
import TeacherProfile from "../models/TeacherProfile.js";
import Institution from "../models/Institution.js";
import User from "../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { generateOTP, hashOTP, verifyOTP } from "../utils/otp.js";
import { sendEmailOTP, sendPasswordResetEmail } from "../utils/email.js";
import { generateSecureToken, hashToken } from "../utils/tokens.js";
import RefreshToken from "../models/RefreshToken.js";
import PasswordReset from "../models/PasswordReset.js";
import process from "process";

const OTP_EXPIRE_MS = 10 * 60 * 1000; // 10 minutes
const ACCESS_TOKEN_EXPIRES = "15m"; // short-lived access token
const REFRESH_EXPIRES_DAYS = 7; // refresh token lifetime
const JWT_SECRET = process.env.JWT_SECRET || "dev_fallback_secret";

if (!JWT_SECRET) console.warn("Warning: JWT_SECRET is not set in .env");

// ------------------ SIGNUP ------------------
export async function signup(req, res) {
  try {
    const { name, email, phone, password, role } = req.body;
    const allowedRoles = ["student", "tutor", "parent", "institute"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    if (!name || !email || !phone || !password || !role) {
      return res.status(400).json({ message: "All fields required" });
    }

    const exists = await User.findOne({ $or: [{ email }, { phone }] });
    if (exists)
      return res
        .status(400)
        .json({ message: "Email or phone already registered" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const emailOTP = generateOTP();
    const emailOTPHash = hashOTP(emailOTP);
    const expiry = Date.now() + OTP_EXPIRE_MS;

    let user = await User.create({
      name,
      email,
      phone,
      password: hashedPassword,
      role,
      emailOTPHash,
      emailOTPExpires: expiry,
    });

    // Initialize credits for tutors and institutes
    if (role === "tutor" || role === "institute") {
      user.credits = 5;
      await user.save();
    }

    // 🔥 AUTO-CREATE ROLE PROFILES
    if (role === "parent") {
      await ParentProfile.create({
        userId: user._id,
        childrenIds: [],
      });
    }

    if (role === "tutor") {
      await TeacherProfile.create({
        userId: user._id,
        isPublic: true,
      });
    }

    if (role === "institute") {
      await Institution.create({
        owner: user._id,

        institutionName: name,
        institutionType: "coaching",
      });
    }

    // DEV helper - prints OTP to server logs when not in production
    if (process.env.NODE_ENV !== "production") {
      console.log(`DEV OTP for ${email}: ${emailOTP}`);
    }

    await sendEmailOTP(email, emailOTP);


    return res.status(201).json({
      message:
        "Signup successful. Please verify your email OTP (check your email).",
      userId: user._id,
    });
  } catch (err) {
    console.error("signup error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// ------------------ VERIFY EMAIL ------------------
export async function verifyEmail(req, res) {
  try {
    const { email, otp } = req.body;
    if (!email || !otp)
      return res.status(400).json({ message: "Email and OTP required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.emailOTPHash || !user.emailOTPExpires)
      return res.status(400).json({ message: "No pending email OTP" });

    if (user.emailOTPExpires < Date.now())
      return res.status(400).json({ message: "Email OTP expired" });

    const ok = verifyOTP(otp, user.emailOTPHash);
    if (!ok) return res.status(400).json({ message: "Invalid OTP" });

    user.emailVerified = true;
    user.emailOTPHash = undefined;
    user.emailOTPExpires = undefined;
    await user.save();
    const accessToken = jwt.sign(
      { id: user._id.toString(), role: user.role },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRES }
    );
    return res.json({
      message: "Email verified successfully",
      accessToken,
      user: {
        id: user._id,
        role: user.role,
        email: user.email,
        phone: user.phone,
      },
    });
  } catch (err) {
    console.error("verifyEmail error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}
// ------------------ RESEND EMAIL OTP ------------------
export async function resendEmailOTP(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.emailVerified)
      return res.status(400).json({ message: "Email already verified" });

    const otp = generateOTP();
    user.emailOTPHash = hashOTP(otp);
    user.emailOTPExpires = Date.now() + OTP_EXPIRE_MS;
    await user.save();

    if (process.env.NODE_ENV !== "production")
      console.log(`DEV resend OTP for ${email}: ${otp}`);

    try {
      await sendEmailOTP(email, otp);
    } catch (err) {
      console.error("resendEmailOTP: email send failed", err?.message || err);
    }

    return res.json({ message: "OTP resent to email (if email exists)." });
  } catch (err) {
    console.error("resendEmailOTP error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// ------------------ LOGIN (issue access + refresh token) ------------------
export async function login(req, res) {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password)
      return res
        .status(400)
        .json({ message: "Provide identifier and password" });

    const user = await User.findOne({
      $or: [{ email: identifier }, { phone: identifier }],
    });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(401).json({ message: "Invalid credentials" });

    if (!user.emailVerified)
      return res
        .status(403)
        .json({ message: "Please verify your email before logging in" });

    user.lastLoginAt = new Date();
    await user.save();

    // access token (short-lived)
    const accessToken = jwt.sign(
      { id: user._id.toString(), role: user.role },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRES }
    );

    // refresh token (raw) -> hashed stored in DB
    const rawRefresh = generateSecureToken(32);
    const refreshHash = hashToken(rawRefresh);
    const expiresAt = new Date(
      Date.now() + REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000
    );

    await RefreshToken.create({
      user: user._id,
      tokenHash: refreshHash,
      expiresAt,
      revoked: false,
    });

    return res.json({
      message: "Login successful",
      accessToken,
      refreshToken: rawRefresh,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// ------------------ REFRESH (rotate refresh token) ------------------
export async function refreshToken(req, res) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(400).json({ message: "Refresh token required" });

    const hashed = hashToken(refreshToken);
    const stored = await RefreshToken.findOne({ tokenHash: hashed });

    if (!stored || stored.revoked)
      return res.status(401).json({ message: "Invalid refresh token" });
    if (stored.expiresAt < Date.now())
      return res.status(401).json({ message: "Refresh token expired" });

    // rotate: revoke old and create new
    const newRaw = generateSecureToken(32);
    const newHash = hashToken(newRaw);
    const newExpiresAt = new Date(
      Date.now() + REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000
    );

    stored.revoked = true;
    stored.replacedByHash = newHash;
    await stored.save();

    await RefreshToken.create({
      user: stored.user,
      tokenHash: newHash,
      expiresAt: newExpiresAt,
    });

    const user = await User.findById(stored.user);
    const accessToken = jwt.sign(
      { id: user._id.toString(), role: user.role },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRES }
    );

    return res.json({ accessToken, refreshToken: newRaw });
  } catch (err) {
    console.error("refreshToken error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// ------------------ LOGOUT (revoke refresh token) ------------------
export async function logout(req, res) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(400).json({ message: "Refresh token required" });

    const hashed = hashToken(refreshToken);
    const stored = await RefreshToken.findOne({ tokenHash: hashed });
    if (stored) {
      stored.revoked = true;
      await stored.save();
    }
    return res.json({ message: "Logged out" });
  } catch (err) {
    console.error("logout error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// ------------------ FORGOT PASSWORD ------------------
export async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    const user = await User.findOne({ email });
    // don't leak whether email exists
    if (!user)
      return res
        .status(200)
        .json({ message: "If the email exists, a reset link has been sent." });

    const raw = generateSecureToken(32);
    const tokenHash = hashToken(raw);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await PasswordReset.create({ user: user._id, tokenHash, expiresAt });

    const resetUrl = `${
      process.env.FRONTEND_URL || "http://localhost:3000"
    }/reset-password?token=${raw}&email=${encodeURIComponent(email)}`;

    try {
      await sendPasswordResetEmail(email, resetUrl);
    } catch (err) {
      console.error("sendPasswordResetEmail failed:", err);
    }

    return res.json({
      message: "If the email exists, a reset link has been sent.",
    });
  } catch (err) {
    console.error("forgotPassword error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// ------------------ RESET PASSWORD ------------------
export async function resetPassword(req, res) {
  try {
    const { email, token, newPassword } = req.body;
    if (!email || !token || !newPassword)
      return res
        .status(400)
        .json({ message: "Email, token and newPassword required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid request" });

    const tokenHash = hashToken(token);
    const pr = await PasswordReset.findOne({
      user: user._id,
      tokenHash,
      used: false,
    });
    if (!pr) return res.status(400).json({ message: "Invalid or used token" });
    if (pr.expiresAt < Date.now())
      return res.status(400).json({ message: "Token expired" });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    pr.used = true;
    await pr.save();

    // revoke all existing refresh tokens for this user
    await RefreshToken.updateMany(
      { user: user._id },
      { $set: { revoked: true } }
    );

    return res.json({ message: "Password reset successful" });
  } catch (err) {
    console.error("resetPassword error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}


// ------------------ GET USER INFO (for credits) ------------------
export async function getMe(req, res) {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    
    const user = await User.findById(req.user._id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        credits: user.credits,
      },
      credits: user?.credits ?? 0
    });
  } catch (err) {
    console.error('getMe error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}


// ------------------ GET USER BY ID (for credits) ------------------
export async function getUserById(req, res) {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        credits: user.credits,
      },
      credits: user?.credits ?? 0
    });
  } catch (err) {
    console.error('getUserById error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}
