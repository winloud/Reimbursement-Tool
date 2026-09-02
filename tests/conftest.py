import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

# pytest collection imports backend modules before individual fixtures run. Tests
# use the ordinary HTTP/portable backend surface unless a test explicitly
# overrides the target with monkeypatch.
os.environ["REIMBURSEMENT_DISTRIBUTION_TARGET"] = "zip"

from backend.database.connection import Base
from backend.models import expense_item, invoice, report, report_attachment, settings, trip  # noqa: F401


@pytest.fixture()
def db() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()
