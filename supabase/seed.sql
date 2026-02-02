-- ============================================
-- 本地開發種子資料：Auth 測試用戶
-- 執行時機：supabase db reset / supabase start 後、migrations 完成後
-- ============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 在本地 Auth 中建立一個種子用戶（id 與 migrations 測試資料一致，便於 003/006 引用）
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new
)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  'admin@test.com',
  crypt('password123', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '',
  '',
  ''
)
ON CONFLICT (id) DO NOTHING;

-- 對應的 identity 紀錄（登入需有此筆）
INSERT INTO auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  u.id,
  format('{"sub":"%s","email":"%s"}', u.id::text, u.email)::jsonb,
  'email',
  now(),
  now(),
  now()
FROM auth.users u
WHERE u.id = '00000000-0000-0000-0000-000000000001'::uuid
ON CONFLICT (id) DO NOTHING;
