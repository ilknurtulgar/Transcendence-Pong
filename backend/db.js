const sqlite3 = require('sqlite3').verbose()
const path = require('path')


const dbPath = path.resolve(__dirname, './data/transcendence.db')

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Veritabanı bağlantı hatası: ', err.message)
    } else {

        db.serialize(() => {
            const addColumnIfMissing = (table, columnDef) => {
                db.run(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`, (e) => {
                    if (!e) return
                    if (/duplicate\s+column\s+name/i.test(String(e.message || e))) return
                    console.warn(`Migration warning: could not add column ${columnDef} to ${table}:`, e.message || e)
                })
            }

            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                alias TEXT UNIQUE,
                password TEXT,
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0,
                two_factor_secret TEXT,
                is_two_factor_enabled INTEGER DEFAULT 0,
                avatar_url TEXT DEFAULT '/uploads/default_avatar.jpg',
                github_id INTEGER UNIQUE
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS friends(
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               user_id INTEGER NOT NULL,
               friend_id INTEGER NOT NULL,
               status TEXT NOT NULL,
               created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
               FOREIGN KEY(user_id) REFERENCES users(id),
               FOREIGN KEY(friend_id) REFERENCES users(id),
               UNIQUE(user_id, friend_id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS matches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                mode TEXT NOT NULL,
                player1_id INTEGER NOT NULL,
                player2_id INTEGER,
                opponent_label TEXT,
                player1_score INTEGER NOT NULL,
                player2_score INTEGER NOT NULL,
                winner_id INTEGER,
                is_verified INTEGER NOT NULL DEFAULT 0,
                tournament_id TEXT,
                stage TEXT,
                FOREIGN KEY(player1_id) REFERENCES users(id),
                FOREIGN KEY(player2_id) REFERENCES users(id),
                FOREIGN KEY(winner_id) REFERENCES users(id)
            )`);

            addColumnIfMissing('matches', 'is_verified INTEGER NOT NULL DEFAULT 0')
            addColumnIfMissing('matches', 'tournament_id TEXT')
            addColumnIfMissing('matches', 'stage TEXT')

            addColumnIfMissing('users', "language TEXT DEFAULT 'tr'")

            db.run(`CREATE INDEX IF NOT EXISTS idx_matches_player1_id ON matches(player1_id)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_matches_player2_id ON matches(player2_id)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_matches_created_at ON matches(created_at)`);
        })
    }
})

db.query = (sql, params) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

db.execute = (sql, params) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this.lastID); });
});

db.queryAll = (sql, params) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

module.exports = db