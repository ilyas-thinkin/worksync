-- 049: supervisor (line leader) photo per production line.
--
-- The photo is stored on disk next to the QR codes, not in the database: these are
-- shop-floor portraits shown on the TV board, so they are served as plain static
-- files and the column keeps only the web path (e.g. /uploads/line-leaders/13-1700000000.jpg).
-- NULL means "no photo uploaded" — every screen falls back to the leader's initials.

ALTER TABLE production_lines
    ADD COLUMN IF NOT EXISTS line_leader_photo VARCHAR(255);

COMMENT ON COLUMN production_lines.line_leader_photo IS
    'Web path to the line supervisor photo under /uploads/line-leaders, or NULL when none is uploaded.';
