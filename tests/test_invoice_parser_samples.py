from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from backend.services.invoice_parser import parse_invoice_file


PROJECT_ROOT = Path(__file__).resolve().parents[1]


TAX_TOTAL_SAMPLES = [
    (74, "uploads/26/city_transport_invoice_a8671e1e9a9d4a33904b28456ab9137c.pdf", "70.11", "12525399", date(2024, 4, 13)),
    (75, "uploads/26/transport_fare_invoice_da39464506e240bcb0e78ee59eeac9da.pdf", "13.00", "00359005", date(2024, 4, 13)),
    (106, "uploads/135/106_city_transport_419fb640_340bbe25a7974cd9aa771febba060622.pdf", "35.46", "03810961", date(2024, 3, 29)),
    (107, "uploads/135/107_city_transport_4c952ccc_69124be800a547da87d624556f0b6578.pdf", "106.99", "87598651", date(2024, 3, 29)),
    (109, "uploads/136/109_city_transport_c2eea8b5_1fea466f47a7426882b843b6bed41dad.pdf", "162.92", "83199303", date(2024, 4, 10)),
    (110, "uploads/136/110_city_transport_1e6a13b6_e45fe336b88543e291c9078f0e549f36.pdf", "67.29", "03930130", date(2024, 4, 10)),
    (113, "uploads/137/113_city_transport_b3f0b258_d69ca867d31a4a098c7ae9ebc38d9e3d.pdf", "34.78", "08511918", date(2024, 4, 10)),
    (114, "uploads/137/114_city_transport_7ab75887_770b545716754d3cb80c2e84a1c6eaa8.pdf", "12.81", "65102507", date(2024, 4, 10)),
    (115, "uploads/137/115_city_transport_9fccf554_31d965e00ab447a1b5dc09c0b0d24572.pdf", "13.64", "15405280", date(2024, 4, 10)),
    (116, "uploads/138/116_city_transport_626368ab_f8d4b08bca2c4f30bd9eb6d0c88d2736.pdf", "13.00", "00359005", date(2024, 4, 13)),
    (117, "uploads/138/117_city_transport_59c30eb6_0e6c5525dfa54bcb9d5c433d9de80380.pdf", "70.11", "12525399", date(2024, 4, 13)),
    (118, "uploads/138/118_city_transport_a1d9095d_abafbd797f454db497fd59b8ab9c712a.pdf", "7.00", "96855725", date(2024, 4, 18)),
    (119, "uploads/138/119_city_transport_f0541610_3ef57a2cab2f4c5f93083c30c13dded7.pdf", "7.00", "96941464", date(2024, 4, 18)),
    (122, "uploads/138/122_city_transport_ec5c218e_8270183fa5cb48029f818e26cb64a731.pdf", "72.02", "03937519", date(2024, 4, 18)),
    (123, "uploads/138/123_city_transport_cafb5c7f_b93c5fbb847643b1ba90d3053aeb99b2.pdf", "24.76", "95569739", date(2024, 4, 18)),
]


@pytest.mark.parametrize("invoice_id,relative_path,amount,invoice_no,invoice_date", TAX_TOTAL_SAMPLES)
def test_parser_uses_tax_total_for_local_invoice_samples(invoice_id, relative_path, amount, invoice_no, invoice_date):
    path = PROJECT_ROOT / "backend" / relative_path
    if not path.exists():
        pytest.skip(f"local invoice sample {invoice_id} is not present")

    parsed = parse_invoice_file(path, "pdf")

    assert parsed.amount == Decimal(amount)
    assert parsed.invoice_no == invoice_no
    assert parsed.invoice_date == invoice_date
    assert parsed.raw["amount_selection_reason"] == "text_tax_total_over_standard_qr"
