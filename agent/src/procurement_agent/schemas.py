from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ULID_PATTERN = r"^[0-9A-HJKMNP-TV-Z]{26}$"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CatalogEntry(_Strict):
    sku: str
    name: str
    unitPriceCents: int
    maxQtyPerOrder: int


class Invocation(_Strict):
    runId: str
    request: str = Field(min_length=1, max_length=2000)
    catalog: list[CatalogEntry] = Field(min_length=1)


class Requirement(_Strict):
    description: str
    qty: int = Field(ge=1, le=50)


class Requirements(_Strict):
    items: list[Requirement] = Field(min_length=1, max_length=10)


class SourcedLine(_Strict):
    sku: str
    qty: int = Field(ge=1, le=50)
    claimedUnitPriceCents: int | None = None


class Sourcing(_Strict):
    lines: list[SourcedLine] = Field(max_length=10)


class Justification(_Strict):
    justification: str = Field(min_length=1, max_length=2000)


class ProposedOrder(_Strict):
    runId: str = Field(pattern=ULID_PATTERN)
    currency: Literal["USD"]
    lines: list[SourcedLine] = Field(min_length=1, max_length=10)
    justification: str = Field(max_length=2000)
