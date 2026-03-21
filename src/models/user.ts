export interface User {
  id: string;
  email: string;
  username: string;
  full_name: string | null;
  password_hash: string;
  avatar_color: string;
  account_balance: string;
  created_at: Date;
}

export interface RefreshToken {
  id: string;
  user_id: string;
  token: string;
  expires_at: Date;
  created_at: Date;
}

export interface Friendship {
  id: string;
  user_id: string;
  friend_id: string;
  status: 'pending' | 'accepted';
  created_at: Date;
}

export interface RegisterRequest {
  email: string;
  password: string;
  username: string;
  full_name?: string;
  avatar_color?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthTokenPayload {
  userId: string;
  email: string;
}

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  full_name: string | null;
  avatar_color: string;
  account_balance: string;
  created_at: Date;
}

export interface FriendProfile {
  id: string;
  username: string;
  full_name: string | null;
  avatar_color: string;
  account_balance: string;
}
