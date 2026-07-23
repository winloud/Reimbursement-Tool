from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator


class RailTicketCandidate(BaseModel):
    id: str
    file_name: str
    travel_date: date | None = None
    depart_station: str | None = None
    arrive_station: str | None = None
    train_no: str | None = None
    seat_class: str | None = None
    seat_no: str | None = None
    amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    invoice_no: str | None = None
    invoice_date: date | None = None
    preview_image: str | None = None
    parse_warnings: list[str] = Field(default_factory=list)
    duplicate: bool = False
    duplicate_reason: str | None = None


class RailTicketGroup(BaseModel):
    id: str
    ticket_ids: list[str] = Field(min_length=1)
    suggested_merge: bool = False
    cross_day: bool = False
    round_trip: bool = False
    route_loop: bool = False
    path: list[str] = Field(default_factory=list)
    total_amount: Decimal = Decimal("0.00")
    warning: str | None = None


class RailTicketPreview(BaseModel):
    token: str
    expires_at: datetime
    tickets: list[RailTicketCandidate]
    warnings: list[str] = Field(default_factory=list)


class RailTicketImportCandidate(BaseModel):
    id: str
    travel_date: date
    depart_station: str = Field(min_length=1)
    arrive_station: str = Field(min_length=1)
    train_no: str | None = None
    seat_class: str | None = None
    seat_no: str | None = None
    amount: Decimal = Field(ge=0)
    invoice_no: str | None = None
    invoice_date: date | None = None

    @field_validator("depart_station", "arrive_station")
    @classmethod
    def validate_station(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("出发站和到达站不能为空")
        return normalized


class RailTicketImportGroup(BaseModel):
    ticket_ids: list[str] = Field(min_length=1)
    merge: bool = False


class RailTicketImportRequest(BaseModel):
    token: str = Field(min_length=1)
    tickets: list[RailTicketImportCandidate] = Field(min_length=1)
    groups: list[RailTicketImportGroup] = Field(min_length=1)


class RailTicketImportResult(BaseModel):
    trip_ids: list[int]
    invoice_ids: list[int]
