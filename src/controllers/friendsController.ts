import { Response } from 'express';
import pool from '../db/pool';
import type { AuthenticatedRequest } from '../middleware/authenticateToken';
import type { FriendProfile } from '../models/user';

export async function sendFriendRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { username } = req.body as { username?: string };
  const requesterId = req.user?.userId;

  if (!username) {
    res.status(400).json({ message: 'username is required' });
    return;
  }

  const targetResult = await pool.query(
    'SELECT id FROM users WHERE username = $1',
    [username]
  );

  if ((targetResult.rowCount ?? 0) === 0) {
    res.status(404).json({ message: 'User not found' });
    return;
  }

  const targetId: string = targetResult.rows[0].id;

  if (targetId === requesterId) {
    res.status(400).json({ message: 'Cannot send a friend request to yourself' });
    return;
  }

  const existing = await pool.query(
    `SELECT id, status FROM friendships
     WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
    [requesterId, targetId]
  );

  if ((existing.rowCount ?? 0) > 0) {
    const row = existing.rows[0];
    const msg = row.status === 'accepted' ? 'Already friends' : 'Friend request already sent';
    res.status(400).json({ message: msg });
    return;
  }

  await pool.query(
    'INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2)',
    [requesterId, targetId]
  );

  res.status(201).json({ message: 'Friend request sent' });
}

export async function getFriends(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.userId;

  const result = await pool.query<FriendProfile>(
    `SELECT u.id, u.username, u.full_name, u.avatar_color, u.account_balance
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
     WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'`,
    [userId]
  );

  res.status(200).json({ friends: result.rows });
}

export async function getFriendRequests(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user?.userId;

  const result = await pool.query<{ request_id: string } & FriendProfile>(
    `SELECT f.id AS request_id, u.id, u.username, u.full_name, u.avatar_color
     FROM friendships f
     JOIN users u ON u.id = f.user_id
     WHERE f.friend_id = $1 AND f.status = 'pending'`,
    [userId]
  );

  res.status(200).json({ requests: result.rows });
}

export async function respondToFriendRequest(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id } = req.params;
  const { action } = req.body as { action?: string };
  const userId = req.user?.userId;

  if (action !== 'accept' && action !== 'decline') {
    res.status(400).json({ message: "action must be 'accept' or 'decline'" });
    return;
  }

  const result = await pool.query(
    'SELECT id FROM friendships WHERE id = $1 AND friend_id = $2 AND status = $3',
    [id, userId, 'pending']
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ message: 'Friend request not found' });
    return;
  }

  if (action === 'accept') {
    await pool.query("UPDATE friendships SET status = 'accepted' WHERE id = $1", [id]);
    res.status(200).json({ message: 'Friend request accepted' });
  } else {
    await pool.query('DELETE FROM friendships WHERE id = $1', [id]);
    res.status(200).json({ message: 'Friend request declined' });
  }
}

export async function unfriend(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { id: friendUserId } = req.params;
  const userId = req.user?.userId;

  const result = await pool.query(
    `DELETE FROM friendships
     WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
       AND status = 'accepted'`,
    [userId, friendUserId]
  );

  if ((result.rowCount ?? 0) === 0) {
    res.status(404).json({ message: 'Friendship not found' });
    return;
  }

  res.status(200).json({ message: 'Unfriended successfully' });
}
