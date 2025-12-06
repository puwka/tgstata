-- Run this in your Supabase SQL Editor

-- Table for users and their MTProto sessions
CREATE TABLE IF NOT EXISTS users (
    telegram_id BIGINT PRIMARY KEY, -- ID from initData
    session_string TEXT,            -- Encrypted session string from gram.js
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Table for cached stats
CREATE TABLE IF NOT EXISTS user_stats (
    telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id),
    stats_json JSONB NOT NULL,       -- All data for frontend
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- NEW: Table for temporary auth data (Serverless support)
CREATE TABLE IF NOT EXISTS auth_temp (
    telegram_id BIGINT PRIMARY KEY,
    phone_hash TEXT,
    phone_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_temp ENABLE ROW LEVEL SECURITY;
