from typing import Set

from sqlalchemy import inspect, text

from database import engine


def _column_names(conn, table: str) -> Set[str]:
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return {row[1] for row in rows}


def run_migrations() -> None:
    with engine.begin() as conn:
        if "sales_orders" in inspect(engine).get_table_names():
            cols = _column_names(conn, "sales_orders")
            if "fulfillment_type" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE sales_orders ADD COLUMN fulfillment_type VARCHAR(32) DEFAULT 'toimitus'"
                    )
                )
            else:
                conn.execute(
                    text(
                        "UPDATE sales_orders SET fulfillment_type = 'toimitus' "
                        "WHERE fulfillment_type IS NULL OR fulfillment_type IN ('TOIMITUS', 'NOUTO')"
                    )
                )
            if "scheduled_date" not in cols:
                conn.execute(text("ALTER TABLE sales_orders ADD COLUMN scheduled_date DATETIME"))
            if "created_by_employee_id" not in cols:
                conn.execute(
                    text("ALTER TABLE sales_orders ADD COLUMN created_by_employee_id INTEGER")
                )
            if "customer_id" not in cols:
                conn.execute(text("ALTER TABLE sales_orders ADD COLUMN customer_id INTEGER"))
            if "customer_phone" not in cols:
                conn.execute(text("ALTER TABLE sales_orders ADD COLUMN customer_phone VARCHAR(64)"))

        if "products" in inspect(engine).get_table_names():
            cols = _column_names(conn, "products")
            if "manufacturer" not in cols:
                conn.execute(text("ALTER TABLE products ADD COLUMN manufacturer VARCHAR(255)"))
            if "wholesaler" not in cols:
                conn.execute(text("ALTER TABLE products ADD COLUMN wholesaler VARCHAR(255)"))
