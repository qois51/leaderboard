-- Migration: 20261022000000_init_leaderboard_schema.sql
-- Description: Skema awal untuk sistem Leaderboard, Timer Pertandingan, dan Konfigurasi

-- 1. Tabel Settings (Pengaturan Event & Passphrase Panitia)
CREATE TABLE IF NOT EXISTS public.settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    event_name TEXT NOT NULL DEFAULT 'LEADERBOARD & TIMER KOMPETISI',
    sub_title TEXT NOT NULL DEFAULT 'Waktu Tercepat Menjadi Juara 1',
    passphrase TEXT NOT NULL DEFAULT 'qoisganteng123',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Tabel Boards (Leaderboard 1 & 2 beserta Status Timer & Match Aktif)
CREATE TABLE IF NOT EXISTS public.boards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    active_team_a TEXT DEFAULT '',
    active_team_b TEXT DEFAULT '',
    timer_title TEXT NOT NULL DEFAULT 'WAKTU PERTANDINGAN',
    timer_duration_seconds INTEGER NOT NULL DEFAULT 180,
    timer_remaining_ms INTEGER NOT NULL DEFAULT 180000,
    timer_is_running BOOLEAN NOT NULL DEFAULT FALSE,
    timer_started_at BIGINT,
    timer_target_end_time BIGINT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Tabel Teams (Data Catatan Waktu Tim & Peringkat)
CREATE TABLE IF NOT EXISTS public.teams (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    board_id TEXT NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    minutes INTEGER NOT NULL DEFAULT 0,
    seconds INTEGER NOT NULL DEFAULT 0,
    milliseconds INTEGER NOT NULL DEFAULT 0,
    total_ms BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index untuk mempercepat kalkulasi leaderboard & ranking per board
CREATE INDEX IF NOT EXISTS idx_teams_board_ranking 
ON public.teams (board_id, total_ms ASC, created_at ASC);

-- 4. View untuk kalkulasi ranking dan gap waktu secara otomatis
CREATE OR REPLACE VIEW public.ranked_teams AS
SELECT 
    t.id,
    t.board_id,
    t.name,
    t.minutes,
    t.seconds,
    t.milliseconds,
    t.total_ms,
    t.created_at,
    t.updated_at,
    ROW_NUMBER() OVER (
        PARTITION BY t.board_id 
        ORDER BY t.total_ms ASC, t.created_at ASC
    ) AS rank,
    t.total_ms - FIRST_VALUE(t.total_ms) OVER (
        PARTITION BY t.board_id 
        ORDER BY t.total_ms ASC, t.created_at ASC
    ) AS gap_ms
FROM public.teams t;

-- 5. Trigger otomatis untuk updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_settings_updated_at ON public.settings;
CREATE TRIGGER tr_settings_updated_at
BEFORE UPDATE ON public.settings
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_boards_updated_at ON public.boards;
CREATE TRIGGER tr_boards_updated_at
BEFORE UPDATE ON public.boards
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_teams_updated_at ON public.teams;
CREATE TRIGGER tr_teams_updated_at
BEFORE UPDATE ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 6. Keamanan & Row Level Security (RLS)
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

-- Kebijakan akses (SELECT dibuka publik untuk layar display proyektor & publik)
DROP POLICY IF EXISTS "Public can view settings" ON public.settings;
CREATE POLICY "Public can view settings" ON public.settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public can view boards" ON public.boards;
CREATE POLICY "Public can view boards" ON public.boards FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public can view teams" ON public.teams;
CREATE POLICY "Public can view teams" ON public.teams FOR SELECT USING (true);

-- Kebijakan write (INSERT/UPDATE/DELETE)
-- Dibuka untuk anon & authenticated agar kompatibel baik via Supabase Client langsung maupun backend server
DROP POLICY IF EXISTS "Allow modify settings" ON public.settings;
CREATE POLICY "Allow modify settings" ON public.settings FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow modify boards" ON public.boards;
CREATE POLICY "Allow modify boards" ON public.boards FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow modify teams" ON public.teams;
CREATE POLICY "Allow modify teams" ON public.teams FOR ALL USING (true) WITH CHECK (true);

-- 7. Realtime Synchronization
-- Aktifkan realtime pada tabel settings, boards, dan teams
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'settings'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.settings;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'boards'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.boards;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'teams'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.teams;
    END IF;
END $$;

-- 8. Initial Seed Data (Data bawaan aplikasi)
INSERT INTO public.settings (id, event_name, sub_title, passphrase)
VALUES ('default', 'LEADERBOARD & TIMER KOMPETISI', 'Waktu Tercepat Menjadi Juara 1', 'qoisganteng123')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.boards (id, name, subtitle, timer_title, timer_duration_seconds, timer_remaining_ms)
VALUES 
    ('1', 'Leaderboard 1', 'Kategori / Lintasan 1', 'WAKTU PERTANDINGAN', 180, 180000),
    ('2', 'Leaderboard 2', 'Kategori / Lintasan 2', 'WAKTU PERTANDINGAN', 180, 180000)
ON CONFLICT (id) DO NOTHING;
