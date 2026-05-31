from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict

DataT = TypeVar("DataT")


class ApiResponse(BaseModel, Generic[DataT]):
    success: bool = True
    message: str = ""
    data: DataT | None = None

    model_config = ConfigDict(from_attributes=True)


class PaginationData(BaseModel, Generic[DataT]):
    items: list[DataT]
    total: int
    page: int
    page_size: int
