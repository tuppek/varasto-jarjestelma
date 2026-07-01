from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from models import (
    FulfillmentType,
    OrderStatusEvent,
    Product,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseOrderStatus,
    SalesOrder,
    SalesOrderLine,
    SalesOrderService,
    SalesOrderStatus,
    StockMovement,
)

SERVICE_LABELS = {
    "toimitus": "Toimitus",
    "asennus": "Asennus",
    "nouto": "Nouto",
    "kuljetus": "Toimitus",
}

ALLOWED_SERVICES = frozenset({"toimitus", "asennus", "nouto"})


def product_unit_cost(product: Product) -> float:
    if product.purchase_price is not None and product.purchase_price > 0:
        return float(product.purchase_price)
    if product.sale_price is not None and product.sale_price > 0:
        return float(product.sale_price)
    return 0.0


def inventory_value(products: list[Product]) -> float:
    return sum(p.quantity_on_hand * product_unit_cost(p) for p in products)


def _normalize_services(services: Optional[list[str]]) -> list[str]:
    normalized: list[str] = []
    for svc in services or []:
        value = "toimitus" if svc == "kuljetus" else svc
        if value in ALLOWED_SERVICES and value not in normalized:
            normalized.append(value)
    return normalized


def _fulfillment_from_services(services: list[str]) -> FulfillmentType:
    return FulfillmentType.NOUTO if "nouto" in services else FulfillmentType.TOIMITUS


def _sync_order_services(db: Session, order: SalesOrder, services: list[str]) -> None:
    normalized = _normalize_services(services)
    order.fulfillment_type = _fulfillment_from_services(normalized)
    order.services.clear()
    db.flush()
    for svc in normalized:
        db.add(SalesOrderService(order_id=order.id, service_type=svc))


def _service_labels(order: SalesOrder) -> list[str]:
    return [SERVICE_LABELS.get(s.service_type, s.service_type) for s in order.services]

EVENT_LABELS = {
    "luotu": "Tilaus luotu",
    "vastaanotettu": "Tilaus vastaanotettu",
    "hyvaksytty": "Tilaus hyväksytty – varattu",
    "osittain_toimitettu": "Osittain toimitettu",
    "toimitettu": "Toimitettu",
    "peruttu": "Tilaus peruttu",
}


def _log_order_event(
    db: Session,
    order: SalesOrder,
    event_type: str,
    employee_id: Optional[int] = None,
    notes: Optional[str] = None,
) -> None:
    db.add(
        OrderStatusEvent(
            order_id=order.id,
            event_type=event_type,
            employee_id=employee_id,
            notes=notes,
        )
    )


def _next_number(db: Session, prefix: str, model) -> str:
    if model.__tablename__ == "sales_orders":
        count = db.query(model).count() + 1
        return f"{prefix}-{count:06d}"
    count = db.query(model).count() + 1
    return f"{prefix}-{datetime.utcnow():%Y%m%d}-{count:04d}"


def _log_movement(
    db: Session,
    product: Product,
    movement_type: str,
    quantity: int,
    reference: Optional[str] = None,
    notes: Optional[str] = None,
) -> None:
    db.add(
        StockMovement(
            product_id=product.id,
            movement_type=movement_type,
            quantity=quantity,
            reference=reference,
            notes=notes,
        )
    )


def create_product(db: Session, data: dict) -> Product:
    product = Product(**data)
    db.add(product)
    db.flush()
    if product.quantity_on_hand:
        _log_movement(
            db,
            product,
            "alkusaldo",
            product.quantity_on_hand,
            notes="Tuote luotu",
        )
    return product


def create_purchase_order(db: Session, supplier: str, notes: Optional[str], lines: list) -> PurchaseOrder:
    order = PurchaseOrder(
        order_number=_next_number(db, "OT", PurchaseOrder),
        supplier=supplier,
        notes=notes,
        status=PurchaseOrderStatus.ORDERED,
    )
    db.add(order)
    db.flush()

    for line in lines:
        product = db.get(Product, line.product_id)
        if not product:
            raise ValueError(f"Tuotetta {line.product_id} ei löydy")
        db.add(
            PurchaseOrderLine(
                order_id=order.id,
                product_id=line.product_id,
                quantity=line.quantity,
            )
        )
        product.quantity_ordered += line.quantity
        _log_movement(
            db,
            product,
            "ostotilaus",
            line.quantity,
            reference=order.order_number,
            notes="Ostotilaus luotu",
        )

    return order


def receive_purchase_order(db: Session, order: PurchaseOrder, receive_lines: list) -> PurchaseOrder:
    if order.status == PurchaseOrderStatus.CANCELLED:
        raise ValueError("Peruttuja tilauksia ei voi vastaanottaa")

    line_map = {line.id: line for line in order.lines}
    for item in receive_lines:
        line = line_map.get(item.line_id)
        if not line:
            raise ValueError(f"Riviä {item.line_id} ei löydy")
        remaining = line.quantity - line.quantity_received
        if item.quantity > remaining:
            raise ValueError(
                f"Rivi {line.id}: vastaanotettava määrä ({item.quantity}) ylittää jäljellä olevan ({remaining})"
            )

        product = line.product
        line.quantity_received += item.quantity
        product.quantity_ordered = max(0, product.quantity_ordered - item.quantity)
        product.quantity_on_hand += item.quantity
        _log_movement(
            db,
            product,
            "vastaanotto",
            item.quantity,
            reference=order.order_number,
            notes="Ostotilaus vastaanotettu",
        )

    total = sum(line.quantity for line in order.lines)
    received = sum(line.quantity_received for line in order.lines)
    if received == 0:
        pass
    elif received >= total:
        order.status = PurchaseOrderStatus.RECEIVED
    else:
        order.status = PurchaseOrderStatus.PARTIALLY_RECEIVED

    return order


def create_sales_order(
    db: Session,
    customer: str,
    customer_phone: str,
    notes: Optional[str],
    lines: list,
    fulfillment_type,
    scheduled_date,
    created_by_employee_id: Optional[int] = None,
    customer_id: Optional[int] = None,
    services: Optional[list] = None,
) -> SalesOrder:
    normalized = _normalize_services(services)
    fulfillment = _fulfillment_from_services(normalized) if normalized else fulfillment_type
    order = SalesOrder(
        order_number=_next_number(db, "TIL", SalesOrder),
        customer=customer,
        customer_id=customer_id,
        customer_phone=customer_phone,
        notes=notes,
        fulfillment_type=fulfillment,
        scheduled_date=scheduled_date,
        created_by_employee_id=created_by_employee_id,
        status=SalesOrderStatus.RECEIVED,
    )
    db.add(order)
    db.flush()

    for line in lines:
        product = db.get(Product, line.product_id)
        if not product:
            raise ValueError(f"Tuotetta {line.product_id} ei löydy")
        db.add(
            SalesOrderLine(
                order_id=order.id,
                product_id=line.product_id,
                quantity=line.quantity,
            )
        )

    _log_order_event(db, order, "luotu", created_by_employee_id)
    _log_order_event(db, order, "vastaanotettu", created_by_employee_id)
    if services:
        _sync_order_services(db, order, services)
    return order


def approve_sales_order(db: Session, order: SalesOrder, employee_id: Optional[int] = None) -> SalesOrder:
    if order.status not in (SalesOrderStatus.RECEIVED, SalesOrderStatus.DRAFT):
        raise ValueError("Vain vastaanotettuja tilauksia voi hyväksyä")

    for line in order.lines:
        product = line.product
        pending = line.quantity - line.quantity_delivered
        if pending <= 0:
            continue
        if product.quantity_available < pending:
            raise ValueError(
                f"Tuote {product.sku}: varattava {pending}, saatavilla vain {product.quantity_available}"
            )

    for line in order.lines:
        product = line.product
        pending = line.quantity - line.quantity_delivered
        if pending <= 0:
            continue
        product.quantity_reserved += pending
        _log_movement(
            db,
            product,
            "varaus",
            pending,
            reference=order.order_number,
            notes="Myyntitilaus hyväksytty",
        )

    order.status = SalesOrderStatus.APPROVED
    _log_order_event(db, order, "hyvaksytty", employee_id)
    return order


def deliver_sales_order(db: Session, order: SalesOrder, deliver_lines: list, employee_id: Optional[int] = None) -> SalesOrder:
    if order.status not in (
        SalesOrderStatus.APPROVED,
        SalesOrderStatus.PARTIALLY_DELIVERED,
    ):
        raise ValueError("Toimitus vaatii hyväksytyn tilauksen")

    line_map = {line.id: line for line in order.lines}
    for item in deliver_lines:
        line = line_map.get(item.line_id)
        if not line:
            raise ValueError(f"Riviä {item.line_id} ei löydy")
        remaining = line.quantity - line.quantity_delivered
        if item.quantity > remaining:
            raise ValueError(
                f"Rivi {line.id}: toimitettava ({item.quantity}) ylittää jäljellä olevan ({remaining})"
            )

        product = line.product
        if product.quantity_reserved < item.quantity:
            raise ValueError(f"Tuote {product.sku}: varattua saldoa ei riitä toimitukseen")

        line.quantity_delivered += item.quantity
        product.quantity_reserved -= item.quantity
        product.quantity_on_hand -= item.quantity
        _log_movement(
            db,
            product,
            "toimitus",
            -item.quantity,
            reference=order.order_number,
            notes="Tuote toimitettu",
        )

    total = sum(line.quantity for line in order.lines)
    delivered = sum(line.quantity_delivered for line in order.lines)
    if delivered >= total:
        order.status = SalesOrderStatus.DELIVERED
        _log_order_event(db, order, "toimitettu", employee_id)
    elif delivered > 0:
        order.status = SalesOrderStatus.PARTIALLY_DELIVERED
        _log_order_event(db, order, "osittain_toimitettu", employee_id)

    return order


def cancel_sales_order(db: Session, order: SalesOrder, employee_id: Optional[int] = None) -> SalesOrder:
    if order.status in (SalesOrderStatus.DELIVERED, SalesOrderStatus.CANCELLED):
        raise ValueError("Tilausta ei voi perua")

    if order.status in (SalesOrderStatus.APPROVED, SalesOrderStatus.PARTIALLY_DELIVERED):
        for line in order.lines:
            product = line.product
            reserved_for_line = line.quantity - line.quantity_delivered
            if reserved_for_line > 0:
                release = min(reserved_for_line, product.quantity_reserved)
                product.quantity_reserved -= release
                _log_movement(
                    db,
                    product,
                    "varaus_peru",
                    -release,
                    reference=order.order_number,
                    notes="Myyntitilaus peruttu",
                )

    order.status = SalesOrderStatus.CANCELLED
    _log_order_event(db, order, "peruttu", employee_id)
    return order
