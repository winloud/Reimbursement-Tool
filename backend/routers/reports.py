from typing import Annotated
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, Path, Query, Response
from sqlalchemy.orm import Session

from backend.database.session import get_db
from backend.schemas.common import ApiResponse, PaginationData
from backend.schemas.report import (
    PdfPreviewRead,
    ReportCreate,
    ReportDetailRead,
    ReportFilterOptionsRead,
    ReportInvoiceState,
    ReportRead,
    ReportStatus,
    ReportStatusUpdate,
    ReportUpdate,
)
from backend.services.pdf_generator import (
    build_merged_report_pdf,
    build_pdf_filename,
    content_disposition_for_filename,
    render_report_preview_pages,
)
from backend.services.settings_service import get_or_create_settings
from backend.services.report_service import (
    ReportFilters,
    create_report,
    get_report_or_404,
    list_report_category_options,
    list_reports,
    soft_delete_report,
    update_report,
    update_report_status,
)

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("", response_model=ApiResponse[PaginationData[ReportRead]])
def get_reports(
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    status: ReportStatus | None = None,
    trip_start: date | None = None,
    trip_end: date | None = None,
    keyword: Annotated[str | None, Query(max_length=100)] = None,
    amount_min: Annotated[Decimal | None, Query(ge=0)] = None,
    amount_max: Annotated[Decimal | None, Query(ge=0)] = None,
    invoice_state: ReportInvoiceState = "all",
    category: Annotated[str | None, Query(max_length=60)] = None,
    has_attachment: bool | None = None,
    subsidy_days_min: Annotated[int | None, Query(ge=0)] = None,
    subsidy_days_max: Annotated[int | None, Query(ge=0)] = None,
    db: Session = Depends(get_db),
) -> ApiResponse[PaginationData[ReportRead]]:
    filters = ReportFilters(
        report_status=status,
        trip_start=trip_start,
        trip_end=trip_end,
        keyword=keyword,
        amount_min=amount_min,
        amount_max=amount_max,
        invoice_state=invoice_state,
        category=category,
        has_attachment=has_attachment,
        subsidy_days_min=subsidy_days_min,
        subsidy_days_max=subsidy_days_max,
    )
    items, total = list_reports(db, page=page, page_size=page_size, filters=filters)
    return ApiResponse(data=PaginationData(items=items, total=total, page=page, page_size=page_size))


@router.get("/filter-options", response_model=ApiResponse[ReportFilterOptionsRead])
def get_report_filter_options(db: Session = Depends(get_db)) -> ApiResponse[ReportFilterOptionsRead]:
    return ApiResponse(data=ReportFilterOptionsRead(categories=list_report_category_options(db)))


@router.post("", response_model=ApiResponse[ReportRead])
def post_report(payload: ReportCreate, db: Session = Depends(get_db)) -> ApiResponse[ReportRead]:
    return ApiResponse(data=create_report(db, payload), message="报销单已创建")


@router.get("/{report_id}", response_model=ApiResponse[ReportDetailRead])
def get_report(
    report_id: Annotated[int, Path(ge=1)],
    db: Session = Depends(get_db),
) -> ApiResponse[ReportDetailRead]:
    return ApiResponse(data=get_report_or_404(db, report_id))


@router.get("/{report_id}/pdf/preview", response_model=ApiResponse[PdfPreviewRead])
def get_report_pdf_preview(
    report_id: Annotated[int, Path(ge=1)],
    db: Session = Depends(get_db),
) -> ApiResponse[PdfPreviewRead]:
    report = get_report_or_404(db, report_id)
    settings = get_or_create_settings(db)
    return ApiResponse(
        data=PdfPreviewRead(pages=render_report_preview_pages(report, settings.pdf_fill_font_key)),
        message="PDF 预览已生成",
    )


@router.get("/{report_id}/pdf")
def get_report_pdf(
    report_id: Annotated[int, Path(ge=1)],
    db: Session = Depends(get_db),
) -> Response:
    report = get_report_or_404(db, report_id)
    settings = get_or_create_settings(db)
    pdf_bytes = build_merged_report_pdf(report, settings.pdf_fill_font_key)
    filename = build_pdf_filename(report)
    if report.status == "draft":
        report.status = "printed"
        db.commit()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": content_disposition_for_filename(filename)},
    )


@router.put("/{report_id}", response_model=ApiResponse[ReportRead])
def put_report(
    report_id: Annotated[int, Path(ge=1)],
    payload: ReportUpdate,
    db: Session = Depends(get_db),
) -> ApiResponse[ReportRead]:
    return ApiResponse(data=update_report(db, report_id, payload), message="报销单已更新")


@router.delete("/{report_id}", response_model=ApiResponse[None])
def delete_report(
    report_id: Annotated[int, Path(ge=1)],
    db: Session = Depends(get_db),
) -> ApiResponse[None]:
    soft_delete_report(db, report_id)
    return ApiResponse(message="报销单已删除")


@router.patch("/{report_id}/status", response_model=ApiResponse[ReportRead])
def patch_report_status(
    report_id: Annotated[int, Path(ge=1)],
    payload: ReportStatusUpdate,
    db: Session = Depends(get_db),
) -> ApiResponse[ReportRead]:
    return ApiResponse(data=update_report_status(db, report_id, payload.status), message="报销单状态已更新")
