export type Role = 'user' | 'admin';
export type AccountStatus = 'active' | 'blocked';
export type LicenseStatus = 'active' | 'expired' | 'suspended' | 'canceled' | 'blocked';

export interface License {
  status: LicenseStatus;
  plan: string;
  expiresAt: string | null;
  features: string[];
  updatedAt: string;
}

export interface Account {
  id: string;
  display: string;
  email: string;
  status: AccountStatus;
  role: Role;
  createdAt: string;
  license: License;
  devices: number;
  sessions: number;
}

export interface DeviceRow {
  id: string;
  name: string;
  ip: string;
  hwid: string;
  accountId: string;
  accountEmail?: string;
  createdAt: string;
  lastSeen: string;
  revoked: boolean;
}

export interface SessionRow {
  id: string;
  accountId: string;
  accountEmail: string;
  deviceId: string;
  deviceName: string | null;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
}

export interface AuditRow {
  at: string;
  accountId: string | null;
  event: string;
  detail: string | null;
  ip: string | null;
}

export interface AdminIdentity {
  id: string;
  display: string;
  email: string;
  role: Role;
}

export interface AdminSession {
  token: string;
  account: AdminIdentity;
  expiresAt: number;
}

export interface RevokeResult {
  revoked: number;
}

export interface PasswordResetResult {
  updated: boolean;
  revoked: number;
}
