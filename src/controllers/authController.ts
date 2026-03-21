import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db/pool';
import type { RegisterRequest, LoginRequest, AuthTokenPayload, PublicUser } from '../models/user';
import type { AuthenticatedRequest } from '../middleware/authenticateToken';

const SALT_ROUNDS = 12;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

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

function toPublicUser(user: PublicUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    full_name: user.full_name,
    avatar_color: user.avatar_color,
    account_balance: user.account_balance,
    created_at: user.created_at,
  };
}

export async function register(req: Request, res: Response): Promise<void> {
  const { email, password, username, full_name, avatar_color } = req.body as RegisterRequest;

  if (!email || !password || !username) {
    res.status(400).json({ message: 'Email, password, and username are required' });
    return;
  }

  if (!USERNAME_RE.test(username)) {
    res.status(400).json({ message: 'Username must be 3-20 characters and contain only letters, numbers, or underscores' });
    return;
  }

  const existing = await pool.query(
    'SELECT id FROM users WHERE email = $1 OR username = $2',
    [email, username]
  );
  if ((existing.rowCount ?? 0) > 0) {
    res.status(400).json({ message: 'Email or username already taken' });
    return;
  }

  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  const color = avatar_color ?? 'ocean';

  const result = await pool.query(
    `INSERT INTO users (email, username, full_name, password_hash, avatar_color)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, username, full_name, avatar_color, account_balance, created_at`,
    [email, username, full_name ?? null, password_hash, color]
  );

  const user = result.rows[0] as PublicUser;
  const payload: AuthTokenPayload = { userId: user.id, email: user.email };

  const accessToken = issueAccessToken(payload);
  const refreshToken = issueRefreshToken(payload);

  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [user.id, refreshToken, refreshTokenExpiresAt()]
  );

  setRefreshCookie(res, refreshToken);

  res.status(201).json({ accessToken, user: toPublicUser(user) });
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

  res.status(200).json({ accessToken, user: toPublicUser(user as PublicUser) });
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

export async function getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  const result = await pool.query(
    'SELECT id, email, username, full_name, avatar_color, account_balance, created_at FROM users WHERE id = $1',
    [req.user?.userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ message: 'User not found' });
    return;
  }

  res.status(200).json({ user: toPublicUser(result.rows[0] as PublicUser) });
}

export async function updateMe(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { username, full_name, avatar_color } = req.body as Partial<Pick<PublicUser, 'username' | 'full_name' | 'avatar_color'>>;

  if (username !== undefined && !USERNAME_RE.test(username)) {
    res.status(400).json({ message: 'Username must be 3-20 characters and contain only letters, numbers, or underscores' });
    return;
  }

  if (username !== undefined) {
    const taken = await pool.query(
      'SELECT id FROM users WHERE username = $1 AND id != $2',
      [username, req.user?.userId]
    );
    if ((taken.rowCount ?? 0) > 0) {
      res.status(400).json({ message: 'Username already taken' });
      return;
    }
  }

  const result = await pool.query(
    `UPDATE users
     SET username      = COALESCE($1, username),
         full_name     = COALESCE($2, full_name),
         avatar_color  = COALESCE($3, avatar_color)
     WHERE id = $4
     RETURNING id, email, username, full_name, avatar_color, account_balance, created_at`,
    [username ?? null, full_name ?? null, avatar_color ?? null, req.user?.userId]
  );

  res.status(200).json({ user: toPublicUser(result.rows[0] as PublicUser) });
}

export async function searchUsers(req: AuthenticatedRequest, res: Response): Promise<void> {
  const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : '';

  if (!q) {
    res.status(400).json({ message: 'Query parameter q is required' });
    return;
  }

  const result = await pool.query(
    `SELECT id, username, full_name, avatar_color
     FROM users
     WHERE id != $1 AND (username ILIKE $2 OR full_name ILIKE $2)
     LIMIT 10`,
    [req.user?.userId, `%${q}%`]
  );

  res.status(200).json({ users: result.rows });
}
