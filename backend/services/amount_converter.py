from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException, status


CN_DIGITS = "零壹贰叁肆伍陆柒捌玖"
CN_UNITS = ["", "拾", "佰", "仟"]
CN_SECTION_UNITS = ["", "万", "亿"]


def quantize_currency(value: Decimal) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _section_to_cn(section: int) -> str:
    result = ""
    zero_pending = False
    unit_index = 0

    while section > 0:
        digit = section % 10
        if digit == 0:
            if result:
                zero_pending = True
        else:
            if zero_pending:
                result = CN_DIGITS[0] + result
                zero_pending = False
            result = CN_DIGITS[digit] + CN_UNITS[unit_index] + result
        unit_index += 1
        section //= 10

    return result


def integer_to_chinese_upper(amount: int) -> str:
    if amount == 0:
        return CN_DIGITS[0]

    result = ""
    section_index = 0
    zero_pending = False
    lower_section: int | None = None

    while amount > 0:
        section = amount % 10000
        if section == 0:
            if result:
                zero_pending = True
        else:
            section_text = _section_to_cn(section) + CN_SECTION_UNITS[section_index]
            if zero_pending or (
                result and lower_section is not None and lower_section < 1000
            ):
                result = CN_DIGITS[0] + result
                zero_pending = False
            result = section_text + result
        lower_section = section
        section_index += 1
        amount //= 10000

    return result


def amount_to_chinese_upper(value: Decimal) -> str:
    amount = quantize_currency(value)
    if amount < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="金额不能为负数")

    cents_total = int(amount * 100)
    integer_part = cents_total // 100
    jiao = (cents_total % 100) // 10
    fen = cents_total % 10

    result = f"{integer_to_chinese_upper(integer_part)}元"
    if jiao == 0 and fen == 0:
        return f"{result}整"
    if jiao:
        result += f"{CN_DIGITS[jiao]}角"
    elif fen:
        result += "零"
    if fen:
        result += f"{CN_DIGITS[fen]}分"
    return result
