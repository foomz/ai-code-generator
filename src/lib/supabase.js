import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://akygslqtgjvmbbbvyiri.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFreWdzbHF0Z2p2bWJiYnZ5aXJpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczOTY4MzE0NSwiZXhwIjoyMDU1MjU5MTQ1fQ.CGs7qaa721-rln5BBim9udzALmTlKKZnuOOi4MqaUI4'

export const supabase = createClient(supabaseUrl, supabaseKey)