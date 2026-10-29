"""Describe a JSON payload by its field names and types only, never its values.

Used to check normalize.py against real Garmin responses: safe to paste anywhere because no data comes through.
"""

from __future__ import annotations

from typing import Any

MAX_KEYS = 40


def shape(value: Any, depth: int = 0) -> str:
    pad = "  " * depth
    if isinstance(value, dict):
        lines = []
        for k, v in list(value.items())[:MAX_KEYS]:
            lines.append(f"{pad}{k}: {type(v).__name__}")
            if isinstance(v, (dict, list)) and v:
                lines.append(shape(v, depth + 1))
        return "\n".join(lines)
    if isinstance(value, list):
        return f"{pad}[{len(value)} items]" + ("\n" + shape(value[0], depth + 1) if value else "")
    return f"{pad}{type(value).__name__}"


def shapes(latest_by_endpoint: dict[str, Any]) -> str:
    if not latest_by_endpoint:
        return "Nothing synced from Garmin yet."
    return "\n\n".join(f"== {name}\n{shape(body)}" for name, body in sorted(latest_by_endpoint.items()))
