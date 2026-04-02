const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS builders (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      business_phone TEXT NOT NULL,
      twilio_number TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS missed_calls (
      id SERIAL PRIMARY KEY,
      call_sid TEXT UNIQUE NOT NULL,
      caller_phone TEXT NOT NULL,
      builder_id INTEGER REFERENCES builders(id),
      dial_status TEXT NOT NULL,
      called_at TIMESTAMP DEFAULT NOW(),
      whatsapp_sent BOOLEAN DEFAULT FALSE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_replies (
      id SERIAL PRIMARY KEY,
      missed_call_id INTEGER REFERENCES missed_calls(id),
      from_phone TEXT NOT NULL,
      body TEXT NOT NULL,
      received_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    INSERT INTO builders (id, name, business_phone, twilio_number)
    VALUES (1, 'Demo Builder', '+919999999999', '+10000000000')
    ON CONFLICT (id) DO NOTHING;
  `);
}

module.exports = {
  pool,
  initDb
};