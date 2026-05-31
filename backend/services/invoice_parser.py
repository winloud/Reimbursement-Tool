import re
import tempfile
import zipfile
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from xml.etree import ElementTree

from pypdf import PdfReader

from backend.schemas.invoice import InvoiceParsedData

AMOUNT_PATTERN = re.compile(r"价税合计[（\(]小写[）\)]\s*[¥￥]?\s*([\d,]+\.?\d*)")
GENERIC_AMOUNT_PATTERN = re.compile(r"[¥￥]\s*([\d,]+\.\d{2})")


def parse_decimal(value: str | None) -> Decimal:
    if not value:
        return Decimal("0.00")
    normalized = value.replace(",", "").replace("¥", "").replace("￥", "").strip()
    try:
        return Decimal(normalized).quantize(Decimal("0.01"))
    except InvalidOperation:
        return Decimal("0.00")


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    text = value.strip().replace("年", "-").replace("月", "-").replace("日", "")
    text = text.replace("/", "-").replace(".", "-")
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            from datetime import datetime

            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def find_xml_text(root: ElementTree.Element, tag: str) -> str | None:
    for elem in root.iter():
        if elem.tag.split("}")[-1] == tag and elem.text:
            return elem.text.strip()
    return None


def parse_xml_invoice(file_path: Path) -> InvoiceParsedData:
    root = ElementTree.parse(file_path).getroot()
    invoice_no = find_xml_text(root, "FPH") or find_xml_text(root, "InvoiceNo")
    invoice_date = parse_date(find_xml_text(root, "KPRQ") or find_xml_text(root, "IssueDate"))
    amount = parse_decimal(find_xml_text(root, "JSHJ") or find_xml_text(root, "TotalAmount"))
    seller_name = find_xml_text(root, "XFMC") or find_xml_text(root, "SellerName")
    buyer_name = find_xml_text(root, "GFMC") or find_xml_text(root, "BuyerName")
    return InvoiceParsedData(
        invoice_no=invoice_no,
        invoice_date=invoice_date,
        amount=amount,
        seller_name=seller_name,
        buyer_name=buyer_name,
        raw={"source": "xml"},
    )


def parse_pdf_invoice(file_path: Path) -> InvoiceParsedData:
    reader = PdfReader(str(file_path))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    amount_match = AMOUNT_PATTERN.search(text) or GENERIC_AMOUNT_PATTERN.search(text)
    invoice_no_match = re.search(r"发票号码[:：]?\s*([0-9]{6,})", text)
    date_match = re.search(r"开票日期[:：]?\s*([0-9]{4}[年\-/\.][0-9]{1,2}[月\-/\.][0-9]{1,2}日?)", text)
    return InvoiceParsedData(
        invoice_no=invoice_no_match.group(1) if invoice_no_match else None,
        invoice_date=parse_date(date_match.group(1)) if date_match else None,
        amount=parse_decimal(amount_match.group(1) if amount_match else None),
        raw={"source": "pdf"},
    )


def parse_ofd_invoice(file_path: Path) -> InvoiceParsedData:
    with tempfile.TemporaryDirectory() as tmp_dir:
        with zipfile.ZipFile(file_path) as archive:
            archive.extractall(tmp_dir)
        xml_paths = list(Path(tmp_dir).rglob("*.xml"))
        for xml_path in xml_paths:
            try:
                parsed = parse_xml_invoice(xml_path)
            except ElementTree.ParseError:
                continue
            if parsed.invoice_no or parsed.amount > Decimal("0.00"):
                parsed.raw["source"] = "ofd"
                return parsed
    return InvoiceParsedData(raw={"source": "ofd"})


def parse_invoice_file(file_path: Path, file_type: str) -> InvoiceParsedData:
    if file_type == "xml":
        return parse_xml_invoice(file_path)
    if file_type == "pdf":
        return parse_pdf_invoice(file_path)
    if file_type == "ofd":
        return parse_ofd_invoice(file_path)
    return InvoiceParsedData(raw={"source": "image"})
