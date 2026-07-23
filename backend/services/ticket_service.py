from __future__ import annotations

import json
import re
import shutil
from datetime import date, datetime, timedelta
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
from typing import Iterable
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from backend.models.invoice import Invoice
from backend.models.trip import Trip
from backend.runtime_paths import UPLOAD_ROOT, uploaded_path
from backend.schemas.ticket import (
    RailTicketCandidate,
    RailTicketGroup,
    RailTicketImportRequest,
    RailTicketImportResult,
    RailTicketPreview,
)
from backend.services.invoice_parser import extract_pdf_page_artifacts, parse_invoice_artifacts
from backend.services.invoice_service import build_invoice_storage_path, calculate_file_hash
from backend.services.pdf_text_decoder import PdfTextExtraction, PdfTextRun, extract_pdf_text_runs
from backend.services.report_service import ensure_report_writable, get_report_or_404, recalculate_report_totals
from backend.services.settings_service import get_or_create_settings

TEMP_ROOT = UPLOAD_ROOT / ".ticket-import"
TOKEN_TTL = timedelta(hours=2)


def normalize_station(value: str | None) -> str:
    normalized = re.sub(r"\s+", "", value or "").strip().lower()
    for suffix in ("station", "站"):
        if normalized.endswith(suffix):
            normalized = normalized[: -len(suffix)]
    return normalized


def transfer_kind(left, right) -> tuple[bool, bool]:
    left_date = left.travel_date
    right_date = right.travel_date
    if left_date is None or right_date is None:
        return False, False
    day_delta = (right_date - left_date).days
    cross_day = day_delta == 1
    if day_delta not in {0, 1}:
        return False, cross_day
    if not left.arrive_station or not right.depart_station:
        return False, cross_day
    if normalize_station(left.arrive_station) != normalize_station(right.depart_station):
        return False, cross_day
    return True, cross_day


def sort_ticket_candidates(tickets: list[RailTicketCandidate]) -> list[RailTicketCandidate]:
    """Order tickets by date and unambiguous station-to-station paths.

    The transfer graph may contain branches or cycles when several tickets share
    a station or describe a return trip.  Such components deliberately retain
    their upload order; only a component that is one unique directed path is
    reordered along that path.
    """
    if len(tickets) < 2:
        return list(tickets)

    outgoing: list[set[int]] = [set() for _ticket in tickets]
    incoming: list[set[int]] = [set() for _ticket in tickets]
    neighbors: list[set[int]] = [set() for _ticket in tickets]
    for left_index, left in enumerate(tickets):
        for right_index, right in enumerate(tickets):
            if left_index == right_index or left.duplicate or right.duplicate:
                continue
            connects, _cross_day = transfer_kind(left, right)
            if not connects:
                continue
            outgoing[left_index].add(right_index)
            incoming[right_index].add(left_index)
            neighbors[left_index].add(right_index)
            neighbors[right_index].add(left_index)

    components: list[tuple[date, int, list[int]]] = []
    unseen = set(range(len(tickets)))
    while unseen:
        first_index = min(unseen)
        pending = [first_index]
        component: set[int] = set()
        while pending:
            ticket_index = pending.pop()
            if ticket_index in component:
                continue
            component.add(ticket_index)
            unseen.discard(ticket_index)
            pending.extend(neighbors[ticket_index] - component)

        original_order = sorted(component)
        ordered_component = original_order
        starts = [index for index in component if not (incoming[index] & component)]
        ends = [index for index in component if not (outgoing[index] & component)]
        has_simple_degrees = all(
            len(incoming[index] & component) <= 1 and len(outgoing[index] & component) <= 1
            for index in component
        )
        if len(starts) == 1 and len(ends) == 1 and has_simple_degrees:
            path: list[int] = []
            visited: set[int] = set()
            current_index = starts[0]
            while current_index not in visited:
                path.append(current_index)
                visited.add(current_index)
                successors = outgoing[current_index] & component
                if not successors:
                    break
                current_index = next(iter(successors))
            if len(path) == len(component) and path[-1] == ends[0]:
                ordered_component = path

        travel_dates = [tickets[index].travel_date for index in component if tickets[index].travel_date]
        earliest_date = min(travel_dates, default=date.max)
        components.append((earliest_date, original_order[0], ordered_component))

    components.sort(key=lambda item: (item[0], item[1]))
    return [tickets[index] for _earliest_date, _first_index, component in components for index in component]


def group_ticket_candidates(tickets: list[RailTicketCandidate]) -> list[RailTicketGroup]:
    tickets = sort_ticket_candidates(tickets)
    groups: list[tuple[list[RailTicketCandidate], bool]] = []
    current: list[RailTicketCandidate] = []
    current_visited: set[str] = set()

    def start_group(ticket: RailTicketCandidate) -> None:
        nonlocal current, current_visited
        current = [ticket]
        current_visited = {
            station
            for station in (normalize_station(ticket.depart_station), normalize_station(ticket.arrive_station))
            if station
        }

    def finish_group(*, route_loop: bool = False) -> None:
        nonlocal current, current_visited
        if current:
            groups.append((current, route_loop))
        current = []
        current_visited = set()

    for ticket in tickets:
        if not current:
            start_group(ticket)
            continue
        connects, _cross_day = transfer_kind(current[-1], ticket)
        complete = bool(ticket.travel_date and ticket.depart_station and ticket.arrive_station)
        current_complete = all(item.travel_date and item.depart_station and item.arrive_station for item in current)
        returns_to_visited = connects and normalize_station(ticket.arrive_station) in current_visited
        if returns_to_visited:
            finish_group()
            start_group(ticket)
            finish_group(route_loop=True)
        elif (
            connects
            and current_complete
            and complete
            and not any(item.duplicate for item in current)
            and not ticket.duplicate
            and not returns_to_visited
        ):
            current.append(ticket)
            current_visited.add(normalize_station(ticket.arrive_station))
        else:
            finish_group()
            start_group(ticket)
    finish_group()

    result: list[RailTicketGroup] = []
    for index, (items, route_loop) in enumerate(groups, start=1):
        cross_day = any(transfer_kind(left, right)[1] for left, right in zip(items, items[1:]))
        round_trip = len(items) > 1 and normalize_station(items[0].depart_station) == normalize_station(
            items[-1].arrive_station
        )
        complete = all(item.travel_date and item.depart_station and item.arrive_station for item in items)
        suggested = (
            len(items) > 1
            and complete
            and not round_trip
            and not route_loop
            and not any(item.duplicate for item in items)
        )
        path = [items[0].depart_station or ""] + [item.arrive_station or "" for item in items]
        warning = None
        if route_loop or round_trip:
            warning = "检测到返程或路线回环，已在返程车票前拆分"
        elif cross_day:
            warning = "站点连续且日期为次日，已默认合并为跨日中转行程"
        elif suggested:
            warning = "站点连续且日期相同，已默认合并为中转行程"
        result.append(
            RailTicketGroup(
                id=f"group-{index}",
                ticket_ids=[item.id for item in items],
                suggested_merge=suggested,
                cross_day=cross_day,
                round_trip=round_trip,
                route_loop=route_loop,
                path=path,
                total_amount=sum((item.amount for item in items), Decimal("0.00")),
                warning=warning,
            )
        )
    return result


def _word_text(words: list[dict], *, y_min: float, y_max: float, x_min: float, x_max: float) -> list[str]:
    return [
        str(word.get("text") or "").strip()
        for word in words
        if y_min <= float(word.get("y0") or 0) <= y_max and x_min <= float(word.get("x0") or 0) <= x_max
    ]


def _parse_date_text(value: str) -> date | None:
    match = re.search(r"(20\d{2})\D*(\d{1,2})\D*(\d{1,2})", value)
    if not match:
        return None
    try:
        return date(*(int(item) for item in match.groups()))
    except ValueError:
        return None


_STATION_PATTERN = re.compile(r"[\u3400-\u9fff]{1,10}?站")
_STATION_NAME_PATTERN = re.compile(r"[\u3400-\u9fff]{1,10}")
_NON_ROUTE_STATIONS = {"出发站", "到达站", "始发站", "终点站", "车站", "火车站"}


def _clean_station_label(value: str) -> str:
    normalized = re.sub(r"\s+", "", value).strip()
    return normalized[:-1] if normalized.endswith("站") else normalized


def _split_station_label(
    name_run: PdfTextRun,
    suffix_run: PdfTextRun,
    *,
    page_width: float,
    page_height: float,
) -> str | None:
    name = re.sub(r"\s+", "", name_run.text).strip()
    suffix = re.sub(r"\s+", "", suffix_run.text).strip()
    if suffix != "站" or name.endswith("站") or _STATION_NAME_PATTERN.fullmatch(name) is None:
        return None
    if suffix_run.order != name_run.order + 1 or suffix_run.x <= name_run.x:
        return None

    baseline_tolerance = max(1.0, page_height * 0.003) if page_height else 2.0
    if abs(suffix_run.y - name_run.y) > baseline_tolerance:
        return None

    # Railway tickets commonly render the smaller “站” suffix with another font.
    # Use the observed start-to-suffix distance instead of the unscaled PDF font
    # size because Form XObjects can scale coordinates without scaling Tf itself.
    character_advance = (suffix_run.x - name_run.x) / len(name)
    min_character_advance = page_width * 0.012 if page_width else 6.0
    max_character_advance = page_width * 0.06 if page_width else 36.0
    if not min_character_advance <= character_advance <= max_character_advance:
        return None

    raw_station = f"{name}站"
    if raw_station in _NON_ROUTE_STATIONS:
        return None
    return _clean_station_label(raw_station)


def _station_candidates(extraction: PdfTextExtraction) -> list[tuple[str, PdfTextRun, float]]:
    candidates: list[tuple[str, PdfTextRun, float]] = []
    for run in extraction.runs:
        for match in _STATION_PATTERN.finditer(run.text):
            raw_station = match.group(0)
            if raw_station in _NON_ROUTE_STATIONS:
                continue
            station = _clean_station_label(raw_station)
            if not station:
                continue
            estimated_x = run.x + match.start() * run.font_size * 0.8
            candidates.append((station, run, estimated_x))

    runs_by_order = sorted(extraction.runs, key=lambda item: item.order)
    for name_run, suffix_run in zip(runs_by_order, runs_by_order[1:]):
        station = _split_station_label(
            name_run,
            suffix_run,
            page_width=extraction.page_width,
            page_height=extraction.page_height,
        )
        if station:
            candidates.append((station, name_run, name_run.x))
    return candidates


def _decoded_route(extraction: PdfTextExtraction) -> tuple[str | None, str | None, PdfTextRun | None]:
    stations = _station_candidates(extraction)
    train_run = next(
        (run for run in extraction.runs if re.search(r"\b[GDCZTKS]\d{1,5}\b", run.text, re.IGNORECASE)),
        None,
    )
    if len(stations) < 2:
        return None, None, train_run

    if train_run is not None:
        tolerance = max(14.0, train_run.font_size * 1.8)
        same_line = [item for item in stations if abs(item[1].y - train_run.y) <= tolerance]
        left = [item for item in same_line if item[2] < train_run.x]
        right = [item for item in same_line if item[2] > train_run.x]
        if left and right:
            return max(left, key=lambda item: item[2])[0], min(right, key=lambda item: item[2])[0], train_run
        if len(same_line) >= 2:
            ordered = sorted(same_line, key=lambda item: (item[2], item[1].order))
            return ordered[0][0], ordered[-1][0], train_run

    best_pair: tuple[tuple[str, PdfTextRun, float], tuple[str, PdfTextRun, float]] | None = None
    best_score = float("-inf")
    for left in stations:
        for right in stations:
            if right[2] <= left[2] or normalize_station(left[0]) == normalize_station(right[0]):
                continue
            tolerance = max(14.0, left[1].font_size * 1.8, right[1].font_size * 1.8)
            if abs(left[1].y - right[1].y) > tolerance:
                continue
            separation = right[2] - left[2]
            if extraction.page_width and separation < extraction.page_width * 0.15:
                continue
            upper_page_bonus = 20.0 if extraction.page_height and left[1].y >= extraction.page_height * 0.5 else 0.0
            score = left[1].font_size + right[1].font_size + separation / 10.0 + upper_page_bonus
            if score > best_score:
                best_pair = (left, right)
                best_score = score
    if best_pair is None:
        return None, None, train_run
    return best_pair[0][0], best_pair[1][0], train_run


def _decoded_travel_date(extraction: PdfTextExtraction, train_run: PdfTextRun | None) -> date | None:
    candidates = [(parsed, run) for run in extraction.runs if (parsed := _parse_date_text(run.text)) is not None]
    if not candidates:
        return _parse_date_text(extraction.text)
    if train_run is not None:
        after_train = [item for item in candidates if item[1].order > train_run.order]
        if after_train:
            return min(after_train, key=lambda item: item[1].order - train_run.order)[0]
        return min(candidates, key=lambda item: abs(item[1].y - train_run.y))[0]
    return candidates[0][0]


def parse_rail_ticket(path: Path, ticket_id: str, file_name: str, invoice_qr_engine: str) -> RailTicketCandidate:
    artifacts = extract_pdf_page_artifacts(path)
    words = list(artifacts.get("words") or [])
    full_text = artifacts.get("text") or ""
    invoice = parse_invoice_artifacts(artifacts, "pdf", invoice_qr_engine=invoice_qr_engine)
    try:
        decoded = extract_pdf_text_runs(path)
    except Exception as exc:
        decoded = PdfTextExtraction(warnings=[f"PDF 中文文字层无法读取：{exc}"])
    depart_station, arrive_station, decoded_train_run = _decoded_route(decoded)

    top_left = " ".join(_word_text(words, y_min=35, y_max=70, x_min=0, x_max=260))
    top_right = " ".join(_word_text(words, y_min=35, y_max=70, x_min=400, x_max=595))
    travel_line = " ".join(_word_text(words, y_min=122, y_max=155, x_min=0, x_max=300))
    amount_line = "".join(_word_text(words, y_min=150, y_max=195, x_min=0, x_max=180))
    train_line = " ".join(_word_text(words, y_min=70, y_max=115, x_min=220, x_max=350))
    seat_line = " ".join(_word_text(words, y_min=122, y_max=155, x_min=180, x_max=340))

    travel_date = _decoded_travel_date(decoded, decoded_train_run) or _parse_date_text(travel_line)
    train_match = re.search(
        r"\b([GDCZTKS]\d{1,5})\b",
        " ".join((decoded.text, train_line, full_text)),
        re.IGNORECASE,
    )
    seat_match = re.search(r"(\d{2})\D*(\d{2,3}[A-F])", seat_line, re.IGNORECASE)
    amount_match = re.search(r"(\d{1,6})\s*[.]\s*(\d{2})", amount_line)
    amount = Decimal(f"{amount_match.group(1)}.{amount_match.group(2)}") if amount_match else invoice.amount
    invoice_no_match = re.search(r"\b(\d{18,24})\b", top_left)
    invoice_no = invoice.invoice_no or (invoice_no_match.group(1) if invoice_no_match else None)
    invoice_date = invoice.invoice_date or _parse_date_text(top_right)

    warnings: list[str] = []
    required = {
        "乘车日期": travel_date,
        "出发站": depart_station,
        "到达站": arrive_station,
    }
    for label, value in required.items():
        if not value:
            warnings.append(f"未识别{label}，请手动补充")
    if any(not value for value in (travel_date, depart_station, arrive_station)):
        for warning in decoded.warnings:
            if warning not in warnings:
                warnings.append(warning)
    if amount <= Decimal("0.00"):
        warnings.append("未可靠识别票价，请手动确认")

    return RailTicketCandidate(
        id=ticket_id,
        file_name=file_name,
        travel_date=travel_date,
        depart_station=depart_station,
        arrive_station=arrive_station,
        train_no=train_match.group(1).upper() if train_match else None,
        seat_no=f"{seat_match.group(1)}车{seat_match.group(2).upper()}号" if seat_match else None,
        amount=amount,
        invoice_no=invoice_no,
        invoice_date=invoice_date,
        preview_image=invoice.preview_image,
        parse_warnings=warnings,
    )


def _file_hash(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _existing_duplicates(report) -> tuple[set[str], set[str]]:
    hashes: set[str] = set()
    invoice_nos: set[str] = set()
    for invoice in report.invoices:
        if invoice.deleted_at is not None:
            continue
        if invoice.invoice_no and invoice.invoice_no.strip():
            invoice_nos.add(invoice.invoice_no.strip())
        file_hash = calculate_file_hash(uploaded_path(invoice.file_path))
        if file_hash:
            hashes.add(file_hash)
    return hashes, invoice_nos


def _cleanup_expired_tokens() -> None:
    if not TEMP_ROOT.exists():
        return
    cutoff = datetime.utcnow() - TOKEN_TTL
    for child in TEMP_ROOT.iterdir():
        try:
            if child.is_dir() and datetime.utcfromtimestamp(child.stat().st_mtime) < cutoff:
                shutil.rmtree(child, ignore_errors=True)
        except OSError:
            continue


def create_ticket_preview(db: Session, report_id: int, files: Iterable[UploadFile]) -> RailTicketPreview:
    report = get_report_or_404(db, report_id)
    ensure_report_writable(report)
    uploads = list(files)
    if not uploads:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请至少上传一张铁路电子客票 PDF")
    if len(uploads) > 30:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="一次最多导入 30 张车票")

    _cleanup_expired_tokens()
    token = uuid4().hex
    token_dir = TEMP_ROOT / token
    token_dir.mkdir(parents=True, exist_ok=False)
    try:
        settings = get_or_create_settings(db)
        existing_hashes, existing_invoice_nos = _existing_duplicates(report)
        seen_hashes: set[str] = set()
        seen_invoice_nos: set[str] = set()
        tickets: list[RailTicketCandidate] = []
        metadata_files: list[dict] = []
        skipped: list[str] = []
        for upload in uploads:
            filename = Path(upload.filename or "ticket.pdf").name
            if Path(filename).suffix.lower() != ".pdf":
                skipped.append(f"{filename}：不是 PDF 文件，已跳过")
                continue
            ticket_id = uuid4().hex
            stored_name = f"{ticket_id}.pdf"
            temp_path = token_dir / stored_name
            upload.file.seek(0)
            with temp_path.open("wb") as target:
                shutil.copyfileobj(upload.file, target)
            try:
                ticket = parse_rail_ticket(temp_path, ticket_id, filename, settings.invoice_qr_engine)
            except Exception as exc:
                # 单个损坏或非铁路客票 PDF 不应中止整批；仅丢弃该文件并作为警告提示。
                temp_path.unlink(missing_ok=True)
                skipped.append(f"{filename}：无法作为铁路电子客票解析，已跳过（{exc}）")
                continue
            file_hash = _file_hash(temp_path)
            reasons: list[str] = []
            if file_hash in existing_hashes:
                reasons.append("相同文件已在当前报销单中")
            if file_hash in seen_hashes:
                reasons.append("本次上传包含相同文件")
            normalized_no = (ticket.invoice_no or "").strip()
            if normalized_no and normalized_no in existing_invoice_nos:
                reasons.append(f"发票号 {normalized_no} 已在当前报销单中")
            if normalized_no and normalized_no in seen_invoice_nos:
                reasons.append(f"本次上传包含重复发票号 {normalized_no}")
            seen_hashes.add(file_hash)
            if normalized_no:
                seen_invoice_nos.add(normalized_no)
            if reasons:
                ticket.duplicate = True
                ticket.duplicate_reason = "；".join(reasons)
            tickets.append(ticket)
            metadata_files.append(
                {"id": ticket_id, "file_name": filename, "stored_name": stored_name, "file_hash": file_hash}
            )

        if not tickets:
            detail = "没有可解析的铁路电子客票 PDF"
            if skipped:
                detail = f"{detail}：{'；'.join(skipped)}"
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

        expires_at = datetime.utcnow() + TOKEN_TTL
        metadata = {"report_id": report_id, "expires_at": expires_at.isoformat(), "files": metadata_files}
        (token_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
        ordered_tickets = sort_ticket_candidates(tickets)
        warnings = [
            "已按乘车日期和唯一连续路线自动排序；站点连续且日期为同日或次日时默认合并，"
            "分叉、返程或路线回环不会猜测重排"
        ]
        if any(ticket.duplicate for ticket in tickets):
            warnings.append("检测到重复车票；重复项不能导入")
        warnings.extend(skipped)
        return RailTicketPreview(
            token=token,
            expires_at=expires_at,
            tickets=ordered_tickets,
            warnings=warnings,
        )
    except Exception:
        shutil.rmtree(token_dir, ignore_errors=True)
        raise


def _load_token(token: str, report_id: int) -> tuple[Path, dict]:
    if not re.fullmatch(r"[0-9a-f]{32}", token):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效的车票导入令牌")
    token_dir = TEMP_ROOT / token
    metadata_path = token_dir / "metadata.json"
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        expires_at = datetime.fromisoformat(metadata["expires_at"])
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="车票导入预览已失效，请重新上传") from exc
    if metadata.get("report_id") != report_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="车票导入令牌不属于当前报销单")
    if datetime.utcnow() >= expires_at:
        shutil.rmtree(token_dir, ignore_errors=True)
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="车票导入预览已过期，请重新上传")
    return token_dir, metadata


def discard_ticket_preview(token: str, report_id: int) -> None:
    token_dir, _metadata = _load_token(token, report_id)
    shutil.rmtree(token_dir, ignore_errors=True)


def _validate_import_groups(payload: RailTicketImportRequest) -> dict[str, object]:
    tickets = {item.id: item for item in payload.tickets}
    if len(tickets) != len(payload.tickets):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="车票候选 ID 重复")
    grouped_ids = [ticket_id for group in payload.groups for ticket_id in group.ticket_ids]
    if len(grouped_ids) != len(set(grouped_ids)) or set(grouped_ids) != set(tickets):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="每张车票必须且只能属于一个导入组")
    for group in payload.groups:
        items = [tickets[ticket_id] for ticket_id in group.ticket_ids]
        if not group.merge:
            continue
        if len(items) < 2:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="中转合并至少需要两张车票")
        for left, right in zip(items, items[1:]):
            connects, _cross_day = transfer_kind(left, right)
            if not connects:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="所选车票不满足连续站点或同日/次日中转规则")
        visited = {normalize_station(items[0].depart_station), normalize_station(items[0].arrive_station)}
        for item in items[1:]:
            arrival = normalize_station(item.arrive_station)
            if arrival in visited:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="返程或路线回环车票不能合并为中转行程")
            visited.add(arrival)
    return tickets


def import_ticket_preview(db: Session, report_id: int, payload: RailTicketImportRequest) -> RailTicketImportResult:
    report = get_report_or_404(db, report_id)
    ensure_report_writable(report)
    token_dir, metadata = _load_token(payload.token, report_id)
    ticket_by_id = _validate_import_groups(payload)
    metadata_by_id = {item["id"]: item for item in metadata["files"]}
    # 允许提交预览车票的子集：用户可在预览中删除个别车票（例如重复项）后再导入其余车票。
    if not set(ticket_by_id).issubset(metadata_by_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="提交的车票与预览令牌不一致")

    existing_hashes, existing_invoice_nos = _existing_duplicates(report)
    submitted_hashes: set[str] = set()
    submitted_invoice_nos: set[str] = set()
    for ticket_id, ticket in ticket_by_id.items():
        item = metadata_by_id[ticket_id]
        temp_path = token_dir / item["stored_name"]
        if not temp_path.is_file() or _file_hash(temp_path) != item["file_hash"]:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="临时车票文件缺失或已变化，请重新上传")
        if item["file_hash"] in existing_hashes or item["file_hash"] in submitted_hashes:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{item['file_name']} 已在当前报销单中上传")
        submitted_hashes.add(item["file_hash"])
        invoice_no = (ticket.invoice_no or "").strip()
        if invoice_no and (invoice_no in existing_invoice_nos or invoice_no in submitted_invoice_nos):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"发票号 {invoice_no} 重复")
        if invoice_no:
            submitted_invoice_nos.add(invoice_no)

    next_sort_order = max((trip.sort_order for trip in report.trips), default=0) + 1
    created_trips: list[Trip] = []
    created_invoices: list[Invoice] = []
    created_paths: list[Path] = []
    try:
        for group in payload.groups:
            items = [ticket_by_id[ticket_id] for ticket_id in group.ticket_ids]
            trip_ticket_sets = [items] if group.merge else [[item] for item in items]
            for trip_tickets in trip_ticket_sets:
                first, last = trip_tickets[0], trip_tickets[-1]
                trip = Trip(
                    report=report,
                    sort_order=next_sort_order,
                    depart_month=first.travel_date.month,
                    depart_day=first.travel_date.day,
                    depart_hour=None,
                    depart_place=first.depart_station.strip(),
                    arrive_month=last.travel_date.month,
                    arrive_day=last.travel_date.day,
                    arrive_hour=None,
                    arrive_place=last.arrive_station.strip(),
                    transport="高铁",
                )
                db.add(trip)
                db.flush()
                created_trips.append(trip)
                next_sort_order += 1

                for ticket in trip_tickets:
                    metadata_item = metadata_by_id[ticket.id]
                    temp_path = token_dir / metadata_item["stored_name"]
                    invoice = Invoice(
                        report=report,
                        trip=trip,
                        expense_category="transport_fare",
                        file_path="pending",
                        file_type="pdf",
                        invoice_type="normal",
                        invoice_no=(ticket.invoice_no or "").strip() or None,
                        invoice_date=ticket.invoice_date,
                        amount=ticket.amount,
                        amount_confirmed=False,
                    )
                    db.add(invoice)
                    db.flush()
                    final_relative = build_invoice_storage_path(
                        report_id=report_id,
                        invoice_id=invoice.id,
                        expense_category="transport_fare",
                        file_hash=metadata_item["file_hash"],
                        ext=".pdf",
                    )
                    final_path = uploaded_path(final_relative)
                    final_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(temp_path, final_path)
                    created_paths.append(final_path)
                    invoice.file_path = final_relative.as_posix()
                    created_invoices.append(invoice)

        recalculate_report_totals(report)
        db.commit()
        result = RailTicketImportResult(
            trip_ids=[trip.id for trip in created_trips],
            invoice_ids=[invoice.id for invoice in created_invoices],
        )
        shutil.rmtree(token_dir, ignore_errors=True)
        return result
    except Exception:
        db.rollback()
        for path in created_paths:
            path.unlink(missing_ok=True)
        shutil.rmtree(token_dir, ignore_errors=True)
        raise
