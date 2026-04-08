-- Migration 033: Set working hours to 09:00-17:00 with 60-min lunch break (12:00-13:00)
INSERT INTO app_settings (key, value)
VALUES ('default_in_time', '09:00')
ON CONFLICT (key) DO UPDATE SET value = '09:00', updated_at = NOW();

INSERT INTO app_settings (key, value)
VALUES ('default_out_time', '17:00')
ON CONFLICT (key) DO UPDATE SET value = '17:00', updated_at = NOW();

INSERT INTO app_settings (key, value)
VALUES ('lunch_break_minutes', '60')
ON CONFLICT (key) DO UPDATE SET value = '60', updated_at = NOW();
