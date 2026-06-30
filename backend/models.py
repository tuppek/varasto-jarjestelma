from __future__ import annotations

import enum
from datetime import datetime
from typing import List, Optional

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class PurchaseOrderStatus(str, enum.Enum):
    DRAFT = "luonnos"
    ORDERED = "tilattu"
    PARTIALLY_RECEIVED = "osittain_vastaanotettu"
    RECEIVED = "vastaanotettu"
    CANCELLED = "peruttu"


class SalesOrderStatus(str, enum.Enum):
    DRAFT = "luonnos"
    RECEIVED = "vastaanotettu"
    APPROVED = "hyvaksytty"
    PARTIALLY_DELIVERED = "osittain_toimitettu"
    DELIVERED = "toimitettu"
    CANCELLED = "peruttu"


class FulfillmentType(str, enum.Enum):
    TOIMITUS = "toimitus"
    NOUTO = "nouto"


class ServiceType(str, enum.Enum):
    KULJETUS = "kuljetus"
    ASENNUS = "asennus"


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    phone: Mapped[str] = mapped_column(String(64))
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    sales_orders: Mapped[List["SalesOrder"]] = relationship(back_populates="customer_ref")


class OrderStatusEvent(Base):
    __tablename__ = "order_status_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("sales_orders.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    employee_id: Mapped[Optional[int]] = mapped_column(ForeignKey("employees.id"), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    order: Mapped["SalesOrder"] = relationship(back_populates="status_events")
    employee: Mapped[Optional["Employee"]] = relationship()


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    employee_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    sales_orders: Mapped[List["SalesOrder"]] = relationship(back_populates="created_by")


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    sku: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    manufacturer: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    wholesaler: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    purchase_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sale_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    unit: Mapped[str] = mapped_column(String(32), default="kpl")
    quantity_on_hand: Mapped[int] = mapped_column(Integer, default=0)
    quantity_ordered: Mapped[int] = mapped_column(Integer, default=0)
    quantity_reserved: Mapped[int] = mapped_column(Integer, default=0)
    min_stock_level: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    purchase_lines: Mapped[List["PurchaseOrderLine"]] = relationship(back_populates="product")
    sales_lines: Mapped[List["SalesOrderLine"]] = relationship(back_populates="product")

    @property
    def quantity_available(self) -> int:
        return self.quantity_on_hand - self.quantity_reserved


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_number: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    supplier: Mapped[str] = mapped_column(String(255))
    status: Mapped[PurchaseOrderStatus] = mapped_column(
        Enum(PurchaseOrderStatus), default=PurchaseOrderStatus.DRAFT
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    lines: Mapped[List["PurchaseOrderLine"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )


class PurchaseOrderLine(Base):
    __tablename__ = "purchase_order_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    quantity_received: Mapped[int] = mapped_column(Integer, default=0)

    order: Mapped["PurchaseOrder"] = relationship(back_populates="lines")
    product: Mapped["Product"] = relationship(back_populates="purchase_lines")


class SalesOrder(Base):
    __tablename__ = "sales_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_number: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    customer: Mapped[str] = mapped_column(String(255))
    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"), nullable=True)
    customer_phone: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    status: Mapped[SalesOrderStatus] = mapped_column(
        Enum(SalesOrderStatus), default=SalesOrderStatus.DRAFT
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    fulfillment_type: Mapped[FulfillmentType] = mapped_column(
        Enum(FulfillmentType, values_callable=lambda x: [e.value for e in x]),
        default=FulfillmentType.TOIMITUS,
    )
    scheduled_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_by_employee_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("employees.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    lines: Mapped[List["SalesOrderLine"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )
    created_by: Mapped[Optional["Employee"]] = relationship(back_populates="sales_orders")
    customer_ref: Mapped[Optional["Customer"]] = relationship(back_populates="sales_orders")
    status_events: Mapped[List["OrderStatusEvent"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )
    services: Mapped[List["SalesOrderService"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )


class SalesOrderService(Base):
    __tablename__ = "sales_order_services"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("sales_orders.id"))
    service_type: Mapped[str] = mapped_column(String(64))

    order: Mapped["SalesOrder"] = relationship(back_populates="services")


class SalesOrderLine(Base):
    __tablename__ = "sales_order_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("sales_orders.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    quantity_delivered: Mapped[int] = mapped_column(Integer, default=0)

    order: Mapped["SalesOrder"] = relationship(back_populates="lines")
    product: Mapped["Product"] = relationship(back_populates="sales_lines")


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    movement_type: Mapped[str] = mapped_column(String(64))
    quantity: Mapped[int] = mapped_column(Integer)
    reference: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    product: Mapped["Product"] = relationship()
