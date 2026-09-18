-- 050: which workstations the line TV board adds up for its Line output, Line achieved and
-- Line efficiency tiles.
--
-- Chosen on the board itself (the + cards) and shared by every screen showing the line.
-- Stations are stored by their number key (normalizeWsCode: "WS80" -> "80"), not by plan row id,
-- because the plan is rebuilt every day while the station numbers stay put for the same style.
-- product_id records the style the selection was made for: once the line's primary product is a
-- different one the selection is ignored, since station 80 of a new style is a different operation.
-- NULL means nothing chosen yet — every tile shows an empty + card.

ALTER TABLE production_lines
    ADD COLUMN IF NOT EXISTS display_tiles JSONB;

COMMENT ON COLUMN production_lines.display_tiles IS
    'Line TV tile selection: {product_id, output: [ws keys], achieved: [ws keys], efficiency: [ws keys], efficiency_line_overall: bool}. Ignored once the line runs a different primary product. NULL = not chosen.';
