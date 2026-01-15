-- Enable LISTEN/NOTIFY for realtime UI updates
-- Run: psql -h 127.0.0.1 -U worksync_user -d worksync_db -f /home/worksync/worksync/scripts/enable_db_notify.sql

CREATE OR REPLACE FUNCTION notify_data_change() RETURNS trigger AS $$
DECLARE
    payload jsonb;
BEGIN
    IF TG_TABLE_NAME = 'employee_process_assignments' THEN
        IF (TG_OP = 'DELETE') THEN
            payload = jsonb_build_object(
                'entity', TG_TABLE_NAME,
                'action', TG_OP,
                'process_id', OLD.process_id,
                'employee_id', OLD.employee_id,
                'line_id', OLD.line_id
            );
        ELSE
            payload = jsonb_build_object(
                'entity', TG_TABLE_NAME,
                'action', TG_OP,
                'process_id', NEW.process_id,
                'employee_id', NEW.employee_id,
                'line_id', NEW.line_id
            );
        END IF;
        PERFORM pg_notify('data_change', payload::text);
        RETURN NULL;
    END IF;

    IF (TG_OP = 'DELETE') THEN
        payload = jsonb_build_object(
            'entity', TG_TABLE_NAME,
            'action', TG_OP,
            'id', OLD.id
        );
        IF TG_TABLE_NAME = 'product_processes' THEN
            payload = payload || jsonb_build_object('product_id', OLD.product_id);
        END IF;
    ELSE
        payload = jsonb_build_object(
            'entity', TG_TABLE_NAME,
            'action', TG_OP,
            'id', NEW.id
        );
        IF TG_TABLE_NAME = 'product_processes' THEN
            payload = payload || jsonb_build_object('product_id', NEW.product_id);
        END IF;
    END IF;

    PERFORM pg_notify('data_change', payload::text);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notify_production_lines ON production_lines;
CREATE TRIGGER notify_production_lines
AFTER INSERT OR UPDATE OR DELETE ON production_lines
FOR EACH ROW EXECUTE FUNCTION notify_data_change();

DROP TRIGGER IF EXISTS notify_employees ON employees;
CREATE TRIGGER notify_employees
AFTER INSERT OR UPDATE OR DELETE ON employees
FOR EACH ROW EXECUTE FUNCTION notify_data_change();

DROP TRIGGER IF EXISTS notify_products ON products;
CREATE TRIGGER notify_products
AFTER INSERT OR UPDATE OR DELETE ON products
FOR EACH ROW EXECUTE FUNCTION notify_data_change();

DROP TRIGGER IF EXISTS notify_operations ON operations;
CREATE TRIGGER notify_operations
AFTER INSERT OR UPDATE OR DELETE ON operations
FOR EACH ROW EXECUTE FUNCTION notify_data_change();

DROP TRIGGER IF EXISTS notify_product_processes ON product_processes;
CREATE TRIGGER notify_product_processes
AFTER INSERT OR UPDATE OR DELETE ON product_processes
FOR EACH ROW EXECUTE FUNCTION notify_data_change();

DROP TRIGGER IF EXISTS notify_employee_process_assignments ON employee_process_assignments;
CREATE TRIGGER notify_employee_process_assignments
AFTER INSERT OR UPDATE OR DELETE ON employee_process_assignments
FOR EACH ROW EXECUTE FUNCTION notify_data_change();
