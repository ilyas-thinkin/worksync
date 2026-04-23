--
-- PostgreSQL database dump
--

\restrict uDD8TmQQ0HVgLHNCZHdbJQBrffwDhHsSWDjWpiehYsc5JdTcZRbaBs9bFUGjFtB

-- Dumped from database version 17.7 (Debian 17.7-0+deb13u1)
-- Dumped by pg_dump version 17.7 (Debian 17.7-0+deb13u1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: log_material_transaction(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_material_transaction() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM pg_notify('worksync_changes', json_build_object(
        'table', TG_TABLE_NAME,
        'action', TG_OP,
        'id', NEW.id,
        'line_id', NEW.line_id,
        'work_date', NEW.work_date
    )::text);
    RETURN NEW;
END;
$$;


--
-- Name: notify_data_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_data_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: update_modified_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_modified_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key character varying(50) NOT NULL,
    value character varying(100) NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id integer NOT NULL,
    table_name character varying(50) NOT NULL,
    record_id integer NOT NULL,
    action character varying(20) NOT NULL,
    old_values jsonb,
    new_values jsonb,
    changed_by integer,
    changed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    reason text,
    ip_address character varying(50),
    user_agent text,
    session_id character varying(100),
    request_path character varying(255),
    http_method character varying(10)
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: defect_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.defect_log (
    id integer NOT NULL,
    line_id integer NOT NULL,
    process_id integer,
    employee_id integer,
    defect_type_id integer NOT NULL,
    work_date date NOT NULL,
    hour_slot integer,
    quantity integer DEFAULT 1 NOT NULL,
    status character varying(20) DEFAULT 'detected'::character varying,
    rework_employee_id integer,
    rework_completed_at timestamp without time zone,
    notes text,
    detected_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT defect_log_hour_slot_check CHECK (((hour_slot >= 0) AND (hour_slot <= 23)))
);


--
-- Name: defect_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.defect_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: defect_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.defect_log_id_seq OWNED BY public.defect_log.id;


--
-- Name: defect_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.defect_types (
    id integer NOT NULL,
    defect_code character varying(20) NOT NULL,
    defect_name character varying(100) NOT NULL,
    defect_category character varying(50),
    severity character varying(20) DEFAULT 'minor'::character varying,
    is_reworkable boolean DEFAULT true,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: defect_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.defect_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: defect_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.defect_types_id_seq OWNED BY public.defect_types.id;


--
-- Name: downtime_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.downtime_log (
    id integer NOT NULL,
    line_id integer NOT NULL,
    reason_id integer NOT NULL,
    work_date date NOT NULL,
    start_time timestamp without time zone NOT NULL,
    end_time timestamp without time zone,
    duration_minutes integer,
    affected_processes text[],
    notes text,
    reported_by integer,
    resolved_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: downtime_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.downtime_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: downtime_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.downtime_log_id_seq OWNED BY public.downtime_log.id;


--
-- Name: downtime_reasons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.downtime_reasons (
    id integer NOT NULL,
    reason_code character varying(20) NOT NULL,
    reason_name character varying(100) NOT NULL,
    reason_category character varying(50),
    is_planned boolean DEFAULT false,
    default_duration_minutes integer,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: downtime_reasons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.downtime_reasons_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: downtime_reasons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.downtime_reasons_id_seq OWNED BY public.downtime_reasons.id;


--
-- Name: employee_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_attendance (
    id integer NOT NULL,
    employee_id integer NOT NULL,
    attendance_date date NOT NULL,
    in_time time without time zone,
    out_time time without time zone,
    status character varying(30) DEFAULT 'present'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: employee_attendance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_attendance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_attendance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_attendance_id_seq OWNED BY public.employee_attendance.id;


--
-- Name: employee_process_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_process_assignments (
    id integer NOT NULL,
    process_id integer NOT NULL,
    employee_id integer NOT NULL,
    assigned_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    line_id integer
);


--
-- Name: employee_process_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_process_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_process_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_process_assignments_id_seq OWNED BY public.employee_process_assignments.id;


--
-- Name: employee_workstation_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_workstation_assignments (
    id integer NOT NULL,
    line_id integer NOT NULL,
    workstation_code character varying(100) NOT NULL,
    employee_id integer NOT NULL,
    assigned_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    work_date date,
    line_plan_workstation_id integer,
    is_overtime boolean DEFAULT false NOT NULL,
    material_provided integer,
    is_linked boolean DEFAULT false NOT NULL,
    linked_at timestamp with time zone,
    late_reason character varying(30),
    attendance_start timestamp with time zone,
    CONSTRAINT ewa_late_reason_check CHECK (((late_reason IS NULL) OR ((late_reason)::text = ANY ((ARRAY['linking_took_time'::character varying, 'meeting'::character varying, 'permission'::character varying, 'other'::character varying])::text[]))))
);


--
-- Name: COLUMN employee_workstation_assignments.material_provided; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employee_workstation_assignments.material_provided IS 'Units of material/WIP provided to this workstation at start of day';


--
-- Name: COLUMN employee_workstation_assignments.linked_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employee_workstation_assignments.linked_at IS 'Timestamp when supervisor confirmed link; NULL means not yet linked (absent)';


--
-- Name: COLUMN employee_workstation_assignments.late_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employee_workstation_assignments.late_reason IS 'Reason code when linked after 09:00 threshold';


--
-- Name: COLUMN employee_workstation_assignments.attendance_start; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employee_workstation_assignments.attendance_start IS 'Effective shift start used for efficiency calculation';


--
-- Name: employee_workstation_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_workstation_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_workstation_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_workstation_assignments_id_seq OWNED BY public.employee_workstation_assignments.id;


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id integer NOT NULL,
    emp_code character varying(50) NOT NULL,
    emp_name character varying(100) NOT NULL,
    designation character varying(100),
    default_line_id integer,
    qr_code_path character varying(255),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer,
    updated_by integer,
    manpower_factor numeric DEFAULT 1 NOT NULL,
    CONSTRAINT emp_code_format CHECK (((emp_code)::text ~ '^[A-Z0-9]+$'::text)),
    CONSTRAINT employees_manpower_factor_check CHECK ((manpower_factor > (0)::numeric))
);


--
-- Name: employees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employees_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employees_id_seq OWNED BY public.employees.id;


--
-- Name: group_wip; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_wip (
    id integer NOT NULL,
    line_id integer NOT NULL,
    work_date date NOT NULL,
    group_name character varying(100) NOT NULL,
    materials_in integer DEFAULT 0 NOT NULL,
    output_qty integer DEFAULT 0 NOT NULL,
    wip_quantity integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: group_wip_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.group_wip_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: group_wip_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.group_wip_id_seq OWNED BY public.group_wip.id;


--
-- Name: line_daily_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_daily_metrics (
    id integer NOT NULL,
    line_id integer NOT NULL,
    work_date date NOT NULL,
    forwarded_quantity integer DEFAULT 0 NOT NULL,
    remaining_wip integer DEFAULT 0 NOT NULL,
    materials_issued integer DEFAULT 0 NOT NULL,
    updated_by integer,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    qa_output integer DEFAULT 0 NOT NULL,
    CONSTRAINT line_daily_metrics_qa_check CHECK ((qa_output >= 0))
);


--
-- Name: line_daily_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.line_daily_metrics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: line_daily_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.line_daily_metrics_id_seq OWNED BY public.line_daily_metrics.id;


--
-- Name: line_daily_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_daily_plans (
    id integer NOT NULL,
    line_id integer NOT NULL,
    product_id integer NOT NULL,
    work_date date NOT NULL,
    target_units integer DEFAULT 0 NOT NULL,
    created_by integer,
    updated_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_locked boolean DEFAULT false NOT NULL,
    incoming_product_id integer,
    incoming_target_units integer DEFAULT 0 NOT NULL,
    changeover_sequence integer DEFAULT 0 NOT NULL,
    overtime_minutes integer DEFAULT 0 NOT NULL,
    overtime_target integer DEFAULT 0 NOT NULL,
    changeover_started_at timestamp with time zone,
    ot_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT line_daily_plans_changeover_sequence_nonneg CHECK ((changeover_sequence >= 0))
);


--
-- Name: line_daily_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.line_daily_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: line_daily_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.line_daily_plans_id_seq OWNED BY public.line_daily_plans.id;


--
-- Name: line_hourly_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_hourly_reports (
    line_id integer NOT NULL,
    work_date date NOT NULL,
    hour_slot integer NOT NULL,
    remarks text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: line_material_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_material_stock (
    id integer NOT NULL,
    line_id integer NOT NULL,
    work_date date NOT NULL,
    opening_stock integer DEFAULT 0 NOT NULL,
    total_issued integer DEFAULT 0 NOT NULL,
    total_used integer DEFAULT 0 NOT NULL,
    total_returned integer DEFAULT 0 NOT NULL,
    closing_stock integer DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE line_material_stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.line_material_stock IS 'Daily material stock balance per line';


--
-- Name: line_material_stock_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.line_material_stock_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: line_material_stock_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.line_material_stock_id_seq OWNED BY public.line_material_stock.id;


--
-- Name: line_ot_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_ot_plans (
    id integer NOT NULL,
    line_id integer NOT NULL,
    work_date date NOT NULL,
    product_id integer NOT NULL,
    global_ot_minutes integer DEFAULT 60 NOT NULL,
    ot_target_units integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    supervisor_authorized boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN line_ot_plans.supervisor_authorized; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.line_ot_plans.supervisor_authorized IS 'IE has authorized the supervisor to assign/modify workstations and employees during OT';


--
-- Name: line_ot_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.line_ot_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: line_ot_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.line_ot_plans_id_seq OWNED BY public.line_ot_plans.id;


--
-- Name: line_ot_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_ot_progress (
    id integer NOT NULL,
    line_id integer NOT NULL,
    ot_workstation_id integer NOT NULL,
    work_date date NOT NULL,
    quantity integer DEFAULT 0 NOT NULL,
    qa_rejection integer DEFAULT 0 NOT NULL,
    remarks text,
    employee_id integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: line_ot_progress_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.line_ot_progress_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: line_ot_progress_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.line_ot_progress_id_seq OWNED BY public.line_ot_progress.id;


--
-- Name: line_ot_workstation_processes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_ot_workstation_processes (
    id integer NOT NULL,
    ot_workstation_id integer NOT NULL,
    product_process_id integer NOT NULL,
    sequence_in_workstation integer DEFAULT 0 NOT NULL
);


--
-- Name: line_ot_workstation_processes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.line_ot_workstation_processes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: line_ot_workstation_processes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.line_ot_workstation_processes_id_seq OWNED BY public.line_ot_workstation_processes.id;


--
-- Name: line_ot_workstations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_ot_workstations (
    id integer NOT NULL,
    ot_plan_id integer NOT NULL,
    workstation_code character varying(50) NOT NULL,
    workstation_number integer,
    group_name character varying(100),
    is_active boolean DEFAULT true NOT NULL,
    ot_minutes integer DEFAULT 0 NOT NULL,
    actual_sam_seconds numeric(10,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: line_ot_workstations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.line_ot_workstations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: line_ot_workstations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.line_ot_workstations_id_seq OWNED BY public.line_ot_workstations.id;


--
-- Name: line_plan_workstation_processes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_plan_workstation_processes (
    id integer NOT NULL,
    workstation_id integer NOT NULL,
    product_process_id integer NOT NULL,
    sequence_in_workstation integer DEFAULT 1 NOT NULL,
    osm_checked boolean DEFAULT false NOT NULL
);


--
-- Name: line_plan_workstation_processes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.line_plan_workstation_processes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: line_plan_workstation_processes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.line_plan_workstation_processes_id_seq OWNED BY public.line_plan_workstation_processes.id;


--
-- Name: line_plan_workstations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_plan_workstations (
    id integer NOT NULL,
    line_id integer NOT NULL,
    work_date date NOT NULL,
    product_id integer NOT NULL,
    workstation_number integer NOT NULL,
    workstation_code character varying(20) NOT NULL,
    takt_time_seconds numeric(10,2),
    actual_sam_seconds numeric(10,2),
    workload_pct numeric(7,2),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    group_name character varying(100),
    is_ot_skipped boolean DEFAULT false NOT NULL,
    ws_changeover_active boolean DEFAULT false NOT NULL,
    ws_changeover_started_at timestamp with time zone,
    co_employee_id integer
);


--
-- Name: COLUMN line_plan_workstations.co_employee_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.line_plan_workstations.co_employee_id IS 'IE-pre-assigned changeover employee for this workstation (suggestion for supervisor to confirm or override)';


--
-- Name: line_plan_workstations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.line_plan_workstations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: line_plan_workstations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.line_plan_workstations_id_seq OWNED BY public.line_plan_workstations.id;


--
-- Name: line_process_hourly_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_process_hourly_progress (
    id integer NOT NULL,
    line_id integer NOT NULL,
    process_id integer NOT NULL,
    work_date date NOT NULL,
    hour_slot integer NOT NULL,
    quantity integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    employee_id integer,
    forwarded_quantity integer DEFAULT 0 NOT NULL,
    remaining_quantity integer DEFAULT 0 NOT NULL,
    qa_rejection integer DEFAULT 0 NOT NULL,
    remarks text,
    shortfall_reason character varying(100),
    CONSTRAINT line_process_hourly_progress_forwarded_check CHECK ((forwarded_quantity >= 0)),
    CONSTRAINT line_process_hourly_progress_hour_slot_check CHECK (((hour_slot >= 8) AND (hour_slot <= 19))),
    CONSTRAINT line_process_hourly_progress_remaining_check CHECK ((remaining_quantity >= 0))
);


--
-- Name: line_process_hourly_progress_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.line_process_hourly_progress_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: line_process_hourly_progress_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.line_process_hourly_progress_id_seq OWNED BY public.line_process_hourly_progress.id;


--
-- Name: line_shift_closures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_shift_closures (
    id integer NOT NULL,
    line_id integer NOT NULL,
    work_date date NOT NULL,
    closed_by integer,
    closed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    notes text
);


--
-- Name: line_shift_closures_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.line_shift_closures_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: line_shift_closures_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.line_shift_closures_id_seq OWNED BY public.line_shift_closures.id;


--
-- Name: line_workstations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_workstations (
    id integer NOT NULL,
    line_id integer NOT NULL,
    workstation_number integer NOT NULL,
    workstation_code character varying(10) NOT NULL,
    qr_code_path character varying(500),
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT line_workstations_workstation_number_check CHECK (((workstation_number >= 1) AND (workstation_number <= 100)))
);


--
-- Name: line_workstations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.line_workstations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: line_workstations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.line_workstations_id_seq OWNED BY public.line_workstations.id;


--
-- Name: material_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_transactions (
    id integer NOT NULL,
    line_id integer NOT NULL,
    work_date date NOT NULL,
    transaction_type character varying(50) NOT NULL,
    quantity integer NOT NULL,
    from_process_id integer,
    to_process_id integer,
    notes text,
    recorded_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE material_transactions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.material_transactions IS 'Tracks all material movements in the production line';


--
-- Name: material_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.material_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: material_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.material_transactions_id_seq OWNED BY public.material_transactions.id;


--
-- Name: operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operations (
    id integer NOT NULL,
    operation_code character varying(50) NOT NULL,
    operation_name character varying(200) NOT NULL,
    operation_description text,
    operation_category character varying(100),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer,
    updated_by integer,
    qr_code_path character varying(255)
);


--
-- Name: TABLE operations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.operations IS 'Master list of all manufacturing operations';


--
-- Name: operations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.operations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: operations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.operations_id_seq OWNED BY public.operations.id;


--
-- Name: process_assignment_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process_assignment_history (
    id integer NOT NULL,
    line_id integer NOT NULL,
    process_id integer NOT NULL,
    employee_id integer NOT NULL,
    start_time timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    end_time timestamp without time zone,
    quantity_completed integer DEFAULT 0 NOT NULL,
    changed_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    materials_at_link integer DEFAULT 0 NOT NULL,
    existing_materials integer DEFAULT 0 NOT NULL,
    CONSTRAINT process_assignment_history_existing_materials_check CHECK ((existing_materials >= 0)),
    CONSTRAINT process_assignment_history_materials_check CHECK ((materials_at_link >= 0))
);


--
-- Name: process_assignment_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.process_assignment_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: process_assignment_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.process_assignment_history_id_seq OWNED BY public.process_assignment_history.id;


--
-- Name: process_material_wip; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process_material_wip (
    id integer NOT NULL,
    line_id integer NOT NULL,
    process_id integer NOT NULL,
    work_date date NOT NULL,
    materials_in integer DEFAULT 0 NOT NULL,
    materials_out integer DEFAULT 0 NOT NULL,
    wip_quantity integer DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE process_material_wip; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.process_material_wip IS 'Work-in-progress materials at each process step';


--
-- Name: process_material_wip_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.process_material_wip_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: process_material_wip_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.process_material_wip_id_seq OWNED BY public.process_material_wip.id;


--
-- Name: product_processes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_processes (
    id integer NOT NULL,
    product_id integer NOT NULL,
    operation_id integer NOT NULL,
    sequence_number integer NOT NULL,
    operation_sah numeric(10,4) NOT NULL,
    cycle_time_seconds integer,
    manpower_required integer DEFAULT 1,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer,
    updated_by integer,
    qr_code_path character varying(255),
    target_units integer DEFAULT 0 NOT NULL,
    workspace_id integer,
    group_name character varying(50),
    workstation_code character varying(50),
    worker_input_mapping character varying(50) DEFAULT 'CONT'::character varying,
    osm_checked boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_sah_positive CHECK ((operation_sah > (0)::numeric)),
    CONSTRAINT chk_sequence_positive CHECK ((sequence_number > 0)),
    CONSTRAINT chk_target_units_nonnegative CHECK ((target_units >= 0))
);


--
-- Name: TABLE product_processes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_processes IS 'Product-specific operation sequences with SAH and workspace assignments';


--
-- Name: COLUMN product_processes.sequence_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_processes.sequence_number IS 'Order of operation in the process flow (1, 2, 3, ...)';


--
-- Name: COLUMN product_processes.operation_sah; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_processes.operation_sah IS 'SAH for this specific operation on this product';


--
-- Name: COLUMN product_processes.cycle_time_seconds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product_processes.cycle_time_seconds IS 'Cycle time in seconds';


--
-- Name: product_processes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_processes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_processes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_processes_id_seq OWNED BY public.product_processes.id;


--
-- Name: production_day_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_day_locks (
    work_date date NOT NULL,
    locked_by integer,
    locked_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    notes text
);


--
-- Name: line_daily_plan_delete_markers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_daily_plan_delete_markers (
    line_id integer NOT NULL,
    work_date date NOT NULL,
    deleted_by integer,
    deleted_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: production_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_lines (
    id integer NOT NULL,
    line_code character varying(50) NOT NULL,
    line_name character varying(100) NOT NULL,
    hall_location character varying(50),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer,
    updated_by integer,
    current_product_id integer,
    target_units integer DEFAULT 0 NOT NULL,
    efficiency numeric(5,2) DEFAULT 0 NOT NULL,
    qr_code_path character varying(255),
    line_leader character varying(100)
);


--
-- Name: production_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.production_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: production_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.production_lines_id_seq OWNED BY public.production_lines.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id integer NOT NULL,
    product_code character varying(50) NOT NULL,
    product_name character varying(200) NOT NULL,
    product_description text,
    category character varying(100),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer,
    updated_by integer,
    line_id integer,
    buyer_name character varying(200),
    target_qty integer DEFAULT 0 NOT NULL,
    plan_month character varying(7)
);


--
-- Name: TABLE products; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.products IS 'Master table for products/styles manufactured';


--
-- Name: COLUMN products.product_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.product_code IS 'Unique product identifier (e.g., CY405)';


--
-- Name: COLUMN products.plan_month; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.plan_month IS 'Planned production month, format YYYY-MM e.g. 2026-03';


--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.products_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    full_name character varying(100) NOT NULL,
    role character varying(20) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'ie'::character varying, 'supervisor'::character varying])::text[])))
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: v_audit_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_audit_summary AS
 SELECT date(changed_at) AS audit_date,
    table_name,
    action,
    count(*) AS action_count,
    count(DISTINCT changed_by) AS unique_users
   FROM public.audit_logs
  WHERE (changed_at >= (CURRENT_DATE - '30 days'::interval))
  GROUP BY (date(changed_at)), table_name, action
  ORDER BY (date(changed_at)) DESC, table_name, action;


--
-- Name: v_daily_defect_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_daily_defect_summary AS
 SELECT dl.work_date,
    dl.line_id,
    pl.line_name,
    dt.defect_category,
    dt.defect_code,
    dt.defect_name,
    dt.severity,
    count(*) AS defect_count,
    sum(dl.quantity) AS total_quantity,
    sum(
        CASE
            WHEN ((dl.status)::text = 'reworked'::text) THEN dl.quantity
            ELSE 0
        END) AS reworked_quantity,
    sum(
        CASE
            WHEN ((dl.status)::text = 'rejected'::text) THEN dl.quantity
            ELSE 0
        END) AS rejected_quantity
   FROM ((public.defect_log dl
     JOIN public.production_lines pl ON ((dl.line_id = pl.id)))
     JOIN public.defect_types dt ON ((dl.defect_type_id = dt.id)))
  GROUP BY dl.work_date, dl.line_id, pl.line_name, dt.defect_category, dt.defect_code, dt.defect_name, dt.severity
  ORDER BY dl.work_date DESC, (sum(dl.quantity)) DESC;


--
-- Name: v_daily_downtime_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_daily_downtime_summary AS
 SELECT dl.work_date,
    dl.line_id,
    pl.line_name,
    dr.reason_category,
    dr.reason_code,
    dr.reason_name,
    dr.is_planned,
    count(*) AS incident_count,
    sum(COALESCE((dl.duration_minutes)::numeric, (EXTRACT(epoch FROM (COALESCE((dl.end_time)::timestamp with time zone, now()) - (dl.start_time)::timestamp with time zone)) / (60)::numeric))) AS total_minutes
   FROM ((public.downtime_log dl
     JOIN public.production_lines pl ON ((dl.line_id = pl.id)))
     JOIN public.downtime_reasons dr ON ((dl.reason_id = dr.id)))
  GROUP BY dl.work_date, dl.line_id, pl.line_name, dr.reason_category, dr.reason_code, dr.reason_name, dr.is_planned
  ORDER BY dl.work_date DESC, (sum(COALESCE((dl.duration_minutes)::numeric, (EXTRACT(epoch FROM (COALESCE((dl.end_time)::timestamp with time zone, now()) - (dl.start_time)::timestamp with time zone)) / (60)::numeric)))) DESC;


--
-- Name: v_daily_material_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_daily_material_summary AS
 SELECT line_id,
    work_date,
    COALESCE(sum(
        CASE
            WHEN ((transaction_type)::text = 'issued'::text) THEN quantity
            ELSE 0
        END), (0)::bigint) AS total_issued,
    COALESCE(sum(
        CASE
            WHEN ((transaction_type)::text = 'used'::text) THEN quantity
            ELSE 0
        END), (0)::bigint) AS total_used,
    COALESCE(sum(
        CASE
            WHEN ((transaction_type)::text = 'returned'::text) THEN quantity
            ELSE 0
        END), (0)::bigint) AS total_returned,
    COALESCE(sum(
        CASE
            WHEN ((transaction_type)::text = 'forwarded'::text) THEN quantity
            ELSE 0
        END), (0)::bigint) AS total_forwarded,
    COALESCE(sum(
        CASE
            WHEN ((transaction_type)::text = 'received'::text) THEN quantity
            ELSE 0
        END), (0)::bigint) AS total_received
   FROM public.material_transactions
  GROUP BY line_id, work_date;


--
-- Name: v_recent_critical_changes; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_recent_critical_changes AS
 SELECT al.id,
    al.table_name,
    al.record_id,
    al.action,
    al.changed_at,
    al.ip_address,
    u.username AS changed_by_user,
    al.old_values,
    al.new_values,
    al.reason
   FROM (public.audit_logs al
     LEFT JOIN public.users u ON ((al.changed_by = u.id)))
  WHERE (((al.table_name)::text = ANY ((ARRAY['users'::character varying, 'production_lines'::character varying, 'products'::character varying, 'employees'::character varying])::text[])) AND ((al.action)::text = ANY ((ARRAY['delete'::character varying, 'update'::character varying])::text[])) AND (al.changed_at >= (CURRENT_TIMESTAMP - '7 days'::interval)))
  ORDER BY al.changed_at DESC
 LIMIT 100;


--
-- Name: worker_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_adjustments (
    id integer NOT NULL,
    line_id integer NOT NULL,
    work_date date NOT NULL,
    departure_id integer NOT NULL,
    vacant_workstation_code character varying(100) NOT NULL,
    from_employee_id integer NOT NULL,
    from_workstation_code character varying(100) NOT NULL,
    adjustment_type character varying(10) NOT NULL,
    reassignment_time timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT worker_adjustments_adjustment_type_check CHECK (((adjustment_type)::text = ANY ((ARRAY['assign'::character varying, 'combine'::character varying])::text[])))
);


--
-- Name: worker_adjustments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.worker_adjustments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: worker_adjustments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.worker_adjustments_id_seq OWNED BY public.worker_adjustments.id;


--
-- Name: worker_departures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_departures (
    id integer NOT NULL,
    line_id integer NOT NULL,
    work_date date NOT NULL,
    employee_id integer NOT NULL,
    workstation_code character varying(100) NOT NULL,
    departure_time timestamp with time zone DEFAULT now() NOT NULL,
    departure_reason character varying(20) NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT worker_departures_departure_reason_check CHECK (((departure_reason)::text = ANY ((ARRAY['sick'::character varying, 'personal'::character varying, 'operational'::character varying, 'other'::character varying])::text[])))
);


--
-- Name: worker_departures_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.worker_departures_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: worker_departures_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.worker_departures_id_seq OWNED BY public.worker_departures.id;


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id integer NOT NULL,
    workspace_code character varying(50) NOT NULL,
    workspace_name character varying(100) NOT NULL,
    workspace_type character varying(50),
    line_id integer,
    qr_code_path character varying(255),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer,
    updated_by integer,
    group_name character varying(50),
    worker_input_mapping character varying(50) DEFAULT 'CONT'::character varying
);


--
-- Name: workspaces_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workspaces_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workspaces_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workspaces_id_seq OWNED BY public.workspaces.id;


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: defect_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defect_log ALTER COLUMN id SET DEFAULT nextval('public.defect_log_id_seq'::regclass);


--
-- Name: defect_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defect_types ALTER COLUMN id SET DEFAULT nextval('public.defect_types_id_seq'::regclass);


--
-- Name: downtime_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.downtime_log ALTER COLUMN id SET DEFAULT nextval('public.downtime_log_id_seq'::regclass);


--
-- Name: downtime_reasons id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.downtime_reasons ALTER COLUMN id SET DEFAULT nextval('public.downtime_reasons_id_seq'::regclass);


--
-- Name: employee_attendance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_attendance ALTER COLUMN id SET DEFAULT nextval('public.employee_attendance_id_seq'::regclass);


--
-- Name: employee_process_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_process_assignments ALTER COLUMN id SET DEFAULT nextval('public.employee_process_assignments_id_seq'::regclass);


--
-- Name: employee_workstation_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_workstation_assignments ALTER COLUMN id SET DEFAULT nextval('public.employee_workstation_assignments_id_seq'::regclass);


--
-- Name: employees id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees ALTER COLUMN id SET DEFAULT nextval('public.employees_id_seq'::regclass);


--
-- Name: group_wip id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_wip ALTER COLUMN id SET DEFAULT nextval('public.group_wip_id_seq'::regclass);


--
-- Name: line_daily_metrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_daily_metrics ALTER COLUMN id SET DEFAULT nextval('public.line_daily_metrics_id_seq'::regclass);


--
-- Name: line_daily_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_daily_plans ALTER COLUMN id SET DEFAULT nextval('public.line_daily_plans_id_seq'::regclass);


--
-- Name: line_material_stock id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_material_stock ALTER COLUMN id SET DEFAULT nextval('public.line_material_stock_id_seq'::regclass);


--
-- Name: line_ot_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_plans ALTER COLUMN id SET DEFAULT nextval('public.line_ot_plans_id_seq'::regclass);


--
-- Name: line_ot_progress id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_progress ALTER COLUMN id SET DEFAULT nextval('public.line_ot_progress_id_seq'::regclass);


--
-- Name: line_ot_workstation_processes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_workstation_processes ALTER COLUMN id SET DEFAULT nextval('public.line_ot_workstation_processes_id_seq'::regclass);


--
-- Name: line_ot_workstations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_workstations ALTER COLUMN id SET DEFAULT nextval('public.line_ot_workstations_id_seq'::regclass);


--
-- Name: line_plan_workstation_processes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_plan_workstation_processes ALTER COLUMN id SET DEFAULT nextval('public.line_plan_workstation_processes_id_seq'::regclass);


--
-- Name: line_plan_workstations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_plan_workstations ALTER COLUMN id SET DEFAULT nextval('public.line_plan_workstations_id_seq'::regclass);


--
-- Name: line_process_hourly_progress id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_process_hourly_progress ALTER COLUMN id SET DEFAULT nextval('public.line_process_hourly_progress_id_seq'::regclass);


--
-- Name: line_shift_closures id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_shift_closures ALTER COLUMN id SET DEFAULT nextval('public.line_shift_closures_id_seq'::regclass);


--
-- Name: line_workstations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_workstations ALTER COLUMN id SET DEFAULT nextval('public.line_workstations_id_seq'::regclass);


--
-- Name: material_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_transactions ALTER COLUMN id SET DEFAULT nextval('public.material_transactions_id_seq'::regclass);


--
-- Name: operations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operations ALTER COLUMN id SET DEFAULT nextval('public.operations_id_seq'::regclass);


--
-- Name: process_assignment_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_assignment_history ALTER COLUMN id SET DEFAULT nextval('public.process_assignment_history_id_seq'::regclass);


--
-- Name: process_material_wip id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_material_wip ALTER COLUMN id SET DEFAULT nextval('public.process_material_wip_id_seq'::regclass);


--
-- Name: product_processes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_processes ALTER COLUMN id SET DEFAULT nextval('public.product_processes_id_seq'::regclass);


--
-- Name: production_lines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_lines ALTER COLUMN id SET DEFAULT nextval('public.production_lines_id_seq'::regclass);


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: worker_adjustments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_adjustments ALTER COLUMN id SET DEFAULT nextval('public.worker_adjustments_id_seq'::regclass);


--
-- Name: worker_departures id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_departures ALTER COLUMN id SET DEFAULT nextval('public.worker_departures_id_seq'::regclass);


--
-- Name: workspaces id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces ALTER COLUMN id SET DEFAULT nextval('public.workspaces_id_seq'::regclass);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: defect_log defect_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defect_log
    ADD CONSTRAINT defect_log_pkey PRIMARY KEY (id);


--
-- Name: defect_types defect_types_defect_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defect_types
    ADD CONSTRAINT defect_types_defect_code_key UNIQUE (defect_code);


--
-- Name: defect_types defect_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defect_types
    ADD CONSTRAINT defect_types_pkey PRIMARY KEY (id);


--
-- Name: downtime_log downtime_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.downtime_log
    ADD CONSTRAINT downtime_log_pkey PRIMARY KEY (id);


--
-- Name: downtime_reasons downtime_reasons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.downtime_reasons
    ADD CONSTRAINT downtime_reasons_pkey PRIMARY KEY (id);


--
-- Name: downtime_reasons downtime_reasons_reason_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.downtime_reasons
    ADD CONSTRAINT downtime_reasons_reason_code_key UNIQUE (reason_code);


--
-- Name: employee_attendance employee_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_attendance
    ADD CONSTRAINT employee_attendance_pkey PRIMARY KEY (id);


--
-- Name: employee_process_assignments employee_process_assignments_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_process_assignments
    ADD CONSTRAINT employee_process_assignments_employee_id_key UNIQUE (employee_id);


--
-- Name: employee_process_assignments employee_process_assignments_line_process_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_process_assignments
    ADD CONSTRAINT employee_process_assignments_line_process_key UNIQUE (line_id, process_id);


--
-- Name: employee_process_assignments employee_process_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_process_assignments
    ADD CONSTRAINT employee_process_assignments_pkey PRIMARY KEY (id);


--
-- Name: employee_workstation_assignments employee_workstation_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_workstation_assignments
    ADD CONSTRAINT employee_workstation_assignments_pkey PRIMARY KEY (id);


--
-- Name: employees employees_emp_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_emp_code_key UNIQUE (emp_code);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: group_wip group_wip_line_id_work_date_group_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_wip
    ADD CONSTRAINT group_wip_line_id_work_date_group_name_key UNIQUE (line_id, work_date, group_name);


--
-- Name: group_wip group_wip_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_wip
    ADD CONSTRAINT group_wip_pkey PRIMARY KEY (id);


--
-- Name: line_daily_metrics line_daily_metrics_line_id_work_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_daily_metrics
    ADD CONSTRAINT line_daily_metrics_line_id_work_date_key UNIQUE (line_id, work_date);


--
-- Name: line_daily_metrics line_daily_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_daily_metrics
    ADD CONSTRAINT line_daily_metrics_pkey PRIMARY KEY (id);


--
-- Name: line_daily_plans line_daily_plans_line_id_work_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_daily_plans
    ADD CONSTRAINT line_daily_plans_line_id_work_date_key UNIQUE (line_id, work_date);


--
-- Name: line_daily_plans line_daily_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_daily_plans
    ADD CONSTRAINT line_daily_plans_pkey PRIMARY KEY (id);


--
-- Name: line_hourly_reports line_hourly_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_hourly_reports
    ADD CONSTRAINT line_hourly_reports_pkey PRIMARY KEY (line_id, work_date, hour_slot);


--
-- Name: line_material_stock line_material_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_material_stock
    ADD CONSTRAINT line_material_stock_pkey PRIMARY KEY (id);


--
-- Name: line_ot_plans line_ot_plans_line_id_work_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_plans
    ADD CONSTRAINT line_ot_plans_line_id_work_date_key UNIQUE (line_id, work_date);


--
-- Name: line_ot_plans line_ot_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_plans
    ADD CONSTRAINT line_ot_plans_pkey PRIMARY KEY (id);


--
-- Name: line_ot_progress line_ot_progress_ot_workstation_id_work_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_progress
    ADD CONSTRAINT line_ot_progress_ot_workstation_id_work_date_key UNIQUE (ot_workstation_id, work_date);


--
-- Name: line_ot_progress line_ot_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_progress
    ADD CONSTRAINT line_ot_progress_pkey PRIMARY KEY (id);


--
-- Name: line_ot_workstation_processes line_ot_workstation_processes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_workstation_processes
    ADD CONSTRAINT line_ot_workstation_processes_pkey PRIMARY KEY (id);


--
-- Name: line_ot_workstations line_ot_workstations_ot_plan_id_workstation_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_workstations
    ADD CONSTRAINT line_ot_workstations_ot_plan_id_workstation_code_key UNIQUE (ot_plan_id, workstation_code);


--
-- Name: line_ot_workstations line_ot_workstations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_workstations
    ADD CONSTRAINT line_ot_workstations_pkey PRIMARY KEY (id);


--
-- Name: line_plan_workstation_processes line_plan_workstation_process_workstation_id_product_proces_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_plan_workstation_processes
    ADD CONSTRAINT line_plan_workstation_process_workstation_id_product_proces_key UNIQUE (workstation_id, product_process_id);


--
-- Name: line_plan_workstation_processes line_plan_workstation_processes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_plan_workstation_processes
    ADD CONSTRAINT line_plan_workstation_processes_pkey PRIMARY KEY (id);


--
-- Name: line_plan_workstations line_plan_workstations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_plan_workstations
    ADD CONSTRAINT line_plan_workstations_pkey PRIMARY KEY (id);


--
-- Name: line_process_hourly_progress line_process_hourly_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_process_hourly_progress
    ADD CONSTRAINT line_process_hourly_progress_pkey PRIMARY KEY (id);


--
-- Name: line_shift_closures line_shift_closures_line_id_work_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_shift_closures
    ADD CONSTRAINT line_shift_closures_line_id_work_date_key UNIQUE (line_id, work_date);


--
-- Name: line_shift_closures line_shift_closures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_shift_closures
    ADD CONSTRAINT line_shift_closures_pkey PRIMARY KEY (id);


--
-- Name: line_workstations line_workstations_line_id_workstation_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_workstations
    ADD CONSTRAINT line_workstations_line_id_workstation_code_key UNIQUE (line_id, workstation_code);


--
-- Name: line_workstations line_workstations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_workstations
    ADD CONSTRAINT line_workstations_pkey PRIMARY KEY (id);


--
-- Name: material_transactions material_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_transactions
    ADD CONSTRAINT material_transactions_pkey PRIMARY KEY (id);


--
-- Name: operations operations_operation_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operations
    ADD CONSTRAINT operations_operation_code_key UNIQUE (operation_code);


--
-- Name: operations operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operations
    ADD CONSTRAINT operations_pkey PRIMARY KEY (id);


--
-- Name: process_assignment_history process_assignment_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_assignment_history
    ADD CONSTRAINT process_assignment_history_pkey PRIMARY KEY (id);


--
-- Name: process_material_wip process_material_wip_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_material_wip
    ADD CONSTRAINT process_material_wip_pkey PRIMARY KEY (id);


--
-- Name: product_processes product_processes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_processes
    ADD CONSTRAINT product_processes_pkey PRIMARY KEY (id);


--
-- Name: production_day_locks production_day_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_day_locks
    ADD CONSTRAINT production_day_locks_pkey PRIMARY KEY (work_date);


--
-- Name: line_daily_plan_delete_markers line_daily_plan_delete_markers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_daily_plan_delete_markers
    ADD CONSTRAINT line_daily_plan_delete_markers_pkey PRIMARY KEY (line_id, work_date);


--
-- Name: production_lines production_lines_line_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_lines
    ADD CONSTRAINT production_lines_line_code_key UNIQUE (line_code);


--
-- Name: production_lines production_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_lines
    ADD CONSTRAINT production_lines_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_product_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_product_code_key UNIQUE (product_code);


--
-- Name: employee_attendance uq_employee_attendance; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_attendance
    ADD CONSTRAINT uq_employee_attendance UNIQUE (employee_id, attendance_date);


--
-- Name: line_material_stock uq_line_material_stock; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_material_stock
    ADD CONSTRAINT uq_line_material_stock UNIQUE (line_id, work_date);


--
-- Name: line_process_hourly_progress uq_line_process_hour; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_process_hourly_progress
    ADD CONSTRAINT uq_line_process_hour UNIQUE (line_id, process_id, work_date, hour_slot);


--
-- Name: process_material_wip uq_process_material_wip; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_material_wip
    ADD CONSTRAINT uq_process_material_wip UNIQUE (line_id, process_id, work_date);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: worker_adjustments worker_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_adjustments
    ADD CONSTRAINT worker_adjustments_pkey PRIMARY KEY (id);


--
-- Name: worker_departures worker_departures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_departures
    ADD CONSTRAINT worker_departures_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_workspace_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_workspace_code_key UNIQUE (workspace_code);


--
-- Name: idx_assignment_history_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_history_employee ON public.process_assignment_history USING btree (employee_id);


--
-- Name: idx_assignment_history_line_process; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_history_line_process ON public.process_assignment_history USING btree (line_id, process_id);


--
-- Name: idx_assignment_history_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_history_open ON public.process_assignment_history USING btree (line_id, process_id) WHERE (end_time IS NULL);


--
-- Name: idx_assignment_history_start_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_history_start_time ON public.process_assignment_history USING btree (start_time);


--
-- Name: idx_attendance_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_date ON public.employee_attendance USING btree (attendance_date);


--
-- Name: idx_attendance_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_status ON public.employee_attendance USING btree (status);


--
-- Name: idx_audit_logs_changed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_changed_at ON public.audit_logs USING btree (changed_at);


--
-- Name: idx_audit_logs_ip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_ip ON public.audit_logs USING btree (ip_address) WHERE (ip_address IS NOT NULL);


--
-- Name: idx_audit_logs_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_session ON public.audit_logs USING btree (session_id) WHERE (session_id IS NOT NULL);


--
-- Name: idx_audit_logs_table; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_table ON public.audit_logs USING btree (table_name);


--
-- Name: idx_audit_logs_table_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_table_record ON public.audit_logs USING btree (table_name, record_id);


--
-- Name: idx_audit_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user ON public.audit_logs USING btree (changed_by);


--
-- Name: idx_day_locks_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_day_locks_date ON public.production_day_locks USING btree (work_date);


--
-- Name: idx_line_daily_plan_delete_markers_work_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_line_daily_plan_delete_markers_work_date ON public.line_daily_plan_delete_markers USING btree (work_date);


--
-- Name: idx_defect_log_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defect_log_date ON public.defect_log USING btree (work_date);


--
-- Name: idx_defect_log_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defect_log_employee ON public.defect_log USING btree (employee_id);


--
-- Name: idx_defect_log_line_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defect_log_line_date ON public.defect_log USING btree (line_id, work_date);


--
-- Name: idx_defect_log_process; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defect_log_process ON public.defect_log USING btree (process_id);


--
-- Name: idx_defect_log_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defect_log_status ON public.defect_log USING btree (status);


--
-- Name: idx_defect_log_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defect_log_type ON public.defect_log USING btree (defect_type_id);


--
-- Name: idx_defect_types_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defect_types_active ON public.defect_types USING btree (is_active);


--
-- Name: idx_defect_types_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defect_types_category ON public.defect_types USING btree (defect_category);


--
-- Name: idx_defect_types_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_defect_types_code ON public.defect_types USING btree (defect_code);


--
-- Name: idx_downtime_log_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_downtime_log_date ON public.downtime_log USING btree (work_date);


--
-- Name: idx_downtime_log_line_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_downtime_log_line_date ON public.downtime_log USING btree (line_id, work_date);


--
-- Name: idx_downtime_log_reason; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_downtime_log_reason ON public.downtime_log USING btree (reason_id);


--
-- Name: idx_downtime_log_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_downtime_log_start ON public.downtime_log USING btree (start_time);


--
-- Name: idx_downtime_reasons_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_downtime_reasons_active ON public.downtime_reasons USING btree (is_active);


--
-- Name: idx_downtime_reasons_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_downtime_reasons_category ON public.downtime_reasons USING btree (reason_category);


--
-- Name: idx_downtime_reasons_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_downtime_reasons_code ON public.downtime_reasons USING btree (reason_code);


--
-- Name: idx_employees_emp_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_emp_code ON public.employees USING btree (emp_code);


--
-- Name: idx_employees_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_is_active ON public.employees USING btree (is_active);


--
-- Name: idx_employees_line_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_line_id ON public.employees USING btree (default_line_id);


--
-- Name: idx_ewa_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ewa_employee ON public.employee_workstation_assignments USING btree (employee_id);


--
-- Name: idx_ewa_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ewa_line ON public.employee_workstation_assignments USING btree (line_id);


--
-- Name: idx_ewa_line_date_ws_ot; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ewa_line_date_ws_ot ON public.employee_workstation_assignments USING btree (line_id, work_date, workstation_code, is_overtime);


--
-- Name: idx_group_wip_line_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_wip_line_date ON public.group_wip USING btree (line_id, work_date);


--
-- Name: idx_hourly_progress_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hourly_progress_employee ON public.line_process_hourly_progress USING btree (employee_id) WHERE (employee_id IS NOT NULL);


--
-- Name: idx_hourly_progress_line_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hourly_progress_line_date ON public.line_process_hourly_progress USING btree (line_id, work_date);


--
-- Name: idx_hourly_progress_work_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hourly_progress_work_date ON public.line_process_hourly_progress USING btree (work_date);


--
-- Name: idx_line_daily_metrics_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_line_daily_metrics_date ON public.line_daily_metrics USING btree (work_date);


--
-- Name: idx_line_daily_metrics_line_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_line_daily_metrics_line_date ON public.line_daily_metrics USING btree (line_id, work_date);


--
-- Name: idx_line_daily_plans_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_line_daily_plans_date ON public.line_daily_plans USING btree (work_date);


--
-- Name: idx_line_daily_plans_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_line_daily_plans_line ON public.line_daily_plans USING btree (line_id);


--
-- Name: idx_line_daily_plans_product_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_line_daily_plans_product_date ON public.line_daily_plans USING btree (product_id, work_date);


--
-- Name: idx_line_material_stock_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_line_material_stock_date ON public.line_material_stock USING btree (work_date);


--
-- Name: idx_line_workstations_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_line_workstations_line ON public.line_workstations USING btree (line_id);


--
-- Name: idx_lpw_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lpw_group ON public.line_plan_workstations USING btree (line_id, work_date, group_name);


--
-- Name: idx_lpw_line_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lpw_line_date ON public.line_plan_workstations USING btree (line_id, work_date);


--
-- Name: idx_lpw_line_date_product_ws; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_lpw_line_date_product_ws ON public.line_plan_workstations USING btree (line_id, work_date, product_id, workstation_number);


--
-- Name: idx_lpwp_process; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lpwp_process ON public.line_plan_workstation_processes USING btree (product_process_id);


--
-- Name: idx_lpwp_workstation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lpwp_workstation ON public.line_plan_workstation_processes USING btree (workstation_id);


--
-- Name: idx_material_transactions_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_transactions_date ON public.material_transactions USING btree (work_date);


--
-- Name: idx_material_transactions_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_transactions_line ON public.material_transactions USING btree (line_id);


--
-- Name: idx_material_transactions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_transactions_type ON public.material_transactions USING btree (transaction_type);


--
-- Name: idx_material_tx_line_date_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_tx_line_date_type ON public.material_transactions USING btree (line_id, work_date, transaction_type);


--
-- Name: idx_operations_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operations_active ON public.operations USING btree (is_active);


--
-- Name: idx_operations_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operations_category ON public.operations USING btree (operation_category);


--
-- Name: idx_operations_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_operations_code ON public.operations USING btree (operation_code);


--
-- Name: idx_process_material_wip_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_material_wip_date ON public.process_material_wip USING btree (work_date);


--
-- Name: idx_process_material_wip_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_material_wip_line ON public.process_material_wip USING btree (line_id);


--
-- Name: idx_process_wip_line_process_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_process_wip_line_process_date ON public.process_material_wip USING btree (line_id, process_id, work_date);


--
-- Name: idx_product_processes_operation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_processes_operation ON public.product_processes USING btree (operation_id);


--
-- Name: idx_product_processes_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_processes_product ON public.product_processes USING btree (product_id);


--
-- Name: idx_product_processes_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_processes_sequence ON public.product_processes USING btree (product_id, sequence_number);


--
-- Name: idx_products_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_active ON public.products USING btree (is_active);


--
-- Name: idx_products_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_code ON public.products USING btree (product_code);


--
-- Name: idx_shift_closures_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shift_closures_date ON public.line_shift_closures USING btree (work_date);


--
-- Name: idx_wa_departure; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_departure ON public.worker_adjustments USING btree (departure_id);


--
-- Name: idx_wa_departure_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_wa_departure_unique ON public.worker_adjustments USING btree (departure_id);


--
-- Name: idx_wa_line_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_line_date ON public.worker_adjustments USING btree (line_id, work_date);


--
-- Name: idx_wd_employee_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wd_employee_date ON public.worker_departures USING btree (employee_id, work_date);


--
-- Name: idx_wd_line_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wd_line_date ON public.worker_departures USING btree (line_id, work_date);


--
-- Name: idx_wd_line_date_ws_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_wd_line_date_ws_emp ON public.worker_departures USING btree (line_id, work_date, workstation_code, employee_id);


--
-- Name: idx_workspaces_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspaces_active ON public.workspaces USING btree (is_active);


--
-- Name: idx_workspaces_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspaces_code ON public.workspaces USING btree (workspace_code);


--
-- Name: idx_workspaces_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspaces_line ON public.workspaces USING btree (line_id);


--
-- Name: uq_product_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_product_sequence ON public.product_processes USING btree (product_id, sequence_number) WHERE (is_active = true);


--
-- Name: material_transactions material_transaction_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER material_transaction_notify AFTER INSERT OR UPDATE ON public.material_transactions FOR EACH ROW EXECUTE FUNCTION public.log_material_transaction();


--
-- Name: employee_process_assignments notify_employee_process_assignments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notify_employee_process_assignments AFTER INSERT OR DELETE OR UPDATE ON public.employee_process_assignments FOR EACH ROW EXECUTE FUNCTION public.notify_data_change();


--
-- Name: employees notify_employees; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notify_employees AFTER INSERT OR DELETE OR UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.notify_data_change();


--
-- Name: operations notify_operations; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notify_operations AFTER INSERT OR DELETE OR UPDATE ON public.operations FOR EACH ROW EXECUTE FUNCTION public.notify_data_change();


--
-- Name: product_processes notify_product_processes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notify_product_processes AFTER INSERT OR DELETE OR UPDATE ON public.product_processes FOR EACH ROW EXECUTE FUNCTION public.notify_data_change();


--
-- Name: production_lines notify_production_lines; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notify_production_lines AFTER INSERT OR DELETE OR UPDATE ON public.production_lines FOR EACH ROW EXECUTE FUNCTION public.notify_data_change();


--
-- Name: products notify_products; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notify_products AFTER INSERT OR DELETE OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.notify_data_change();


--
-- Name: defect_log update_defect_log_modtime; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_defect_log_modtime BEFORE UPDATE ON public.defect_log FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();


--
-- Name: defect_types update_defect_types_modtime; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_defect_types_modtime BEFORE UPDATE ON public.defect_types FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();


--
-- Name: downtime_log update_downtime_log_modtime; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_downtime_log_modtime BEFORE UPDATE ON public.downtime_log FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();


--
-- Name: downtime_reasons update_downtime_reasons_modtime; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_downtime_reasons_modtime BEFORE UPDATE ON public.downtime_reasons FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();


--
-- Name: defect_log defect_log_defect_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defect_log
    ADD CONSTRAINT defect_log_defect_type_id_fkey FOREIGN KEY (defect_type_id) REFERENCES public.defect_types(id);


--
-- Name: defect_log defect_log_detected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defect_log
    ADD CONSTRAINT defect_log_detected_by_fkey FOREIGN KEY (detected_by) REFERENCES public.users(id);


--
-- Name: defect_log defect_log_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defect_log
    ADD CONSTRAINT defect_log_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: defect_log defect_log_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defect_log
    ADD CONSTRAINT defect_log_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id);


--
-- Name: defect_log defect_log_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defect_log
    ADD CONSTRAINT defect_log_process_id_fkey FOREIGN KEY (process_id) REFERENCES public.product_processes(id);


--
-- Name: defect_log defect_log_rework_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.defect_log
    ADD CONSTRAINT defect_log_rework_employee_id_fkey FOREIGN KEY (rework_employee_id) REFERENCES public.employees(id);


--
-- Name: downtime_log downtime_log_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.downtime_log
    ADD CONSTRAINT downtime_log_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id);


--
-- Name: downtime_log downtime_log_reason_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.downtime_log
    ADD CONSTRAINT downtime_log_reason_id_fkey FOREIGN KEY (reason_id) REFERENCES public.downtime_reasons(id);


--
-- Name: downtime_log downtime_log_reported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.downtime_log
    ADD CONSTRAINT downtime_log_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES public.users(id);


--
-- Name: downtime_log downtime_log_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.downtime_log
    ADD CONSTRAINT downtime_log_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id);


--
-- Name: employee_attendance employee_attendance_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_attendance
    ADD CONSTRAINT employee_attendance_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_process_assignments employee_process_assignments_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_process_assignments
    ADD CONSTRAINT employee_process_assignments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_process_assignments employee_process_assignments_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_process_assignments
    ADD CONSTRAINT employee_process_assignments_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE SET NULL;


--
-- Name: employee_process_assignments employee_process_assignments_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_process_assignments
    ADD CONSTRAINT employee_process_assignments_process_id_fkey FOREIGN KEY (process_id) REFERENCES public.product_processes(id) ON DELETE CASCADE;


--
-- Name: employee_workstation_assignments employee_workstation_assignments_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_workstation_assignments
    ADD CONSTRAINT employee_workstation_assignments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_workstation_assignments employee_workstation_assignments_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_workstation_assignments
    ADD CONSTRAINT employee_workstation_assignments_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE CASCADE;


--
-- Name: employee_workstation_assignments employee_workstation_assignments_line_plan_workstation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_workstation_assignments
    ADD CONSTRAINT employee_workstation_assignments_line_plan_workstation_id_fkey FOREIGN KEY (line_plan_workstation_id) REFERENCES public.line_plan_workstations(id) ON DELETE CASCADE;


--
-- Name: employees employees_default_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_default_line_id_fkey FOREIGN KEY (default_line_id) REFERENCES public.production_lines(id);


--
-- Name: production_lines fk_lines_current_product; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_lines
    ADD CONSTRAINT fk_lines_current_product FOREIGN KEY (current_product_id) REFERENCES public.products(id);


--
-- Name: products fk_products_line; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT fk_products_line FOREIGN KEY (line_id) REFERENCES public.production_lines(id);


--
-- Name: group_wip group_wip_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_wip
    ADD CONSTRAINT group_wip_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE CASCADE;


--
-- Name: line_daily_metrics line_daily_metrics_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_daily_metrics
    ADD CONSTRAINT line_daily_metrics_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE CASCADE;


--
-- Name: line_daily_metrics line_daily_metrics_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_daily_metrics
    ADD CONSTRAINT line_daily_metrics_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: line_daily_plans line_daily_plans_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_daily_plans
    ADD CONSTRAINT line_daily_plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: line_daily_plans line_daily_plans_incoming_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_daily_plans
    ADD CONSTRAINT line_daily_plans_incoming_product_id_fkey FOREIGN KEY (incoming_product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: line_daily_plans line_daily_plans_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_daily_plans
    ADD CONSTRAINT line_daily_plans_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE CASCADE;


--
-- Name: line_daily_plans line_daily_plans_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_daily_plans
    ADD CONSTRAINT line_daily_plans_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: line_daily_plans line_daily_plans_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_daily_plans
    ADD CONSTRAINT line_daily_plans_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: line_hourly_reports line_hourly_reports_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_hourly_reports
    ADD CONSTRAINT line_hourly_reports_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE CASCADE;


--
-- Name: line_material_stock line_material_stock_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_material_stock
    ADD CONSTRAINT line_material_stock_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE CASCADE;


--
-- Name: line_ot_plans line_ot_plans_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_plans
    ADD CONSTRAINT line_ot_plans_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id);


--
-- Name: line_ot_plans line_ot_plans_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_plans
    ADD CONSTRAINT line_ot_plans_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: line_ot_progress line_ot_progress_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_progress
    ADD CONSTRAINT line_ot_progress_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: line_ot_progress line_ot_progress_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_progress
    ADD CONSTRAINT line_ot_progress_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE CASCADE;


--
-- Name: line_ot_progress line_ot_progress_ot_workstation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_progress
    ADD CONSTRAINT line_ot_progress_ot_workstation_id_fkey FOREIGN KEY (ot_workstation_id) REFERENCES public.line_ot_workstations(id) ON DELETE CASCADE;


--
-- Name: line_ot_workstation_processes line_ot_workstation_processes_ot_workstation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_workstation_processes
    ADD CONSTRAINT line_ot_workstation_processes_ot_workstation_id_fkey FOREIGN KEY (ot_workstation_id) REFERENCES public.line_ot_workstations(id) ON DELETE CASCADE;


--
-- Name: line_ot_workstation_processes line_ot_workstation_processes_product_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_workstation_processes
    ADD CONSTRAINT line_ot_workstation_processes_product_process_id_fkey FOREIGN KEY (product_process_id) REFERENCES public.product_processes(id);


--
-- Name: line_ot_workstations line_ot_workstations_ot_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_ot_workstations
    ADD CONSTRAINT line_ot_workstations_ot_plan_id_fkey FOREIGN KEY (ot_plan_id) REFERENCES public.line_ot_plans(id) ON DELETE CASCADE;


--
-- Name: line_plan_workstation_processes line_plan_workstation_processes_product_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_plan_workstation_processes
    ADD CONSTRAINT line_plan_workstation_processes_product_process_id_fkey FOREIGN KEY (product_process_id) REFERENCES public.product_processes(id);


--
-- Name: line_plan_workstation_processes line_plan_workstation_processes_workstation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_plan_workstation_processes
    ADD CONSTRAINT line_plan_workstation_processes_workstation_id_fkey FOREIGN KEY (workstation_id) REFERENCES public.line_plan_workstations(id) ON DELETE CASCADE;


--
-- Name: line_plan_workstations line_plan_workstations_co_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_plan_workstations
    ADD CONSTRAINT line_plan_workstations_co_employee_id_fkey FOREIGN KEY (co_employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: line_plan_workstations line_plan_workstations_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_plan_workstations
    ADD CONSTRAINT line_plan_workstations_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE CASCADE;


--
-- Name: line_plan_workstations line_plan_workstations_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_plan_workstations
    ADD CONSTRAINT line_plan_workstations_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: line_process_hourly_progress line_process_hourly_progress_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_process_hourly_progress
    ADD CONSTRAINT line_process_hourly_progress_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: line_process_hourly_progress line_process_hourly_progress_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_process_hourly_progress
    ADD CONSTRAINT line_process_hourly_progress_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE CASCADE;


--
-- Name: line_process_hourly_progress line_process_hourly_progress_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_process_hourly_progress
    ADD CONSTRAINT line_process_hourly_progress_process_id_fkey FOREIGN KEY (process_id) REFERENCES public.product_processes(id) ON DELETE CASCADE;


--
-- Name: line_shift_closures line_shift_closures_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_shift_closures
    ADD CONSTRAINT line_shift_closures_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: line_shift_closures line_shift_closures_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_shift_closures
    ADD CONSTRAINT line_shift_closures_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE CASCADE;


--
-- Name: line_workstations line_workstations_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_workstations
    ADD CONSTRAINT line_workstations_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE CASCADE;


--
-- Name: material_transactions material_transactions_from_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_transactions
    ADD CONSTRAINT material_transactions_from_process_id_fkey FOREIGN KEY (from_process_id) REFERENCES public.product_processes(id) ON DELETE SET NULL;


--
-- Name: material_transactions material_transactions_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_transactions
    ADD CONSTRAINT material_transactions_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE CASCADE;


--
-- Name: material_transactions material_transactions_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_transactions
    ADD CONSTRAINT material_transactions_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: material_transactions material_transactions_to_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_transactions
    ADD CONSTRAINT material_transactions_to_process_id_fkey FOREIGN KEY (to_process_id) REFERENCES public.product_processes(id) ON DELETE SET NULL;


--
-- Name: process_assignment_history process_assignment_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_assignment_history
    ADD CONSTRAINT process_assignment_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: process_assignment_history process_assignment_history_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_assignment_history
    ADD CONSTRAINT process_assignment_history_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: process_assignment_history process_assignment_history_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_assignment_history
    ADD CONSTRAINT process_assignment_history_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE CASCADE;


--
-- Name: process_assignment_history process_assignment_history_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_assignment_history
    ADD CONSTRAINT process_assignment_history_process_id_fkey FOREIGN KEY (process_id) REFERENCES public.product_processes(id) ON DELETE CASCADE;


--
-- Name: process_material_wip process_material_wip_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_material_wip
    ADD CONSTRAINT process_material_wip_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE CASCADE;


--
-- Name: process_material_wip process_material_wip_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_material_wip
    ADD CONSTRAINT process_material_wip_process_id_fkey FOREIGN KEY (process_id) REFERENCES public.product_processes(id) ON DELETE CASCADE;


--
-- Name: product_processes product_processes_operation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_processes
    ADD CONSTRAINT product_processes_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.operations(id) ON DELETE RESTRICT;


--
-- Name: product_processes product_processes_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_processes
    ADD CONSTRAINT product_processes_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: product_processes product_processes_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_processes
    ADD CONSTRAINT product_processes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: production_day_locks production_day_locks_locked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_day_locks
    ADD CONSTRAINT production_day_locks_locked_by_fkey FOREIGN KEY (locked_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: line_daily_plan_delete_markers line_daily_plan_delete_markers_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_daily_plan_delete_markers
    ADD CONSTRAINT line_daily_plan_delete_markers_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: line_daily_plan_delete_markers line_daily_plan_delete_markers_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_daily_plan_delete_markers
    ADD CONSTRAINT line_daily_plan_delete_markers_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE CASCADE;


--
-- Name: worker_adjustments worker_adjustments_departure_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_adjustments
    ADD CONSTRAINT worker_adjustments_departure_id_fkey FOREIGN KEY (departure_id) REFERENCES public.worker_departures(id) ON DELETE CASCADE;


--
-- Name: worker_adjustments worker_adjustments_from_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_adjustments
    ADD CONSTRAINT worker_adjustments_from_employee_id_fkey FOREIGN KEY (from_employee_id) REFERENCES public.employees(id);


--
-- Name: worker_adjustments worker_adjustments_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_adjustments
    ADD CONSTRAINT worker_adjustments_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE CASCADE;


--
-- Name: worker_departures worker_departures_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_departures
    ADD CONSTRAINT worker_departures_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: worker_departures worker_departures_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_departures
    ADD CONSTRAINT worker_departures_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id) ON DELETE CASCADE;


--
-- Name: workspaces workspaces_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.production_lines(id);


--
-- PostgreSQL database dump complete
--

\unrestrict uDD8TmQQ0HVgLHNCZHdbJQBrffwDhHsSWDjWpiehYsc5JdTcZRbaBs9bFUGjFtB
