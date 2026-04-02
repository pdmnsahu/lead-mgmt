CREATE TABLE builders (
  id SERIAL PRIMARY KEY,
  name TEXT,
  business_phone TEXT,
  twilio_number TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE missed_calls (
  id SERIAL PRIMARY KEY,
  call_sid TEXT UNIQUE,
  caller_phone TEXT,
  builder_id INTEGER,
  dial_status TEXT,
  called_at TIMESTAMP DEFAULT NOW(),
  whatsapp_sent BOOLEAN DEFAULT FALSE
);

CREATE TABLE whatsapp_replies (
  id SERIAL PRIMARY KEY,
  missed_call_id INTEGER,
  from_phone TEXT,
  body TEXT,
  received_at TIMESTAMP DEFAULT NOW()
);