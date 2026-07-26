import pytest
from fastapi import HTTPException

from backend.schemas.report import ReportCreate, ReportStatusUpdate
from backend.services import report_service
from backend.services.report_service import (
    create_report,
    update_report_status,
    validate_status_transition,
)

LEGAL_TRANSITIONS = [
    ("draft", "checked"),
    ("checked", "draft"),
    ("checked", "printed"),
    ("printed", "checked"),
    ("printed", "reimbursed"),
]

ILLEGAL_TRANSITIONS = [
    ("draft", "printed"),
    ("draft", "reimbursed"),
    ("checked", "reimbursed"),
    ("printed", "draft"),
    ("reimbursed", "draft"),
    ("reimbursed", "checked"),
    ("reimbursed", "printed"),
]


@pytest.mark.parametrize("current,target", LEGAL_TRANSITIONS)
def test_validate_status_transition_legal(current, target):
    # 合法转换不抛异常
    validate_status_transition(current, target)


@pytest.mark.parametrize("current,target", ILLEGAL_TRANSITIONS)
def test_validate_status_transition_illegal(current, target):
    with pytest.raises(HTTPException) as exc:
        validate_status_transition(current, target)
    assert exc.value.status_code == 400


def test_validate_status_transition_same_status_noop():
    # 相同状态视为 no-op，不抛异常
    validate_status_transition("draft", "draft")
    validate_status_transition("checked", "checked")
    validate_status_transition("reimbursed", "reimbursed")


def test_status_schema_accepts_checked():
    assert ReportStatusUpdate(status="checked").status == "checked"


def test_update_report_status_full_legal_path(monkeypatch, db):
    snapshot_reasons = []
    monkeypatch.setattr(
        report_service,
        "create_safety_snapshot",
        lambda _db, reason: snapshot_reasons.append(reason),
    )
    report = create_report(db, ReportCreate(purpose="出差A"))
    assert report.status == "draft"

    report = update_report_status(db, report.id, "checked")
    assert report.status == "checked"

    report = update_report_status(db, report.id, "draft")
    assert report.status == "draft"

    report = update_report_status(db, report.id, "checked")
    report = update_report_status(db, report.id, "printed")
    report = update_report_status(db, report.id, "checked")
    report = update_report_status(db, report.id, "printed")
    report = update_report_status(db, report.id, "reimbursed")
    assert report.status == "reimbursed"
    assert snapshot_reasons == ["pre_status_rollback", "pre_status_rollback"]


def test_status_rollback_aborts_when_snapshot_fails(monkeypatch, db):
    report = create_report(db, ReportCreate(purpose="出差快照失败"))
    update_report_status(db, report.id, "checked")
    update_report_status(db, report.id, "printed")

    def fail_snapshot(_db, reason):
        raise HTTPException(status_code=500, detail=f"{reason} failed")

    monkeypatch.setattr(report_service, "create_safety_snapshot", fail_snapshot)

    with pytest.raises(HTTPException) as exc:
        update_report_status(db, report.id, "checked")

    db.refresh(report)
    assert exc.value.status_code == 500
    assert report.status == "printed"


def test_update_report_status_illegal_raises(db):
    report = create_report(db, ReportCreate(purpose="出差B"))
    # 流程必须先核对，draft -> printed 非法
    with pytest.raises(HTTPException) as exc:
        update_report_status(db, report.id, "printed")
    assert exc.value.status_code == 400


def test_reimbursed_is_locked(db):
    report = create_report(db, ReportCreate(purpose="出差C"))
    update_report_status(db, report.id, "checked")
    update_report_status(db, report.id, "printed")
    update_report_status(db, report.id, "reimbursed")
    # reimbursed -> 任意状态非法
    with pytest.raises(HTTPException):
        update_report_status(db, report.id, "draft")
    with pytest.raises(HTTPException):
        update_report_status(db, report.id, "checked")
    with pytest.raises(HTTPException):
        update_report_status(db, report.id, "printed")
