const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

class AuthManager {
  constructor() {
    const dataDirectory = path.resolve(__dirname, '../../data');
    fs.mkdirSync(dataDirectory, { recursive: true });
    this.database = new DatabaseSync(path.join(dataDirectory, 'auth.db'));
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        birth_date TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        avatar TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  getAdmin() {
    const row = this.database.prepare('SELECT * FROM admin WHERE id = 1').get();
    if (!row) return null;
    return {
      firstName: row.first_name,
      lastName: row.last_name,
      birthDate: row.birth_date,
      email: row.email,
      passwordHash: row.password_hash,
      avatar: row.avatar
    };
  }

  saveAdmin(admin) {
    this.database.prepare(`INSERT INTO admin (id, first_name, last_name, birth_date, email, password_hash, avatar)
      VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
      birth_date = excluded.birth_date, email = excluded.email, password_hash = excluded.password_hash,
      avatar = excluded.avatar`).run(
      String(admin.firstName || ''), String(admin.lastName || ''), String(admin.birthDate || ''),
      String(admin.email || '').toLowerCase(), String(admin.passwordHash || ''), String(admin.avatar || '')
    );
    return true;
  }

  saveSession(tokenHash, expiresAt) {
    this.database.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?) ON CONFLICT(token_hash) DO UPDATE SET expires_at = excluded.expires_at').run(tokenHash, expiresAt);
  }

  getSessionExpiry(tokenHash) {
    return this.database.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(tokenHash)?.expires_at || null;
  }

  deleteSession(tokenHash) {
    this.database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  deleteAdminAccount() {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.exec('DELETE FROM sessions; DELETE FROM admin;');
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  deleteExpiredSessions(now = Date.now()) {
    this.database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  }
}

module.exports = AuthManager;
