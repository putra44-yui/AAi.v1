-- =========================================
-- AAi FAMILY AI - RLS SECURITY MIGRATION
-- Tanggal: 2026-04-08
-- =========================================
--
-- TUJUAN:
--   Mengaktifkan Row Level Security (RLS) di semua tabel publik.
--   Karena seluruh akses DB sudah melalui Next.js API routes
--   menggunakan SUPABASE_SERVICE_ROLE_KEY (server-side only),
--   service_role secara otomatis bypass RLS — sehingga TIDAK ADA
--   perubahan perilaku pada API yang sudah berjalan.
--
--   Yang berubah: akses langsung via anon key / dashboard explorer
--   tanpa service_role akan ditolak total (defense-in-depth).
--
-- CARA ROLLBACK (jika perlu):
--   ALTER TABLE <nama_tabel> DISABLE ROW LEVEL SECURITY;
--   (ulangi untuk setiap tabel di bawah)
-- =========================================

BEGIN;

-- =========================================
-- TABEL PRIVATE: USER & IDENTITY
-- =========================================

-- users: akun login, hanya boleh diakses service_role
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- persons: profil keluarga, hanya service_role
ALTER TABLE persons ENABLE ROW LEVEL SECURITY;

-- relationships: relasi keluarga/teman, hanya service_role
ALTER TABLE relationships ENABLE ROW LEVEL SECURITY;

-- =========================================
-- TABEL PRIVATE: CHAT
-- =========================================

-- sessions: grup chat per user
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- messages: histori chat
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- message_previews: audit QA per sesi
ALTER TABLE message_previews ENABLE ROW LEVEL SECURITY;

-- =========================================
-- TABEL PRIVATE: MEMORI AI
-- =========================================

-- person_memory: preferensi/kebiasaan per person
ALTER TABLE person_memory ENABLE ROW LEVEL SECURITY;

-- person_memory_evidence: bukti observasi
ALTER TABLE person_memory_evidence ENABLE ROW LEVEL SECURITY;

-- draft_memories: memory draft belum selesai
ALTER TABLE draft_memories ENABLE ROW LEVEL SECURITY;

-- memories: memori utama dengan locking
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;

-- planning_memory: rencana user-managed
ALTER TABLE planning_memory ENABLE ROW LEVEL SECURITY;

-- =========================================
-- TABEL PRIVATE: FILE & JOB
-- =========================================

-- file_generation_jobs: antrian file async
ALTER TABLE file_generation_jobs ENABLE ROW LEVEL SECURITY;

-- =========================================
-- TABEL ADMIN ONLY: AUDIT
-- =========================================

-- audit_trail: request tracing, hanya service_role
ALTER TABLE audit_trail ENABLE ROW LEVEL SECURITY;

-- legacy_audit_log: jejak keputusan memory governance
ALTER TABLE legacy_audit_log ENABLE ROW LEVEL SECURITY;

-- =========================================
-- TABEL SEMI-PUBLIC: CONFIG AI
-- =========================================

-- ai_personas: konfigurasi statis AI, read-only semua
ALTER TABLE ai_personas ENABLE ROW LEVEL SECURITY;

-- Policy: izinkan baca ai_personas untuk semua peran
-- (persona hanya config, tidak mengandung data pribadi)
CREATE POLICY "ai_personas_read_all"
  ON ai_personas
  FOR SELECT
  USING (true);

-- =========================================
-- CATATAN KEAMANAN
-- =========================================
-- 1. service_role key secara built-in bypass semua RLS policy di Supabase.
--    Seluruh API routes (Next.js) menggunakan service_role → tidak ada regresi.
-- 2. Tabel tanpa policy (selain ai_personas) = deny-by-default untuk
--    anon key, authenticated JWT, dan akses langsung dari client.
-- 3. Jika di masa depan menambahkan Supabase Auth (auth.uid()),
--    tambahkan policy per tabel di migration terpisah.
-- 4. File ini aman dijalankan ulang (idempotent kecuali CREATE POLICY,
--    gunakan IF NOT EXISTS atau DROP POLICY IF EXISTS dulu).

COMMIT;
