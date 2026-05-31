import pytest
from fastapi import HTTPException

from backend.schemas.report import ReportCreate, ReportStatusUpdate
from backend.services.report_service import (
    create_report,
    update_report_status,
    validate_status_transition,
)

LEGAL_TRANSITIONS = [
    ("draft", "printed"),
    ("printed", "reimbursed"),
    ("printed", "draft"),
]

ILLEGAL_TRANSITIONS = [
    ("draft", "reimbursed"),
    ("reimbursed", "draft"),
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
    validate_status_transition("reimbursed", "reimbursed")


def test_update_report_status_full_legal_path(db):
    report = create_report(db, ReportCreate(purpose="出差A"))
    assert report.status == "draft"

    report = update_report_status(db, report.id, "printed")
    assert report.status == "printed"

    report = update_report_status(db, report.id, "draft")
    assert report.status == "draft"

    report = update_report_status(db, report.id, "printed")
    report = update_report_status(db, report.id, "reimbursed")
    assert report.status == "reimbursed"


def test_update_report_status_illegal_raises(db):
    report = create_report(db, ReportCreate(purpose="出差B"))
    # draft -> reimbursed 非法
    with pytest.raises(HTTPException) as exc:
        update_report_status(db, report.id, "reimbursed")
    assert exc.value.status_code == 400


def test_reimbursed_is_locked(db):
    report = create_report(db, ReportCreate(purpose="出差C"))
    update_report_status(db, report.id, "printed")
    update_report_status(db, report.id, "reimbursed")
    # reimbursed -> 任意状态非法
    with pytest.raises(HTTPException):
        update_report_status(db, report.id, "draft")
    with pytest.raises(HTTPException):
        update_report_status(db, report.id, "printed")
