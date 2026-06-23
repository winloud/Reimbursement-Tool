from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Path, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.database.session import get_db
from backend.schemas.common import ApiResponse
from backend.schemas.invoice import InvoiceParsedData, InvoiceRead, InvoiceUpdate, InvoiceUploadResult
from backend.services.invoice_service import get_invoice_or_404, parse_existing_invoice, soft_delete_invoice, update_invoice, upload_invoices
from backend.runtime_paths import uploaded_path

router = APIRouter(prefix="/api/invoices", tags=["invoices"])


@router.post("/upload", response_model=ApiResponse[list[InvoiceUploadResult]])
def post_invoice_upload(
    report_id: Annotated[int, Form(ge=1)],
    expense_category: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    trip_id: Annotated[int | None, Form()] = None,
    db: Session = Depends(get_db),
) -> ApiResponse[list[InvoiceUploadResult]]:
    uploaded = upload_invoices(db, report_id, expense_category, file, trip_id)
    results = [
        InvoiceUploadResult.model_validate(invoice).model_copy(update={"parsed": parsed})
        for invoice, parsed in uploaded
    ]
    message = "发票已上传" if len(results) <= 1 else f"已从文件中识别并上传 {len(results)} 张发票"
    return ApiResponse(data=results, message=message)


@router.get("/{invoice_id}/file")
def get_invoice_file(
    invoice_id: Annotated[int, Path(ge=1)],
    db: Session = Depends(get_db),
) -> FileResponse:
    invoice = get_invoice_or_404(db, invoice_id)
    file_path = uploaded_path(invoice.file_path)
    return FileResponse(file_path)


@router.get("/{invoice_id}/parse", response_model=ApiResponse[InvoiceParsedData])
def get_invoice_parse_result(
    invoice_id: Annotated[int, Path(ge=1)],
    db: Session = Depends(get_db),
) -> ApiResponse[InvoiceParsedData]:
    return ApiResponse(data=parse_existing_invoice(db, invoice_id), message="发票解析完成")


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
