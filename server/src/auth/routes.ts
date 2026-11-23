import { Prisma } from "@prisma/client";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { badRequest, conflict, unauthorized } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  clearSessionCookie,
  createSession,
  revokeSession,
  setSessionCookie,
  type SessionUser,
} from "./session.js";

const registerSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Email không hợp lệ").max(254),
    displayName: z
      .string()
      .trim()
      .min(2, "Tên hiển thị tối thiểu 2 ký tự")
      .max(50, "Tên hiển thị tối đa 50 ký tự"),
    password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự").max(128),
  })
  .strict();

const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Email không hợp lệ").max(254),
    password: z.string().min(1).max(128),
  })
  .strict();

const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.AUTH_RATE_LIMIT_PER_MIN,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Quá nhiều yêu cầu, vui lòng thử lại sau",
      },
    });
  },
});

function userDto(user: SessionUser) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}

export const authRouter = Router();

authRouter.post("/register", authLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("VALIDATION_ERROR", "Dữ liệu đăng ký không hợp lệ", z.treeifyError(parsed.error));
  }

  const { email, displayName, password } = parsed.data;
  const passwordHash = await hashPassword(password);

  let user;
  try {
    user = await prisma.user.create({
      data: { email, displayName, passwordHash },
      select: { id: true, email: true, displayName: true, createdAt: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict("EMAIL_TAKEN", "Email đã được sử dụng");
    }
    throw error;
  }

  const token = await createSession(user.id);
  setSessionCookie(res, token);
  res.status(201).json({ user: userDto(user) });
});

authRouter.post("/login", authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest("VALIDATION_ERROR", "Dữ liệu đăng nhập không hợp lệ");
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(user.passwordHash, password) : false;
  if (!user || !valid) {
    throw unauthorized("Email hoặc mật khẩu không đúng");
  }

  const token = await createSession(user.id);
  setSessionCookie(res, token);
  res.status(200).json({ user: userDto(user) });
});

authRouter.post("/logout", async (req, res) => {
  if (req.sessionId) {
    await revokeSession(req.sessionId);
  }
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/me", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ user: req.user ? userDto(req.user) : null });
});
