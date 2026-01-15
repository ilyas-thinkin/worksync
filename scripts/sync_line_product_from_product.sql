-- Keep production_lines.current_product_id in sync with products.line_id
-- Run: psql -h 127.0.0.1 -U worksync_user -d worksync_db -f /home/worksync/worksync/scripts/sync_line_product_from_product.sql

CREATE OR REPLACE FUNCTION sync_line_current_product() RETURNS trigger AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        UPDATE production_lines
        SET current_product_id = NULL
        WHERE current_product_id = OLD.id;
        RETURN NULL;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        IF OLD.line_id IS NOT NULL AND (NEW.line_id IS NULL OR NEW.line_id <> OLD.line_id) THEN
            UPDATE production_lines
            SET current_product_id = NULL
            WHERE id = OLD.line_id AND current_product_id = OLD.id;
        END IF;
    END IF;

    IF NEW.line_id IS NOT NULL THEN
        UPDATE production_lines
        SET current_product_id = NEW.id
        WHERE id = NEW.line_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_line_current_product_on_products ON products;
CREATE TRIGGER sync_line_current_product_on_products
AFTER INSERT OR UPDATE OR DELETE ON products
FOR EACH ROW EXECUTE FUNCTION sync_line_current_product();
