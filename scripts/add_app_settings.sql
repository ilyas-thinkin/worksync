CREATE TABLE IF NOT EXISTS app_settings (
    key varchar(50) PRIMARY KEY,
    value varchar(100) NOT NULL,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO app_settings (key, value)
VALUES ('default_in_time', '08:00'), ('default_out_time', '17:00')
ON CONFLICT (key) DO NOTHING;
