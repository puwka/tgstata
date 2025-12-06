require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Check if environment variables are present to avoid runtime errors later
if (!supabaseUrl || !supabaseKey) {
    console.warn('Warning: SUPABASE_URL or SUPABASE_KEY is missing in environment variables.');
}

const supabase = createClient(supabaseUrl || '', supabaseKey || '');

module.exports = supabase;

