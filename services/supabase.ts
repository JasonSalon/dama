import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://sdbvluassrggbfwykwoa.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkYnZsdWFzc3JnZ2Jmd3lrd29hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1MTcwNzUsImV4cCI6MjA4MTA5MzA3NX0.hd-3fk31QmjtxKqt8TCfjaLjXY_T1B6SXNAufltfCaQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);