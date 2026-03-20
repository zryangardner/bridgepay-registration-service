import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db/pool';
import type { RegisterRequest, LoginRequest, AuthTokenPayload } from '../models/user';

const SALT_ROUNDS = 12;

function issueAccessToken(payload: AuthTokenPayload): string {
  const { userId, email } = payload;
  const expiresIn = (process.env['ACCESS_TOKEN_EXPIRY'] ?? '15m') as jwt.SignOptions['expiresIn'] & string;
  return jwt.sign({ userId, email }, process.env['JWT_ACCESS_SECRET'] as string, { expiresIn });
}

function issueRefreshToken(payload: AuthTokenPayload): string {
  const { userId, email } = payload;
  const expiresIn = (process.env['REFRESH_TOKEN_EXPIRY'] ?? '7d') as jwt.SignOptions['expiresIn'] & string;
  return jwt.sign({ userId, email }, process.env['JWT_REFRESH_SECRET'] as string, { expiresIn });
}

// Parses formats like "7d", "24h", "30m" into a future Date
function refreshTokenExpiresAt(): Date {
  const expiry = process.env['REFRESH_TOKEN_EXPIRY'] ?? '7d';
  const match = /^(\d+)([dhm])$/.exec(expiry);
  const amount = match ? parseInt(match[1] as string, 10) : 7;
  const unit = match ? (match[2] as string) : 'd';
  const ms = unit === 'h' ? amount * 3_600_000 : unit === 'm' ? amount * 60_000 : amount * 86_400_000;
  return new Date(Date.now() + ms);
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export async function register(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as RegisterRequest;

  if (!email || !password) {
    res.status(400).json({ message: 'Email and password are required' });
    return;
  }

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if ((existing.rowCount ?? 0) > 0) {
    res.status(400).json({ message: 'Email already registered' });
    return;
  }

  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

  const result = await pool.query(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
    [email, password_hash]
  );

  const user = result.rows[0];
  const payload: AuthTokenPayload = { userId: user.id, email: user.email };

  const accessToken = issueAccessToken(payload);
  const refreshToken = issueRefreshToken(payload);

  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [user.id, refreshToken, refreshTokenExpiresAt()]
  );

  setRefreshCookie(res, refreshToken);

  res.status(201).json({ accessToken, user: { id: user.id, email: user.email, created_at: user.created_at } });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as LoginRequest;

  if (!email || !password) {
    res.status(400).json({ message: 'Email and password are required' });
    return;
  }

  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = result.rows[0];

  if (!user) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  const payload: AuthTokenPayload = { userId: user.id, email: user.email };

  const accessToken = issueAccessToken(payload);
  const refreshToken = issueRefreshToken(payload);

  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [user.id, refreshToken, refreshTokenExpiresAt()]
  );

  setRefreshCookie(res, refreshToken);

  res.status(200).json({ accessToken, user: { id: user.id, email: user.email } });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const token = req.cookies['refreshToken'] as string | undefined;

  if (!token) {
    res.status(401).json({ message: 'No refresh token' });
    return;
  }

  let payload: AuthTokenPayload;
  try {
    payload = jwt.verify(token, process.env['JWT_REFRESH_SECRET'] as string) as AuthTokenPayload;
  } catch {
    res.status(401).json({ message: 'Invalid or expired refresh token' });
    return;
  }

  const stored = await pool.query(
    'SELECT id FROM refresh_tokens WHERE token = $1 AND user_id = $2',
    [token, payload.userId]
  );

  if ((stored.rowCount ?? 0) === 0) {
    res.status(401).json({ message: 'Refresh token revoked' });
    return;
  }

  // Rotate: delete old, issue new
  await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [token]);

  const newRefreshToken = issueRefreshToken(payload);
  const newAccessToken = issueAccessToken(payload);

  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [payload.userId, newRefreshToken, refreshTokenExpiresAt()]
  );

  setRefreshCookie(res, newRefreshToken);

  res.status(200).json({ accessToken: newAccessToken });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token = req.cookies['refreshToken'] as string | undefined;

  if (token) {
    await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [token]);
  }

  res.clearCookie('refreshToken', { httpOnly: true, sameSite: 'strict' });
  res.status(200).json({ message: 'Logged out' });
}
