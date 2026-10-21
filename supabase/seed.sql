-- Seed data untuk demo tim (opsional jika dibutuhkan untuk pengujian awal)

INSERT INTO public.teams (id, board_id, name, minutes, seconds, milliseconds, total_ms)
VALUES 
    ('demo_1', '1', 'Tim Harimau (Jalur A)', 1, 12, 450, 72450),
    ('demo_2', '1', 'Tim Rajawali (Jalur B)', 1, 18, 920, 78920),
    ('demo_3', '1', 'Tim Komodo (Jalur A)', 1, 25, 100, 85100),
    ('demo_4', '1', 'Tim Badak Perkasa', 1, 34, 80, 94080),
    ('demo_5', '1', 'Tim Kancil Cepat', 1, 42, 650, 102650),
    ('demo_6', '2', 'Tim Singa Perkasa', 0, 58, 200, 58200),
    ('demo_7', '2', 'Tim Macan Tutul', 1, 5, 750, 65750),
    ('demo_8', '2', 'Tim Garuda Emas', 1, 15, 300, 75300),
    ('demo_9', '2', 'Tim Banteng Merah', 1, 22, 110, 82110)
ON CONFLICT (id) DO NOTHING;
