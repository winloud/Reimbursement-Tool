from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Path, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.database.connection import PROJECT_ROOT
from backend.database.session import get_db
from backend.schemas.common import ApiResponse
from backend.schemas.invoice import InvoiceRead, InvoiceUpdate, InvoiceUploadResult
from backend.services.invoice_service import get_invoice_or_404, soft_delete_invoice, update_invoice, upload_invoice

router = APIRouter(prefix="/api/invoices", tags=["invoices"])


@router.post("/upload", response_model=ApiResponse[InvoiceUploadResult])
def post_invoice_upload(
    report_id: Annotated[int, Form(ge=1)],
    expense_category: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    trip_id: Annotated[int | None, Form()] = None,
    db: Session = Depends(get_db),
) -> ApiResponse[InvoiceUploadResult]:
    invoice, parsed = upload_invoice(db, report_id, expense_category, file, trip_id)
    return ApiResponse(data=InvoiceUploadResult.model_validate(invoice).model_copy(update={"parsed": parsed}), message="发票已上传")


@router.get("/{invoice_id}/file")
def get_invoice_file(
    invoice_id: Annotated[int, Path(ge=1)],
    db: Session = Depends(get_db),
) -> FileResponse:
    invoice = get_invoice_or_404(db, invoice_id)
    file_path = PROJECT_ROOT / "backend" / invoice.file_path
    return FileResponse(file_path)


@router.put("/{invoice_id}", response_model=ApiResponse[InvoiceRead])
def put_invoice(
    invoice_id: Annotated[int, Path(ge=1)],
    payload: InvoiceUpdate,
    db: Session = Depends(get_db),
) -> ApiResponse[InvoiceRead]:
    return ApiResponse(data=update_invoice(db, invoice_id, payload), message="发票已更新")


@router.delete("/{invoice_id}", response_model=ApiResponse[None])
def delete_invoice(
    invoice_id: Annotated[int, Path(ge=1)],
    db: Session = Depends(get_db),
) -> ApiResponse[None]:
    soft_delete_invoice(db, invoice_id)
    return ApiResponse(message="发票已删除")
