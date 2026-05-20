const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const isProd = !!process.env.RAILWAY_ENVIRONMENT;

let query;

if (isProd) {
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    console.log('✅ Banco PostgreSQL conectado!');
    query = async (sql, params = []) => {
        const res = await pool.query(sql, params);
        return res.rows;
    };
} else {
    const dbPath = path.join(__dirname, 'database.db');
    const db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('❌ Erro SQLite:', err.message);
            process.exit(1);
        } else {
            console.log('✅ Banco SQLite conectado!');
        }
    });
    query = (sql, params = []) => {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    };
}

module.exports = { query, isProd };