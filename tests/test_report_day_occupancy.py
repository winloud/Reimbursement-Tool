from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from threading import Barrier

import pytest
from pydantic import TypeAdapter
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from backend.database import connection
from backend.database.connection import Base
from backend.models.report import ExpenseReport
from backend.models.report_day_occupancy import ReportDayOccupancy
from backend.models.settings import Settings
from backend.models.trip import Trip
from backend.routers.reports import get_report_day_occupancies
from backend.schemas.common import ApiResponse
from backend.schemas.report import ReportCreate, ReportDayOccupancyRead, ReportDetailRead, ReportUpdate, TripWrite
from backend.services import maintenance_service
from backend.services.report_service import (
    create_report,
    initialize_report_day_occupancies,
    purge_report,
    recalculate_report_totals,
    replace_report_day_occupancies,
    restore_deleted_report,
    soft_delete_report,
    update_report,
    update_report_status,
)


def trip(start: date, end: date) -> TripWrite:
    return TripWrite(sort_order=1, depart_date=start, arrive_date=end)


def create_travel_report(
    db: Session,
    *,
    employee_name: str | None,
    start: date,
    end: date,
    daily_subsidy: str = "100.00",
    manual_subsidy_total: str | None = None,
) -> ExpenseReport:
    return create_report(
        db,
        ReportCreate(
            report_date=end,
            employee_name=employee_name,
            purpose="日期占用测试",
            daily_subsidy=Decimal(daily_subsidy),
            manual_subsidy_total=(Decimal(manual_subsidy_total) if manual_subsidy_total is not None else None),
            trips=[trip(start, end)],
        ),
    )


def occupancy_dates(db: Session, report_id: int) -> list[date]:
    return list(
        db.scalars(
            select(ReportDayOccupancy.occupied_on)
            .where(ReportDayOccupancy.report_id == report_id)
            .order_by(ReportDayOccupancy.occupied_on)
        ).all()
    )


def test_saved_drafts_claim_only_free_days_for_same_normalized_employee(db):
    first = create_travel_report(
        db,
        employee_name="  张三  ",
        start=date(2026, 7, 18),
        end=date(2026, 7, 19),
    )
    second = create_travel_report(
        db,
        employee_name="张三",
        start=date(2026, 7, 19),
        end=date(2026, 7, 20),
    )
    third = create_travel_report(
        db,
        employee_name="张三",
        start=date(2026, 7, 18),
        end=date(2026, 7, 20),
    )

    assert first.subsidy_days == 2
    assert first.subsidy_total == Decimal("200.00")
    assert first.occupied_dates == [date(2026, 7, 18), date(2026, 7, 19)]
    assert second.subsidy_days == 1
    assert second.subsidy_total == Decimal("100.00")
    assert second.occupied_dates == [date(2026, 7, 20)]
    assert third.subsidy_days == 0
    assert third.subsidy_total == Decimal("0.00")
    assert third.occupied_dates == []
    assert {row.employee_key for row in db.scalars(select(ReportDayOccupancy)).all()} == {"张三"}


def test_different_employees_and_empty_names_have_independent_occupancy_groups(db):
    day = date(2026, 8, 1)
    first = create_travel_report(db, employee_name="甲", start=day, end=day)
    second = create_travel_report(db, employee_name="乙", start=day, end=day)
    empty_first = create_travel_report(db, employee_name=None, start=day, end=day)
    empty_second = create_travel_report(db, employee_name="   ", start=day, end=day)

    assert (first.subsidy_days, second.subsidy_days) == (1, 1)
    assert (empty_first.subsidy_days, empty_second.subsidy_days) == (1, 0)


def test_two_sessions_cannot_claim_the_same_employee_day(db):
    first_session = Session(db.get_bind())
    second_session = Session(db.get_bind())
    try:
        first = create_travel_report(
            first_session,
            employee_name="并发测试",
            start=date(2026, 8, 8),
            end=date(2026, 8, 8),
        )
        second = create_travel_report(
            second_session,
            employee_name="并发测试",
            start=date(2026, 8, 8),
            end=date(2026, 8, 8),
        )

        assert (first.subsidy_days, second.subsidy_days) == (1, 0)
        assert second.occupied_dates == []
        rows = list(
            second_session.scalars(
                select(ReportDayOccupancy).where(
                    ReportDayOccupancy.employee_key == "并发测试",
                    ReportDayOccupancy.occupied_on == date(2026, 8, 8),
                )
            ).all()
        )
        assert len(rows) == 1
        assert rows[0].report_id == first.id
    finally:
        first_session.close()
        second_session.close()


def test_concurrent_sessions_return_amounts_from_the_dates_each_one_actually_claimed(tmp_path):
    database_path = tmp_path / "concurrent-occupancy.db"
    test_engine = create_engine(
        f"sqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    Base.metadata.create_all(bind=test_engine)
    occupied_on = date(2026, 8, 9)
    with Session(test_engine) as session:
        reports = []
        for purpose in ("并发甲", "并发乙"):
            report = ExpenseReport(
                report_type="travel",
                status="draft",
                report_date=occupied_on,
                employee_name="并发竞争",
                purpose=purpose,
                daily_subsidy=Decimal("100.00"),
            )
            report.trips.append(
                Trip(
                    sort_order=1,
                    depart_date=occupied_on,
                    depart_month=occupied_on.month,
                    depart_day=occupied_on.day,
                    arrive_date=occupied_on,
                    arrive_month=occupied_on.month,
                    arrive_day=occupied_on.day,
                )
            )
            session.add(report)
            reports.append(report)
        session.commit()
        report_ids = [report.id for report in reports]

    start_barrier = Barrier(2)

    def claim(report_id: int) -> tuple[int, int, Decimal]:
        with Session(test_engine) as session:
            report = session.get(ExpenseReport, report_id)
            list(report.trips)
            start_barrier.wait(timeout=10)
            replace_report_day_occupancies(session, report)
            recalculate_report_totals(report)
            session.commit()
            session.refresh(report)
            return report.id, report.subsidy_days, report.subsidy_total

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(claim, report_ids))

    assert sorted(days for _report_id, days, _total in results) == [0, 1]
    assert sorted(total for _report_id, _days, total in results) == [Decimal("0.00"), Decimal("100.00")]
    with Session(test_engine) as session:
        rows = list(session.scalars(select(ReportDayOccupancy)).all())
        assert len(rows) == 1
        assert rows[0].report_id in report_ids
    test_engine.dispose()


def test_manual_and_zero_rate_reports_still_claim_dates(db):
    manual = create_travel_report(
        db,
        employee_name="人工核定",
        start=date(2026, 8, 2),
        end=date(2026, 8, 3),
        manual_subsidy_total="75.56",
    )
    db.get(Settings, 1).daily_subsidy = Decimal("0.00")
    db.commit()
    zero_rate = create_travel_report(
        db,
        employee_name="零标准",
        start=date(2026, 8, 2),
        end=date(2026, 8, 3),
        daily_subsidy="0.00",
    )

    assert manual.occupied_dates == [date(2026, 8, 2), date(2026, 8, 3)]
    assert manual.subsidy_days == 0
    assert manual.subsidy_total == Decimal("75.56")
    assert zero_rate.occupied_dates == [date(2026, 8, 2), date(2026, 8, 3)]
    assert zero_rate.subsidy_days == 2
    assert zero_rate.subsidy_total == Decimal("0.00")


def test_switching_manual_mode_reallocates_but_changing_manual_amount_does_not(db):
    occupied_on = date(2026, 8, 4)
    owner = create_travel_report(
        db,
        employee_name="模式切换",
        start=occupied_on,
        end=occupied_on,
    )
    contender = create_travel_report(
        db,
        employee_name="模式切换",
        start=occupied_on,
        end=occupied_on,
        manual_subsidy_total="50.00",
    )
    assert contender.occupied_dates == []

    soft_delete_report(db, owner.id)
    contender = update_report(
        db,
        contender.id,
        ReportUpdate(
            report_date=occupied_on,
            employee_name="模式切换",
            daily_subsidy=Decimal("100.00"),
            manual_subsidy_total=Decimal("60.00"),
            trips=[trip(occupied_on, occupied_on)],
        ),
    )
    assert contender.occupied_dates == []
    assert contender.subsidy_total == Decimal("60.00")

    contender = update_report(
        db,
        contender.id,
        ReportUpdate(
            report_date=occupied_on,
            employee_name="模式切换",
            daily_subsidy=Decimal("100.00"),
            manual_subsidy_total=None,
            trips=[trip(occupied_on, occupied_on)],
        ),
    )
    assert contender.occupied_dates == [occupied_on]
    assert contender.subsidy_days == 1
    assert contender.subsidy_total == Decimal("100.00")


def test_edit_replaces_own_claims_without_treating_them_as_conflicts(db):
    report = create_travel_report(
        db,
        employee_name="张三",
        start=date(2026, 7, 18),
        end=date(2026, 7, 19),
    )

    updated = update_report(
        db,
        report.id,
        ReportUpdate(
            report_date=date(2026, 7, 19),
            employee_name="张三",
            daily_subsidy=Decimal("100.00"),
            trips=[trip(date(2026, 7, 18), date(2026, 7, 19))],
        ),
    )

    assert updated.occupied_dates == [date(2026, 7, 18), date(2026, 7, 19)]
    assert updated.subsidy_days == 2
    assert ReportDetailRead.model_validate(updated).occupied_dates == [date(2026, 7, 18), date(2026, 7, 19)]


def test_employee_change_releases_old_key_and_respects_new_key_conflicts(db):
    occupied_on = date(2026, 8, 7)
    new_employee_owner = create_travel_report(
        db,
        employee_name="新报销人",
        start=occupied_on,
        end=occupied_on,
    )
    moving = create_travel_report(
        db,
        employee_name="原报销人",
        start=occupied_on,
        end=occupied_on,
    )

    moving = update_report(
        db,
        moving.id,
        ReportUpdate(
            report_date=occupied_on,
            employee_name=" 新报销人 ",
            daily_subsidy=Decimal("100.00"),
            trips=[trip(occupied_on, occupied_on)],
        ),
    )
    replacement = create_travel_report(
        db,
        employee_name="原报销人",
        start=occupied_on,
        end=occupied_on,
    )

    assert new_employee_owner.occupied_dates == [occupied_on]
    assert moving.occupied_dates == []
    assert moving.subsidy_days == 0
    assert replacement.occupied_dates == [occupied_on]
    assert replacement.subsidy_days == 1


def test_amount_only_save_does_not_backfill_but_trip_change_reacquires_free_day(db):
    first = create_travel_report(
        db,
        employee_name="张三",
        start=date(2026, 7, 18),
        end=date(2026, 7, 19),
    )
    second = create_travel_report(
        db,
        employee_name="张三",
        start=date(2026, 7, 19),
        end=date(2026, 7, 20),
    )

    soft_delete_report(db, first.id)
    db.refresh(second)
    assert second.occupied_dates == [date(2026, 7, 20)]
    assert second.subsidy_days == 1

    second = update_report(
        db,
        second.id,
        ReportUpdate(
            report_date=date(2026, 7, 20),
            employee_name="张三",
            daily_subsidy=Decimal("120.00"),
            trips=[trip(date(2026, 7, 19), date(2026, 7, 20))],
        ),
    )
    assert second.occupied_dates == [date(2026, 7, 20)]
    assert second.subsidy_days == 1

    second = update_report(
        db,
        second.id,
        ReportUpdate(
            report_date=date(2026, 7, 20),
            employee_name="张三",
            daily_subsidy=Decimal("120.00"),
            trips=[
                TripWrite(
                    sort_order=1,
                    depart_date=date(2026, 7, 19),
                    depart_hour=8,
                    arrive_date=date(2026, 7, 20),
                    arrive_hour=20,
                )
            ],
        ),
    )
    assert second.occupied_dates == [date(2026, 7, 19), date(2026, 7, 20)]
    assert second.subsidy_days == 2

    restored = restore_deleted_report(db, first.id)
    assert restored.occupied_dates == [date(2026, 7, 18)]
    assert restored.subsidy_days == 1


def test_status_changes_retain_claims_and_purge_cascades(db):
    report = create_travel_report(
        db,
        employee_name="状态测试",
        start=date(2026, 8, 5),
        end=date(2026, 8, 6),
    )
    report_id = report.id

    update_report_status(db, report_id, "checked")
    assert occupancy_dates(db, report_id) == [date(2026, 8, 5), date(2026, 8, 6)]
    update_report_status(db, report_id, "draft")
    purge_report(db, report_id)

    assert db.get(ExpenseReport, report_id) is None
    assert occupancy_dates(db, report_id) == []


def test_return_to_draft_reallocates_on_next_content_save(db):
    first = create_travel_report(
        db,
        employee_name="状态回退",
        start=date(2026, 8, 10),
        end=date(2026, 8, 11),
    )
    second = create_travel_report(
        db,
        employee_name="状态回退",
        start=date(2026, 8, 11),
        end=date(2026, 8, 12),
    )
    update_report_status(db, second.id, "checked")
    soft_delete_report(db, first.id)

    second = update_report_status(db, second.id, "draft")
    assert second.occupied_dates == [date(2026, 8, 12)]
    assert second.day_occupancy_refresh_pending is True

    second = update_report(
        db,
        second.id,
        ReportUpdate(
            report_date=date(2026, 8, 12),
            employee_name="状态回退",
            purpose="状态回退后仅修改事由",
            daily_subsidy=Decimal("100.00"),
            trips=[trip(date(2026, 8, 11), date(2026, 8, 12))],
        ),
    )

    assert second.occupied_dates == [date(2026, 8, 11), date(2026, 8, 12)]
    assert second.subsidy_days == 2
    assert second.day_occupancy_refresh_pending is False


def test_non_date_recalculation_uses_persisted_claims(db):
    first = create_travel_report(
        db,
        employee_name="张三",
        start=date(2026, 7, 18),
        end=date(2026, 7, 19),
    )
    second = create_travel_report(
        db,
        employee_name="张三",
        start=date(2026, 7, 19),
        end=date(2026, 7, 20),
    )

    second.daily_subsidy = Decimal("120.00")
    recalculate_report_totals(second)

    assert first.subsidy_days == 2
    assert second.subsidy_days == 1
    assert second.subsidy_total == Decimal("120.00")


def test_startup_recalculation_does_not_redistribute_released_dates(db, monkeypatch):
    first = create_travel_report(
        db,
        employee_name="启动重算",
        start=date(2026, 8, 11),
        end=date(2026, 8, 12),
    )
    second = create_travel_report(
        db,
        employee_name="启动重算",
        start=date(2026, 8, 12),
        end=date(2026, 8, 13),
    )
    soft_delete_report(db, first.id)
    monkeypatch.setattr(connection, "engine", db.get_bind())

    connection.recalculate_existing_reports()
    db.expire_all()
    second = db.get(ExpenseReport, second.id)

    assert second.occupied_dates == [date(2026, 8, 13)]
    assert second.subsidy_days == 1


def test_day_occupancy_endpoint_excludes_current_report(db):
    first = create_travel_report(
        db,
        employee_name="张三",
        start=date(2026, 7, 18),
        end=date(2026, 7, 19),
    )
    second = create_travel_report(
        db,
        employee_name="张三",
        start=date(2026, 7, 20),
        end=date(2026, 7, 20),
    )
    response = get_report_day_occupancies(
        employee_name=" 张三 ",
        exclude_report_id=first.id,
        db=db,
    )
    payload = TypeAdapter(ApiResponse[list[ReportDayOccupancyRead]]).validate_python(response).model_dump(mode="json")

    assert payload["data"] == [{"date": "2026-07-20", "report_id": second.id}]


def test_initialize_occupancies_uses_report_id_order_and_skips_invalid_legacy_data(db):
    first = ExpenseReport(
        report_type="travel",
        report_date=date(2026, 7, 19),
        employee_name="张三",
        daily_subsidy=Decimal("100.00"),
        subsidy_days=99,
        subsidy_total=Decimal("9900.00"),
        total_amount=Decimal("9900.00"),
    )
    first.trips.append(
        Trip(sort_order=1, depart_date=date(2026, 7, 18), depart_month=7, depart_day=18, arrive_date=date(2026, 7, 19), arrive_month=7, arrive_day=19)
    )
    second = ExpenseReport(
        report_type="travel",
        report_date=date(2026, 7, 20),
        employee_name="张三",
        daily_subsidy=Decimal("100.00"),
        subsidy_days=99,
        subsidy_total=Decimal("9900.00"),
        total_amount=Decimal("9900.00"),
    )
    second.trips.append(
        Trip(sort_order=1, depart_date=date(2026, 7, 19), depart_month=7, depart_day=19, arrive_date=date(2026, 7, 20), arrive_month=7, arrive_day=20)
    )
    invalid = ExpenseReport(
        report_type="travel",
        report_date=date(2026, 7, 21),
        employee_name="无效历史",
        daily_subsidy=Decimal("100.00"),
        subsidy_days=7,
        subsidy_total=Decimal("700.00"),
        total_amount=Decimal("700.00"),
    )
    invalid.trips.append(
        Trip(
            sort_order=1,
            depart_date=date(2026, 7, 21),
            depart_month=7,
            depart_day=21,
            depart_hour=12,
            arrive_date=date(2026, 7, 21),
            arrive_month=7,
            arrive_day=21,
            arrive_hour=10,
        )
    )
    db.add_all([first, second, invalid])
    db.commit()

    # 模拟一次中断升级留下的部分记录；正式初始化必须清空后再按 ID 排序取得。
    db.add(
        ReportDayOccupancy(
            report_id=second.id,
            employee_key="张三",
            occupied_on=date(2026, 7, 19),
        )
    )
    db.commit()

    initialized = initialize_report_day_occupancies(db)
    db.commit()

    assert initialized == 2
    assert occupancy_dates(db, first.id) == [date(2026, 7, 18), date(2026, 7, 19)]
    assert occupancy_dates(db, second.id) == [date(2026, 7, 20)]
    assert (first.subsidy_days, second.subsidy_days) == (2, 1)
    assert occupancy_dates(db, invalid.id) == []
    assert (invalid.subsidy_days, invalid.subsidy_total, invalid.total_amount) == (
        7,
        Decimal("700.00"),
        Decimal("700.00"),
    )


def test_v6_startup_creates_snapshot_backfills_and_sets_v7(monkeypatch, tmp_path):
    database_path = tmp_path / "schema-v6.db"
    test_engine = create_engine(f"sqlite:///{database_path.as_posix()}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=test_engine)
    with Session(test_engine) as session:
        report = ExpenseReport(
            report_type="travel",
            report_date=date(2026, 8, 10),
            employee_name="迁移测试",
            daily_subsidy=Decimal("80.00"),
            subsidy_days=9,
            subsidy_total=Decimal("720.00"),
            total_amount=Decimal("720.00"),
        )
        report.trips.append(
            Trip(sort_order=1, depart_date=date(2026, 8, 9), depart_month=8, depart_day=9, arrive_date=date(2026, 8, 10), arrive_month=8, arrive_day=10)
        )
        session.add(report)
        session.commit()
        report_id = report.id
    with test_engine.begin() as database:
        database.execute(text("DROP TABLE report_day_occupancies"))
        database.execute(text("PRAGMA user_version = 6"))

    snapshots: list[str] = []
    monkeypatch.setattr(connection, "engine", test_engine)
    monkeypatch.setattr(
        maintenance_service,
        "create_safety_snapshot",
        lambda _db, reason: snapshots.append(reason),
    )

    connection.create_db_and_tables()

    with Session(test_engine) as session:
        migrated = session.get(ExpenseReport, report_id)
        schema_version = session.execute(text("PRAGMA user_version")).scalar_one()
        assert migrated.occupied_dates == [date(2026, 8, 9), date(2026, 8, 10)]
        assert migrated.subsidy_days == 2
        assert migrated.subsidy_total == Decimal("160.00")
        assert schema_version == 7
    assert snapshots == ["pre_schema_v7"]
    test_engine.dispose()


def test_failed_v6_occupancy_initialization_does_not_mark_schema_v7(monkeypatch, tmp_path):
    database_path = tmp_path / "schema-v6-failed-init.db"
    test_engine = create_engine(f"sqlite:///{database_path.as_posix()}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=test_engine)
    with test_engine.begin() as database:
        database.execute(text("DROP TABLE report_day_occupancies"))
        database.execute(text("PRAGMA user_version = 6"))

    monkeypatch.setattr(connection, "engine", test_engine)
    monkeypatch.setattr(maintenance_service, "create_safety_snapshot", lambda _db, reason: None)
    monkeypatch.setattr(
        connection,
        "initialize_report_day_occupancies",
        lambda: (_ for _ in ()).throw(RuntimeError("初始化失败")),
    )

    with pytest.raises(RuntimeError, match="初始化失败"):
        connection.create_db_and_tables()

    with test_engine.connect() as database:
        assert database.execute(text("PRAGMA user_version")).scalar_one() == 6
    test_engine.dispose()
