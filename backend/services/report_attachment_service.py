from datetime import datetime
from pathlib import Path
import shutil
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from PIL import Image
from pypdf import PdfReader
from sqlalchemy.orm import Session

from backend.models.report_attachment import ReportAttachment
from backend.runtime_paths import UPLOAD_ROOT, uploaded_path
from backend.services.invoice_service import IMAGE_EXTENSIONS
from backend.services.report_service import ensure_report_writable, get_regular_item_target, get_report_or_404


def detect_attachment_file_type(filename: str) -> str:
    extension = Path(filename).suffix.lower()
    if extension == ".pdf":
        return "pdf"
    if extension in IMAGE_EXTENSIONS:
        return "image"
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的附件类型，请上传 PDF 或图片")


def _safe_original_filename(filename: str | None) -> str:
    normalized = (filename or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    return normalized or "未命名附件"


def report_attachment_path(relative_path: str | Path, *, require_exists: bool = False) -> Path:
    upload_root = UPLOAD_ROOT.resolve()
    path = uploaded_path(relative_path, UPLOAD_ROOT).resolve()
    if path != upload_root and not path.is_relative_to(upload_root):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="非发票附件路径不安全")
    if require_exists and not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="非发票附件原始文件不存在")
    return path


def build_report_attachment_storage_path(report_id: int, attachment_uid: str, extension: str) -> Path:
    safe_extension = extension.lower() if extension.startswith(".") else f".{extension.lower()}"
    return Path("uploads") / str(report_id) / f"report_attachment_{attachment_uid}{safe_extension}"


def _validate_saved_file(path: Path, file_type: str) -> int:
    try:
        if file_type == "pdf":
            reader = PdfReader(str(path))
            if not reader.pages:
                raise ValueError("PDF 没有页面")
            return len(reader.pages)
        else:
            with Image.open(path) as image:
                image.verify()
            return 1
    except Exception as exc:
        # pypdf/Pillow 的损坏文件异常类型跨版本有差异，统一转成稳定的业务错误。
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="附件文件损坏或无法读取") from exc


def upload_report_attachment(
    db: Session,
    report_id: int,
    upload_file: UploadFile,
    regular_item_id: int | None = None,
) -> ReportAttachment:
    report = get_report_or_404(db, report_id)
    ensure_report_writable(report)
    regular_item = None
    if report.report_type == "regular":
        if report.regular_mode != "no_invoice":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="有票常规报销单不能上传报销凭据")
        if regular_item_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="常规报销凭据必须关联报销项目")
        regular_item = get_regular_item_target(report, regular_item_id)
    elif regular_item_id is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="出差报销附件不能关联常规报销项目")
    original_filename = _safe_original_filename(upload_file.filename)
    file_type = detect_attachment_file_type(original_filename)
    attachment_uid = uuid4().hex
    extension = Path(original_filename).suffix.lower()
    relative_path = build_report_attachment_storage_path(report_id, attachment_uid, extension)
    absolute_path = report_attachment_path(relative_path)
    absolute_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        upload_file.file.seek(0)
        with absolute_path.open("wb") as target:
            shutil.copyfileobj(upload_file.file, target)
        page_count = _validate_saved_file(absolute_path, file_type)
        attachment = ReportAttachment(
            attachment_uid=attachment_uid,
            report_id=report_id,
            regular_item=regular_item,
            original_filename=original_filename,
            file_path=relative_path.as_posix(),
            file_type=file_type,
            page_count=page_count,
        )
        db.add(attachment)
        db.commit()
        db.refresh(attachment)
        return attachment
    except Exception:
        db.rollback()
        absolute_path.unlink(missing_ok=True)
        raise


def get_report_attachment_or_404(db: Session, attachment_id: int) -> ReportAttachment:
    attachment = db.get(ReportAttachment, attachment_id)
    if attachment is None or attachment.deleted_at is not None or attachment.report.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="非发票附件不存在")
    return attachment


def soft_delete_report_attachment(db: Session, attachment_id: int) -> None:
    attachment = get_report_attachment_or_404(db, attachment_id)
    ensure_report_writable(attachment.report)
    try:
        attachment.deleted_at = datetime.utcnow()
        db.commit()
    except Exception:
        db.rollback()
        raise
