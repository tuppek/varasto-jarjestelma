from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from models import FulfillmentType, PurchaseOrderStatus, SalesOrderStatus


class LoginRequest(BaseModel):
    employee_number: str


class EmployeeOut(BaseModel):
    id: int
    employee_number: str
    name: str

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    token: str
    employee: EmployeeOut


class ProductBase(BaseModel):
    sku: str
    name: str
    description: Optional[str] = None
    manufacturer: Optional[str] = None
    wholesaler: Optional[str] = None
    unit: str = "kpl"
    min_stock_level: int = 0


class ProductCreate(ProductBase):
    quantity_on_hand: int = 0
    quantity_ordered: int = 0
    quantity_reserved: int = 0


class ProductQuickCreate(BaseModel):
    sku: str = Field(min_length=1)
    name: str = Field(min_length=1)
    quantity_on_hand: int = 0
    unit: str = "kpl"


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    manufacturer: Optional[str] = None
    wholesaler: Optional[str] = None
    unit: Optional[str] = None
    min_stock_level: Optional[int] = None


class ProductOut(ProductBase):
    id: int
    quantity_on_hand: int
    quantity_ordered: int
    quantity_reserved: int
    quantity_available: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ProductScanResult(BaseModel):
    found: bool
    sku: str
    product: Optional[ProductOut] = None


class OrderLineIn(BaseModel):
    product_id: int
    quantity: int = Field(gt=0)


class PurchaseOrderCreate(BaseModel):
    supplier: str
    notes: Optional[str] = None
    lines: List[OrderLineIn]


class PurchaseOrderLineOut(BaseModel):
    id: int
    product_id: int
    quantity: int
    quantity_received: int
    product_sku: Optional[str] = None
    product_name: Optional[str] = None

    model_config = {"from_attributes": True}


class PurchaseOrderOut(BaseModel):
    id: int
    order_number: str
    supplier: str
    status: PurchaseOrderStatus
    notes: Optional[str]
    created_at: datetime
    lines: List[PurchaseOrderLineOut]

    model_config = {"from_attributes": True}


class ReceivePurchaseLine(BaseModel):
    line_id: int
    quantity: int = Field(gt=0)


class ReceivePurchaseOrder(BaseModel):
    lines: List[ReceivePurchaseLine]


class SalesOrderCreate(BaseModel):
    customer: str
    customer_id: Optional[int] = None
    customer_phone: str = Field(min_length=5)
    notes: Optional[str] = None
    fulfillment_type: FulfillmentType = FulfillmentType.TOIMITUS
    scheduled_date: Optional[date] = None
    services: List[str] = []
    lines: List[OrderLineIn]


class SalesOrderUpdate(BaseModel):
    customer: Optional[str] = None
    customer_id: Optional[int] = None
    customer_phone: Optional[str] = None
    notes: Optional[str] = None
    fulfillment_type: Optional[FulfillmentType] = None
    scheduled_date: Optional[date] = None
    services: Optional[List[str]] = None


class CustomerCreate(BaseModel):
    name: str
    phone: str = Field(min_length=5)
    email: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


class CustomerOut(BaseModel):
    id: int
    name: str
    phone: str
    email: Optional[str]
    address: Optional[str]
    notes: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class OrderTimelineEventOut(BaseModel):
    event_type: str
    label: str
    created_at: datetime
    employee_name: Optional[str] = None
    notes: Optional[str] = None


class SalesOrderLineOut(BaseModel):
    id: int
    product_id: int
    quantity: int
    quantity_delivered: int
    product_sku: Optional[str] = None
    product_name: Optional[str] = None

    model_config = {"from_attributes": True}


class SalesOrderOut(BaseModel):
    id: int
    order_number: str
    customer: str
    customer_id: Optional[int] = None
    customer_phone: Optional[str] = None
    status: SalesOrderStatus
    notes: Optional[str]
    fulfillment_type: FulfillmentType
    scheduled_date: Optional[datetime]
    created_by_name: Optional[str] = None
    created_at: datetime
    services: List[str] = []
    lines: List[SalesOrderLineOut]

    model_config = {"from_attributes": True}


class OrderSearchOut(BaseModel):
    id: int
    order_number: str
    customer: str
    customer_id: Optional[int] = None
    customer_phone: Optional[str] = None
    status: SalesOrderStatus
    notes: Optional[str] = None
    fulfillment_type: FulfillmentType
    scheduled_date: Optional[datetime]
    created_at: datetime
    product_summary: str
    services: List[str] = []
    services_summary: str = ""
    created_by_name: Optional[str] = None


class DeliverSalesLine(BaseModel):
    line_id: int
    quantity: int = Field(gt=0)


class DeliverSalesOrder(BaseModel):
    lines: List[DeliverSalesLine]


class StockMovementOut(BaseModel):
    id: int
    product_id: int
    movement_type: str
    quantity: int
    reference: Optional[str]
    notes: Optional[str]
    created_at: datetime
    product_sku: Optional[str] = None
    product_name: Optional[str] = None

    model_config = {"from_attributes": True}


class DashboardStats(BaseModel):
    product_count: int
    low_stock_count: int
    pending_sales_orders: int
    pending_purchase_orders: int
    total_on_hand: int
    total_reserved: int
    total_ordered: int


class ImportResult(BaseModel):
    created: int
    updated: int
    errors: List[str]
