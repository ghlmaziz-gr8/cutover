"""Monthly cost estimates for the Modernize proposals, from the published rates in cost_rates.json.

Estimates only. They cover compute, memory, requests and database storage on Google Cloud. They leave out
network transfer, backups, high availability, logging and other services, and they do not cover AWS or Azure.
"""
import json
from pathlib import Path

RATES_PATH = Path(__file__).with_name("cost_rates.json")


def load_rates(path: Path | str = RATES_PATH) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def cloud_run_monthly(rates: dict, users: int, requests_per_user_per_day: float) -> float:
    """Request-based Cloud Run for an application that serves `users` people."""
    run, size = rates["cloud_run"], rates["sizing"]
    requests = users * requests_per_user_per_day * size["days_per_month"]
    vcpu_seconds = requests * size["seconds_per_request"] * size["vcpu_per_request"]
    gib_seconds = requests * size["seconds_per_request"] * size["gib_per_request"]
    billable_vcpu = max(0.0, vcpu_seconds - run["free_vcpu_seconds"])
    billable_gib = max(0.0, gib_seconds - run["free_gib_seconds"])
    billable_requests = max(0.0, requests - run["free_requests"])
    return (billable_vcpu * run["cpu_per_vcpu_second"]
            + billable_gib * run["memory_per_gib_second"]
            + billable_requests / 1_000_000 * run["per_million_requests"])


def database_tier(rates: dict, users: int) -> dict:
    for tier in rates["sizing"]["database_tiers"]:
        if users <= tier["max_users"]:
            return tier
    return rates["sizing"]["database_tiers"][-1]


def cloud_sql_monthly(rates: dict, users: int) -> float:
    """Cloud SQL for PostgreSQL, sized by the tier that covers `users`."""
    db, tier = rates["cloud_sql_postgres"], database_tier(rates, users)
    hours = db["hours_per_month"]
    return (tier["vcpu"] * db["per_vcpu_hour"] * hours
            + tier["memory_gib"] * db["per_gib_memory_hour"] * hours
            + tier["storage_gib"] * db["per_gib_storage_hour"] * hours)


NO_DATABASE_LINE = "No database cost is estimated, because no database tables were found in the SQL scripts."


def _usd(value: float) -> str:
    if value < 0.005:
        return "$0"
    return f"${value:,.0f}" if value >= 10 else f"${value:,.2f}"


def _range(low: float, high: float) -> str:
    return f"about {_usd(low)}" if _usd(low) == _usd(high) else f"about {_usd(low)} to {_usd(high)}"


def containerized_line(rates: dict, users: int) -> str:
    size = rates["sizing"]
    low = cloud_run_monthly(rates, users, size["requests_per_user_per_day_low"])
    high = cloud_run_monthly(rates, users, size["requests_per_user_per_day_high"])
    return (f"Estimated Google Cloud cost for {users:,} users: {_range(low, high)} a month "
            f"for the application containers on Cloud Run (compute and requests only).")


def managed_line(rates: dict, users: int) -> str:
    size = rates["sizing"]
    run_low = cloud_run_monthly(rates, users, size["requests_per_user_per_day_low"])
    run_high = cloud_run_monthly(rates, users, size["requests_per_user_per_day_high"])
    db = cloud_sql_monthly(rates, users)
    tier = database_tier(rates, users)
    return (f"Estimated Google Cloud cost for {users:,} users: {_range(run_low + db, run_high + db)} a month "
            f"for Cloud SQL for PostgreSQL ({tier['vcpu']} vCPU, {tier['memory_gib']} GiB memory, "
            f"{tier['storage_gib']} GiB storage, about {_usd(db)}) plus the application on Cloud Run.")


def cost_note(rates: dict) -> str:
    return (f"Rates from Google Cloud's published prices, checked {rates['checked']}, in {rates['currency']}. "
            "Not costed: AWS and Azure, and network, backups, high availability and logging. Estimates, not quotes.")


def cost_points(rates: dict, proposal_id: str, table_count: int | None = None) -> list[str]:
    """Cost lines for a proposal. The keep proposal gets none, because its cost depends on the current hosting.
    With no database tables found, the managed proposal gets no database cost line."""
    samples = rates["sizing"]["sample_user_counts"]
    if proposal_id == "containerize":
        return [containerized_line(rates, n) for n in samples] + [cost_note(rates)]
    if proposal_id == "managed":
        if table_count == 0:
            return [NO_DATABASE_LINE, cost_note(rates)]
        return [managed_line(rates, n) for n in samples] + [cost_note(rates)]
    return []
