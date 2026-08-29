from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Path, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.database.session import get_db
from backend.schemas.common import ApiResponse
from backend.schemas.invoice import (
    InvoiceLocalOpenRead,
    InvoiceOpenCapabilityRead,
    InvoiceParsedData,
    InvoiceRead,
    InvoiceUpdate,
    InvoiceUploadResult,
)
from backend.services.invoice_service import (
    UPLOAD_WARNINGS_RAW_KEY,
    get_invoice_or_404,
    local_pdf_open_supported,
    open_invoice_pdf_locally,
    parse_existing_invoice,
    soft_delete_invoice,
    update_invoice,
    upload_invoices,
)
from backend.runtime_paths import uploaded_path

router = APIRouter(prefix="/api/invoices", tags=["invoices"])


@router.post("/upload", response_model=ApiResponse[list[InvoiceUploadResult]])
def post_invoice_upload(
    report_id: Annotated[int, Form(ge=1)],
    file: Annotated[UploadFile, File()],
    expense_category: Annotated[str | None, Form()] = None,
    trip_id: Annotated[int | None, Form()] = None,
    regular_item_id: Annotated[int | None, Form(ge=1)] = None,
    db: Session = Depends(get_db),
) -> ApiResponse[list[InvoiceUploadResult]]:
    uploaded = upload_invoices(
        db,
        report_id,
        expense_category,
        file,
        trip_id=trip_id,
        regular_item_id=regular_item_id,
    )
    results = []
    for invoice, parsed in uploaded:
        raw_warnings = parsed.raw.get(UPLOAD_WARNINGS_RAW_KEY, []) if parsed.raw else []
        warnings = [str(warning).strip() for warning in raw_warnings if str(warning).strip()]
        results.append(
            InvoiceUploadResult.model_validate(invoice).model_copy(
                update={"parsed": parsed, "warnings": warnings}
            )
        )
    message = "发票已上传" if len(results) <= 1 else f"已从文件中识别并上传 {len(results)} 张发票"
    return ApiResponse(data=results, message=message)


def _request_allows_local_pdf_open(request: Request) -> bool:
    client_host = request.client.host if request.client else None
    return local_pdf_open_supported(client_host, request.url.hostname)


@router.get("/open-capability", response_model=ApiResponse[InvoiceOpenCapabilityRead])
def get_invoice_open_capability(request: Request) -> ApiResponse[InvoiceOpenCapabilityRead]:
    return ApiResponse(data=InvoiceOpenCapabilityRead(local_pdf_open_supported=_request_allows_local_pdf_open(request)))


@router.post("/{invoice_id}/open-local", response_model=ApiResponse[InvoiceLocalOpenRead])
def post_invoice_open_local(
    invoice_id: Annotated[int, Path(ge=1)],
    request: Request,
    db: Session = Depends(get_db),
) -> ApiResponse[InvoiceLocalOpenRead]:
    if not _request_allows_local_pdf_open(request):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="本地 PDF 打开仅可用于 Windows 本机访问")
    open_invoice_pdf_locally(db, invoice_id)
    return ApiResponse(data=InvoiceLocalOpenRead(opened=True), message="已调用系统默认 PDF 程序")


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
