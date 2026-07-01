from pathlib import Path
from datetime import datetime, timedelta
import os
from typing import Optional

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from database import Base, SessionLocal, engine, get_db
from migrate import run_migrations
from models import (
    Customer,
    Employee,
    FulfillmentType,
    OrderStatusEvent,
    Product,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseOrderStatus,
    SalesOrder,
    SalesOrderLine,
    SalesOrderStatus,
    StockMovement,
)
from schemas import (
    AuthResponse,
    CustomerCreate,
    CustomerDetailOut,
    CustomerOut,
    CustomerUpdate,
    DashboardStats,
    DeliverSalesOrder,
    EmployeeOut,
    ImportResult,
    LoginRequest,
    OrderSearchOut,
    OrderLineIn,
    OrderTimelineEventOut,
    ProductCreate,
    ProductOut,
    ProductQuickCreate,
    ProductScanResult,
    ProductUpdate,
    PurchaseOrderCreate,
    PurchaseOrderLineOut,
    PurchaseOrderOut,
    ReceivePurchaseOrder,
    SalesOrderCreate,
    SalesOrderLineOut,
    SalesOrderOut,
    SalesOrderUpdate,
    StockMovementOut,
)
from services.auth import create_session, get_employee_by_token, logout
from services.import_service import create_sample_template, import_products_from_excel
from services.inventory import (
    EVENT_LABELS,
    _service_labels,
    _sync_order_services,
    approve_sales_order,
    cancel_sales_order,
    create_product,
    create_purchase_order,
    create_sales_order,
    deliver_sales_order,
    receive_purchase_order,
)

Base.metadata.create_all(bind=engine)
run_migrations()

app = FastAPI(title="Varastojärjestelmä", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"

DEMO_EMPLOYEES = [
    {"employee_number": "1001", "name": "Matti Meikäläinen"},
    {"employee_number": "1002", "name": "Liisa Laaksonen"},
    {"employee_number": "1003", "name": "Admin Käyttäjä"},
]


DEMO_CUSTOMERS = [
    {"name": "Rakennus Oy", "phone": "0401234567", "email": "tilaukset@rakennus.fi"},
    {"name": "Maalaamo Virtanen", "phone": "0509876543"},
    {"name": "Koti-Kalle", "phone": "0441112233", "address": "Esimerkkikatu 1, Helsinki"},
]

DEMO_PRODUCTS = [
    {"sku": "SKU-001", "name": "Ruuvi M6", "description": "Teräsruuvi", "manufacturer": "FixPlus", "wholesaler": "Rautakauppa Oy", "purchase_price": 0.15, "sale_price": 0.35, "quantity_on_hand": 100, "min_stock_level": 20},
    {"sku": "SKU-002", "name": "Mutteri M6", "description": "Teräsmutteri", "manufacturer": "FixPlus", "wholesaler": "Rautakauppa Oy", "purchase_price": 0.12, "sale_price": 0.29, "quantity_on_hand": 80, "min_stock_level": 15},
    {"sku": "SKU-003", "name": "Kiinnike", "description": "Seinäkiinnike", "manufacturer": "BuildPro", "wholesaler": "Tukkuri Nord", "purchase_price": 2.50, "sale_price": 4.90, "quantity_on_hand": 25, "min_stock_level": 10},
    {"sku": "SKU-004", "name": "Pulttisarja", "description": "10 kpl pultteja", "manufacturer": "FixPlus", "wholesaler": "Rautakauppa Oy", "purchase_price": 3.20, "sale_price": 6.50, "quantity_on_hand": 45, "min_stock_level": 10},
]


def ensure_employees(db: Session) -> None:
    if db.query(Employee).count() == 0:
        for item in DEMO_EMPLOYEES:
            db.add(Employee(**item))
        db.commit()


def ensure_customers(db: Session) -> None:
    if db.query(Customer).count() == 0:
        for item in DEMO_CUSTOMERS:
            db.add(Customer(**item))
        db.commit()


def seed_demo_products(db: Session) -> None:
    if db.query(Product).count() > 0:
        return
    for item in DEMO_PRODUCTS:
        create_product(db, item)
    db.commit()


def seed_demo_orders(db: Session) -> None:
    if db.query(SalesOrder).count() > 0:
        return
    products = {p.sku: p for p in db.query(Product).all()}
    customers = {c.phone: c for c in db.query(Customer).all()}
    employee = db.query(Employee).first()
    if not products or not customers or not employee:
        return

    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    demos = [
        {
            "customer_phone": "0401234567",
            "services": ["toimitus", "asennus"],
            "lines": [("SKU-001", 10)],
            "days_offset": 2,
            "approve": False,
        },
        {
            "customer_phone": "0441112233",
            "services": ["nouto"],
            "lines": [("SKU-003", 1)],
            "days_offset": 0,
            "approve": False,
        },
        {
            "customer_phone": "0509876543",
            "services": ["toimitus"],
            "lines": [("SKU-002", 5)],
            "days_offset": 1,
            "approve": True,
        },
    ]

    for demo in demos:
        customer = customers.get(demo["customer_phone"])
        if not customer:
            continue
        lines = []
        for sku, quantity in demo["lines"]:
            product = products.get(sku)
            if not product:
                continue
            lines.append(OrderLineIn(product_id=product.id, quantity=quantity))
        if not lines:
            continue
        order = create_sales_order(
            db,
            customer.name,
            customer.phone,
            None,
            lines,
            FulfillmentType.TOIMITUS,
            today + timedelta(days=demo["days_offset"]),
            employee.id,
            customer.id,
            demo["services"],
        )
        if demo["approve"]:
            approve_sales_order(db, order, employee.id)

    db.commit()


@app.on_event("startup")
def startup() -> None:
    db = SessionLocal()
    try:
        ensure_employees(db)
        ensure_customers(db)
        if os.environ.get("AUTO_SEED", "0") == "1":
            seed_demo_products(db)
        seed_demo_orders(db)
    finally:
        db.close()


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api/") or path == "/api/auth/login":
        return await call_next(request)

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"detail": "Kirjaudu sisään työntekijänumerolla"})

    token = auth[7:]
    db = SessionLocal()
    try:
        employee = get_employee_by_token(db, token)
        if not employee or not employee.active:
            return JSONResponse(status_code=401, content={"detail": "Istunto vanhentunut – kirjaudu uudelleen"})
        request.state.employee = employee
        request.state.token = token
        return await call_next(request)
    finally:
        db.close()


def _product_out(product: Product) -> ProductOut:
    return ProductOut(
        id=product.id,
        sku=product.sku,
        name=product.name,
        description=product.description,
        manufacturer=product.manufacturer,
        wholesaler=product.wholesaler,
        purchase_price=product.purchase_price,
        sale_price=product.sale_price,
        unit=product.unit,
        min_stock_level=product.min_stock_level,
        quantity_on_hand=product.quantity_on_hand,
        quantity_ordered=product.quantity_ordered,
        quantity_reserved=product.quantity_reserved,
        quantity_available=product.quantity_available,
        created_at=product.created_at,
    )


def _purchase_out(order: PurchaseOrder) -> PurchaseOrderOut:
    return PurchaseOrderOut(
        id=order.id,
        order_number=order.order_number,
        supplier=order.supplier,
        status=order.status,
        notes=order.notes,
        created_at=order.created_at,
        lines=[
            PurchaseOrderLineOut(
                id=line.id,
                product_id=line.product_id,
                quantity=line.quantity,
                quantity_received=line.quantity_received,
                product_sku=line.product.sku if line.product else None,
                product_name=line.product.name if line.product else None,
            )
            for line in order.lines
        ],
    )


def _sales_order_options():
    return (
        joinedload(SalesOrder.lines).joinedload(SalesOrderLine.product),
        joinedload(SalesOrder.created_by),
        joinedload(SalesOrder.services),
    )


def _sales_out(order: SalesOrder) -> SalesOrderOut:
    return SalesOrderOut(
        id=order.id,
        order_number=order.order_number,
        customer=order.customer,
        customer_id=order.customer_id,
        customer_phone=order.customer_phone,
        status=order.status,
        notes=order.notes,
        fulfillment_type=order.fulfillment_type or FulfillmentType.TOIMITUS,
        scheduled_date=order.scheduled_date,
        created_by_name=order.created_by.name if order.created_by else None,
        created_at=order.created_at,
        services=[s.service_type for s in order.services],
        lines=[
            SalesOrderLineOut(
                id=line.id,
                product_id=line.product_id,
                quantity=line.quantity,
                quantity_delivered=line.quantity_delivered,
                product_sku=line.product.sku if line.product else None,
                product_name=line.product.name if line.product else None,
            )
            for line in order.lines
        ],
    )


def _order_search_out(order: SalesOrder) -> OrderSearchOut:
    parts = []
    for line in order.lines:
        name = line.product.name if line.product else "?"
        sku = line.product.sku if line.product else "?"
        parts.append(f"{name} ({sku}) × {line.quantity}")
    svc_labels = _service_labels(order)
    return OrderSearchOut(
        id=order.id,
        order_number=order.order_number,
        customer=order.customer,
        customer_id=order.customer_id,
        customer_phone=order.customer_phone,
        status=order.status,
        notes=order.notes,
        fulfillment_type=order.fulfillment_type or FulfillmentType.TOIMITUS,
        scheduled_date=order.scheduled_date,
        created_at=order.created_at,
        product_summary=", ".join(parts),
        services=[s.service_type for s in order.services],
        services_summary=", ".join(svc_labels),
        created_by_name=order.created_by.name if order.created_by else None,
    )


@app.post("/api/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    number = payload.employee_number.strip()
    employee = db.query(Employee).filter(Employee.employee_number == number, Employee.active.is_(True)).first()
    if not employee:
        raise HTTPException(401, "Työntekijänumeroa ei löydy")
    token = create_session(employee)
    return AuthResponse(token=token, employee=EmployeeOut.model_validate(employee))


@app.post("/api/auth/logout")
def logout_user(request: Request):
    token = getattr(request.state, "token", None)
    if token:
        logout(token)
    return {"message": "Uloskirjautuminen onnistui"}


@app.get("/api/auth/me", response_model=EmployeeOut)
def current_user(request: Request):
    return EmployeeOut.model_validate(request.state.employee)


@app.get("/api/dashboard", response_model=DashboardStats)
def dashboard(db: Session = Depends(get_db)):
    products = db.query(Product).all()
    pending_sales = (
        db.query(SalesOrder)
        .filter(
            SalesOrder.status.in_(
                [
                    SalesOrderStatus.RECEIVED,
                    SalesOrderStatus.APPROVED,
                    SalesOrderStatus.PARTIALLY_DELIVERED,
                ]
            )
        )
        .count()
    )
    pending_purchase = (
        db.query(PurchaseOrder)
        .filter(
            PurchaseOrder.status.in_(
                [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED]
            )
        )
        .count()
    )
    return DashboardStats(
        product_count=len(products),
        low_stock_count=sum(1 for p in products if p.quantity_available <= p.min_stock_level),
        pending_sales_orders=pending_sales,
        pending_purchase_orders=pending_purchase,
        total_on_hand=sum(p.quantity_on_hand for p in products),
        total_reserved=sum(p.quantity_reserved for p in products),
        total_ordered=sum(p.quantity_ordered for p in products),
        total_inventory_value=sum(
            p.quantity_on_hand * (p.purchase_price or 0) for p in products
        ),
    )


@app.get("/api/products/scan", response_model=ProductScanResult)
def scan_product(sku: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    code = sku.strip()
    product = db.query(Product).filter(Product.sku.ilike(code)).first()
    if product:
        return ProductScanResult(found=True, sku=product.sku, product=_product_out(product))
    return ProductScanResult(found=False, sku=code, product=None)


@app.get("/api/products/lookup", response_model=ProductOut)
def lookup_product(sku: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    code = sku.strip()
    product = db.query(Product).filter(Product.sku.ilike(code)).first()
    if not product:
        raise HTTPException(404, f"Tuotetta koodilla '{code}' ei löydy")
    return _product_out(product)


@app.post("/api/products/quick", response_model=ProductOut, status_code=201)
def quick_create_product(payload: ProductQuickCreate, db: Session = Depends(get_db)):
    code = payload.sku.strip()
    existing = db.query(Product).filter(Product.sku.ilike(code)).first()
    if existing:
        raise HTTPException(400, f"Tuote koodilla '{code}' on jo olemassa")
    try:
        product = create_product(
            db,
            {
                "sku": code,
                "name": payload.name.strip(),
                "quantity_on_hand": payload.quantity_on_hand,
                "unit": payload.unit,
            },
        )
        db.commit()
        db.refresh(product)
        return _product_out(product)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/customers", response_model=list[CustomerOut])
def list_customers(q: Optional[str] = Query(None), db: Session = Depends(get_db)):
    query = db.query(Customer).order_by(Customer.name)
    if q:
        term = q.strip()
        words = [w for w in term.lower().split() if w]
        if len(words) == 1:
            pattern = f"%{words[0]}%"
            query = query.filter(
                or_(
                    Customer.name.ilike(pattern),
                    Customer.phone.ilike(pattern),
                    Customer.email.ilike(pattern),
                )
            )
        elif words:
            for word in words:
                query = query.filter(Customer.name.ilike(f"%{word}%"))
    return [CustomerOut.model_validate(c) for c in query.limit(20).all()]


@app.get("/api/customers/{customer_id}", response_model=CustomerDetailOut)
def get_customer(customer_id: int, db: Session = Depends(get_db)):
    customer = db.get(Customer, customer_id)
    if not customer:
        raise HTTPException(404, "Asiakasta ei löydy")
    orders = (
        db.query(SalesOrder)
        .options(*_sales_order_options())
        .filter(
            or_(
                SalesOrder.customer_id == customer_id,
                SalesOrder.customer_phone == customer.phone,
            )
        )
        .order_by(SalesOrder.created_at.desc())
        .all()
    )
    return CustomerDetailOut(
        **CustomerOut.model_validate(customer).model_dump(),
        orders=[_order_search_out(o) for o in orders],
    )


@app.post("/api/customers", response_model=CustomerOut, status_code=201)
def add_customer(payload: CustomerCreate, db: Session = Depends(get_db)):
    customer = Customer(**payload.model_dump())
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return CustomerOut.model_validate(customer)


@app.patch("/api/customers/{customer_id}", response_model=CustomerOut)
def update_customer(customer_id: int, payload: CustomerUpdate, db: Session = Depends(get_db)):
    customer = db.get(Customer, customer_id)
    if not customer:
        raise HTTPException(404, "Asiakasta ei löydy")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(customer, key, value)
    db.commit()
    db.refresh(customer)
    return CustomerOut.model_validate(customer)


@app.get("/api/products", response_model=list[ProductOut])
def list_products(db: Session = Depends(get_db)):
    return [_product_out(p) for p in db.query(Product).order_by(Product.name).all()]


@app.post("/api/products", response_model=ProductOut, status_code=201)
def add_product(payload: ProductCreate, db: Session = Depends(get_db)):
    if db.query(Product).filter(Product.sku == payload.sku).first():
        raise HTTPException(400, "SKU on jo käytössä")
    product = create_product(db, payload.model_dump())
    db.commit()
    db.refresh(product)
    return _product_out(product)


@app.patch("/api/products/{product_id}", response_model=ProductOut)
def update_product(product_id: int, payload: ProductUpdate, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(404, "Tuotetta ei löydy")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(product, key, value)
    db.commit()
    db.refresh(product)
    return _product_out(product)


@app.get("/api/orders", response_model=list[OrderSearchOut])
def search_orders(
    q: Optional[str] = Query(None),
    fulfillment: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = (
        db.query(SalesOrder)
        .options(*_sales_order_options())
        .order_by(SalesOrder.created_at.desc())
    )
    if fulfillment in ("toimitus", "nouto"):
        query = query.filter(SalesOrder.fulfillment_type == fulfillment)
    if q:
        term = f"%{q.strip().lower()}%"
        query = query.filter(
            or_(
                SalesOrder.order_number.ilike(term),
                SalesOrder.customer.ilike(term),
                SalesOrder.customer_phone.ilike(term),
                SalesOrder.lines.any(
                    or_(
                        SalesOrderLine.product.has(Product.name.ilike(term)),
                        SalesOrderLine.product.has(Product.sku.ilike(term)),
                    )
                ),
            )
        )
    return [_order_search_out(o) for o in query.all()]


@app.get("/api/purchase-orders", response_model=list[PurchaseOrderOut])
def list_purchase_orders(db: Session = Depends(get_db)):
    orders = (
        db.query(PurchaseOrder)
        .options(joinedload(PurchaseOrder.lines).joinedload(PurchaseOrderLine.product))
        .order_by(PurchaseOrder.created_at.desc())
        .all()
    )
    return [_purchase_out(o) for o in orders]


@app.post("/api/purchase-orders", response_model=PurchaseOrderOut, status_code=201)
def add_purchase_order(payload: PurchaseOrderCreate, db: Session = Depends(get_db)):
    try:
        order = create_purchase_order(db, payload.supplier, payload.notes, payload.lines)
        db.commit()
        db.refresh(order)
        order = (
            db.query(PurchaseOrder)
            .options(joinedload(PurchaseOrder.lines).joinedload(PurchaseOrderLine.product))
            .get(order.id)
        )
        return _purchase_out(order)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/purchase-orders/{order_id}/receive", response_model=PurchaseOrderOut)
def receive_order(order_id: int, payload: ReceivePurchaseOrder, db: Session = Depends(get_db)):
    order = (
        db.query(PurchaseOrder)
        .options(joinedload(PurchaseOrder.lines).joinedload(PurchaseOrderLine.product))
        .filter(PurchaseOrder.id == order_id)
        .first()
    )
    if not order:
        raise HTTPException(404, "Ostotilausta ei löydy")
    try:
        receive_purchase_order(db, order, payload.lines)
        db.commit()
        db.refresh(order)
        return _purchase_out(order)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/sales-orders", response_model=list[SalesOrderOut])
def list_sales_orders(db: Session = Depends(get_db)):
    orders = (
        db.query(SalesOrder)
        .options(*_sales_order_options())
        .order_by(SalesOrder.created_at.desc())
        .all()
    )
    return [_sales_out(o) for o in orders]


@app.post("/api/sales-orders", response_model=SalesOrderOut, status_code=201)
def add_sales_order(payload: SalesOrderCreate, request: Request, db: Session = Depends(get_db)):
    try:
        scheduled = payload.scheduled_date
        if scheduled:
            scheduled_dt = datetime.combine(scheduled, datetime.min.time())
        else:
            scheduled_dt = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        order = create_sales_order(
            db,
            payload.customer,
            payload.customer_phone,
            payload.notes,
            payload.lines,
            payload.fulfillment_type,
            scheduled_dt,
            request.state.employee.id,
            payload.customer_id,
            payload.services,
        )
        db.commit()
        db.refresh(order)
        order = db.query(SalesOrder).options(*_sales_order_options()).get(order.id)
        return _sales_out(order)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc)) from exc


@app.patch("/api/sales-orders/{order_id}", response_model=SalesOrderOut)
def update_sales_order(order_id: int, payload: SalesOrderUpdate, db: Session = Depends(get_db)):
    order = (
        db.query(SalesOrder)
        .options(*_sales_order_options())
        .filter(SalesOrder.id == order_id)
        .first()
    )
    if not order:
        raise HTTPException(404, "Tilausta ei löydy")
    if order.status in (SalesOrderStatus.DELIVERED, SalesOrderStatus.CANCELLED):
        raise HTTPException(400, "Toimitettuja tai peruttuja tilauksia ei voi muokata")

    data = payload.model_dump(exclude_unset=True)
    services = data.pop("services", None)
    if "scheduled_date" in data and data["scheduled_date"]:
        data["scheduled_date"] = datetime.combine(data["scheduled_date"], datetime.min.time())
    for key, value in data.items():
        setattr(order, key, value)
    if services is not None:
        _sync_order_services(db, order, services)
    db.commit()
    db.refresh(order)
    order = db.query(SalesOrder).options(*_sales_order_options()).get(order.id)
    return _sales_out(order)


@app.post("/api/sales-orders/{order_id}/approve", response_model=SalesOrderOut)
def approve_order(order_id: int, request: Request, db: Session = Depends(get_db)):
    order = (
        db.query(SalesOrder)
        .options(*_sales_order_options())
        .filter(SalesOrder.id == order_id)
        .first()
    )
    if not order:
        raise HTTPException(404, "Myyntitilausta ei löydy")
    try:
        approve_sales_order(db, order, request.state.employee.id)
        db.commit()
        db.refresh(order)
        return _sales_out(order)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/sales-orders/{order_id}/deliver", response_model=SalesOrderOut)
def deliver_order(order_id: int, payload: DeliverSalesOrder, request: Request, db: Session = Depends(get_db)):
    order = (
        db.query(SalesOrder)
        .options(*_sales_order_options())
        .filter(SalesOrder.id == order_id)
        .first()
    )
    if not order:
        raise HTTPException(404, "Myyntitilausta ei löydy")
    try:
        deliver_sales_order(db, order, payload.lines, request.state.employee.id)
        db.commit()
        db.refresh(order)
        return _sales_out(order)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/sales-orders/{order_id}/cancel", response_model=SalesOrderOut)
def cancel_order(order_id: int, request: Request, db: Session = Depends(get_db)):
    order = (
        db.query(SalesOrder)
        .options(*_sales_order_options())
        .filter(SalesOrder.id == order_id)
        .first()
    )
    if not order:
        raise HTTPException(404, "Myyntitilausta ei löydy")
    try:
        cancel_sales_order(db, order, request.state.employee.id)
        db.commit()
        db.refresh(order)
        return _sales_out(order)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/sales-orders/{order_id}/timeline", response_model=list[OrderTimelineEventOut])
def order_timeline(order_id: int, db: Session = Depends(get_db)):
    order = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.status_events).joinedload(OrderStatusEvent.employee))
        .filter(SalesOrder.id == order_id)
        .first()
    )
    if not order:
        raise HTTPException(404, "Tilausta ei löydy")

    events = sorted(order.status_events, key=lambda e: e.created_at)
    if events:
        return [
            OrderTimelineEventOut(
                event_type=e.event_type,
                label=EVENT_LABELS.get(e.event_type, e.event_type),
                created_at=e.created_at,
                employee_name=e.employee.name if e.employee else None,
                notes=e.notes,
            )
            for e in events
        ]

    # Vanhat tilaukset ilman tapahtumia
    fallback = [OrderTimelineEventOut(
        event_type="luotu",
        label=EVENT_LABELS["luotu"],
        created_at=order.created_at,
        employee_name=order.created_by.name if order.created_by else None,
    )]
    if order.status.value in ("hyvaksytty", "osittain_toimitettu", "toimitettu"):
        fallback.append(OrderTimelineEventOut(
            event_type="hyvaksytty",
            label=EVENT_LABELS["hyvaksytty"],
            created_at=order.updated_at,
        ))
    if order.status.value in ("osittain_toimitettu", "toimitettu"):
        fallback.append(OrderTimelineEventOut(
            event_type="toimitettu" if order.status.value == "toimitettu" else "osittain_toimitettu",
            label=EVENT_LABELS.get(order.status.value, order.status.value),
            created_at=order.updated_at,
        ))
    if order.status.value == "peruttu":
        fallback.append(OrderTimelineEventOut(
            event_type="peruttu",
            label=EVENT_LABELS["peruttu"],
            created_at=order.updated_at,
        ))
    return fallback


@app.get("/api/movements", response_model=list[StockMovementOut])
def list_movements(db: Session = Depends(get_db)):
    movements = (
        db.query(StockMovement)
        .options(joinedload(StockMovement.product))
        .order_by(StockMovement.created_at.desc())
        .limit(200)
        .all()
    )
    return [
        StockMovementOut(
            id=m.id,
            product_id=m.product_id,
            movement_type=m.movement_type,
            quantity=m.quantity,
            reference=m.reference,
            notes=m.notes,
            created_at=m.created_at,
            product_sku=m.product.sku if m.product else None,
            product_name=m.product.name if m.product else None,
        )
        for m in movements
    ]


@app.post("/api/import/products", response_model=ImportResult)
async def import_products(file: UploadFile = File(...), db: Session = Depends(get_db)):
    content = await file.read()
    result = import_products_from_excel(db, content)
    db.commit()
    return ImportResult(**result)


@app.get("/api/import/template")
def download_template():
    data = create_sample_template()
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="tuotteet_malli.xlsx"'},
    )


@app.post("/api/seed")
def seed_demo_data(db: Session = Depends(get_db)):
    created = []
    if db.query(Product).count() == 0:
        seed_demo_products(db)
        created.append("products")
    if db.query(SalesOrder).count() == 0:
        seed_demo_orders(db)
        created.append("orders")
    if not created:
        raise HTTPException(400, "Tietokannassa on jo dataa")
    return {"message": "Esimerkkidata luotu", "created": created}


@app.get("/manifest.webmanifest")
def web_manifest():
    manifest_file = FRONTEND / "manifest.webmanifest"
    if manifest_file.exists():
        return FileResponse(manifest_file, media_type="application/manifest+json")
    raise HTTPException(404, "Manifest not found")


@app.get("/sw.js")
def service_worker():
    sw_file = FRONTEND / "sw.js"
    if sw_file.exists():
        return FileResponse(sw_file, media_type="application/javascript")
    raise HTTPException(404, "Service worker not found")


if FRONTEND.exists():
    app.mount("/static", StaticFiles(directory=FRONTEND), name="static")


@app.get("/")
def index():
    index_file = FRONTEND / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"message": "Varastojärjestelmä API käynnissä"}
