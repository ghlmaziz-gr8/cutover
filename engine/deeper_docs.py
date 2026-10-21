"""Deeper assessment: plain-language documents built from the discovery findings.

Rule-based and read-only. It reads only the findings the discovery engine already produced, so the
source is not read again. It writes structure (names of screens, tables and roles, counts and tool
names), never a value copied from the code, configuration or fixtures.

Every point names the finding it came from (`basis`) and that finding's `category`, so the API can
hide points a role may not see, the same way it hides findings.
"""
from __future__ import annotations

import cost_model

MAX_NAMES = 12
MAX_SCREENS = 12

LIMITS = [
    "Built only from the discovery findings. The source was not read again for these documents.",
    "Structure only: names of screens, tables and roles, and counts. No value is copied from the code, configuration or data.",
    "Each point names the finding it came from, so a reviewer can check it.",
]


def _finding(report: dict, fid: str) -> dict | None:
    item = (report.get("findings") or {}).get(fid)
    return item if isinstance(item, dict) else None


def _value(report: dict, fid: str) -> dict:
    item = _finding(report, fid)
    value = (item or {}).get("value")
    return value if isinstance(value, dict) else {}


def _list_value(report: dict, fid: str, *keys: str) -> list:
    value = _value(report, fid)
    for key in keys:
        if isinstance(value.get(key), list):
            return value[key]
    return []


def _point(text: str, finding: dict | None, category: str | None = None) -> dict:
    """A point with its basis. `category` is only for points that do not come from one finding."""
    return {
        "text": text,
        "category": (finding or {}).get("category") or category,
        "basis": (finding or {}).get("id"),
    }


def _names(values, limit: int = MAX_NAMES) -> str:
    items = [str(v) for v in (values or []) if str(v).strip()]
    shown = ", ".join(items[:limit])
    if len(items) > limit:
        shown += f" and {len(items) - limit} more"
    return shown


def _count(value: dict, *keys: str) -> int | None:
    for key in keys:
        if isinstance(value.get(key), int):
            return value[key]
    return None


def _business(report: dict) -> list[dict]:
    points = []
    purpose = _finding(report, "app.purpose")
    summary = str(_value(report, "app.purpose").get("summary") or "").strip()
    if summary:
        points.append(_point(f"The project describes itself as: {summary}", purpose))
    roles = _value(report, "ui.roles")
    if roles.get("roles"):
        names = list(roles["roles"].keys())
        points.append(_point(f"Roles named in access rules: {_names(names)}.", _finding(report, "ui.roles")))
    if _finding(report, "ui.client_facing"):
        points.append(_point("The code suggests a portal that outside users, such as patients or clients, use directly.",
                             _finding(report, "ui.client_facing")))
    history = report.get("history") or {}
    if history.get("available"):
        years = history.get("application_age_years")
        commits = history.get("total_commits")
        if years is not None and commits is not None:
            points.append(_point(f"Version history: about {years} years, {commits} commits, last change "
                                 f"{history.get('days_since_last_commit', 0)} days ago.", None, category=None))
    return points


def _systems(report: dict) -> list[dict]:
    points = []
    languages = _finding(report, "stack.languages")
    if languages:
        names = _list_value(report, "stack.languages", "languages", "names")
        points.append(_point(f"Languages detected: {_names(names)}." if names else "Languages are detected in the code.", languages))
    for fid, label in (("runtime.java", "Java version"), ("runtime.spring_boot", "Spring Boot version"), ("stack.frontend", "Frontend framework")):
        item = _finding(report, fid)
        if item:
            version = _value(report, fid).get("version")
            points.append(_point(f"{label}: {version}." if version else f"{label} found in the project files.", item))
    images = _finding(report, "containers.images")
    if images:
        count = _count(_value(report, "containers.images"), "count")
        points.append(_point(f"{count} container image references." if count is not None else "Container images are referenced.", images))
    delivery = _finding(report, "delivery.ci")
    if delivery:
        points.append(_point("Automated build and deploy pipelines are defined in the repository.", delivery))
    infra = _finding(report, "infrastructure.as_code")
    if infra:
        points.append(_point("Infrastructure is defined as code in the repository.", infra))
    return points


def _data(report: dict) -> list[dict]:
    points = []
    tables = _finding(report, "data.tables")
    if tables:
        value = _value(report, "data.tables")
        count = _count(value, "count")
        names = _names(value.get("names") or [])
        text = f"{count} tables in the SQL scripts" if count is not None else "Tables in the SQL scripts"
        points.append(_point(f"{text}: {names}." if names else f"{text}.", tables))
    engines = _finding(report, "data.database_engines")
    if engines:
        names = _list_value(report, "data.database_engines", "engines", "names")
        points.append(_point(f"Database engines referenced: {_names(names)}." if names else "Database engines are referenced.", engines))
    migrations = _finding(report, "data.migrations")
    if migrations:
        tool = _value(report, "data.migrations").get("tool")
        points.append(_point(f"Schema changes are managed with {tool}." if tool else "Schema changes are managed with a migration tool.", migrations))
    entities = _finding(report, "data.entities")
    if entities:
        count = _count(_value(report, "data.entities"), "count")
        points.append(_point(f"{count} JPA entities map to database tables." if count is not None else "Persistent entities map to database tables.", entities))
    return points


def _workflows(report: dict) -> list[dict]:
    points = []
    screens = _finding(report, "ui.screens")
    for screen in (_value(report, "ui.screens").get("screens") or [])[:MAX_SCREENS]:
        if not isinstance(screen, dict) or not screen.get("name"):
            continue
        parts = []
        for key, label in (("forms", "forms"), ("inputs", "inputs"), ("buttons", "buttons"), ("tables", "tables")):
            if screen.get(key):
                parts.append(f"{screen[key]} {label}")
        detail = ", ".join(parts) if parts else "no forms or buttons found"
        points.append(_point(f"Screen \"{screen['name']}\": {detail}.", screens))
    endpoints = _finding(report, "ui.endpoints")
    if endpoints:
        count = _count(_value(report, "ui.endpoints"), "count")
        points.append(_point(f"{count} endpoints are declared in the controllers, so users reach these actions through the screens."
                             if count is not None else "Endpoints declared in the controllers connect the screens to the services.", endpoints))
    return points


def _architecture(report: dict) -> dict:
    layers = []
    roles = _value(report, "ui.roles").get("roles") or {}
    if roles:
        layers.append({"layer": "Users", "detail": _names(roles.keys(), 6), "category": "ui_portal", "basis": "ui.roles"})
    screens = _value(report, "ui.screens").get("count")
    if isinstance(screens, int) and _finding(report, "ui.screens"):
        layers.append({"layer": "Screens", "detail": f"{screens} screens", "category": "ui_portal", "basis": "ui.screens"})
    endpoints = _count(_value(report, "ui.endpoints"), "count")
    if endpoints is not None and _finding(report, "ui.endpoints"):
        layers.append({"layer": "Services", "detail": f"{endpoints} endpoints", "category": "ui_portal", "basis": "ui.endpoints"})
    tables = _count(_value(report, "data.tables"), "count")
    if tables is not None and _finding(report, "data.tables"):
        layers.append({"layer": "Data", "detail": f"{tables} tables", "category": "data", "basis": "data.tables"})
    hosting = []
    if _finding(report, "containers.images"):
        hosting.append("containers")
    if _finding(report, "infrastructure.as_code"):
        hosting.append("infrastructure as code")
    if hosting:
        layers.append({"layer": "Hosting", "detail": " and ".join(hosting), "category": "infrastructure", "basis": "infrastructure.as_code" if "infrastructure as code" in hosting else "containers.images"})
    return {"layers": layers}


def _proposal(pid: str, title: str, effort: str, summary: str, tradeoffs: list[str], points: list[str], basis: list[str], categories: list[str]) -> dict:
    return {"id": pid, "title": title, "effort": effort, "summary": summary, "tradeoffs": tradeoffs,
            "points": points, "basis": basis, "categories": categories}


def modernize(report: dict) -> list[dict]:
    """Three future-state proposals for the application, built from the findings. Each is for review,
    not a decision. Costs are estimates from the published rates in cost_rates.json (Google Cloud only).
    Each lists the findings it relies on and the categories they come from."""
    containers = _finding(report, "containers.images")
    ci = _finding(report, "delivery.ci")
    iac = _finding(report, "infrastructure.as_code")
    tables = _finding(report, "data.tables")
    table_count = _count(_value(report, "data.tables"), "count")

    keep_points = []
    keep_basis = []
    if containers:
        keep_points.append("Pin the container images to fixed versions, so a rebuild gives the same result.")
        keep_basis.append("containers.images")
    if ci:
        keep_points.append("Keep the existing pipeline and add a test step that must pass before a deploy.")
        keep_basis.append("delivery.ci")
    else:
        keep_points.append("No pipeline was found in the repository. Add one that builds and tests every change.")
    keep = _proposal(
        "keep", "Keep the current platform and tighten it", "low",
        "Leave the application where it runs now, and fix the gaps the findings show.",
        ["Lowest change and risk. The team keeps the skills it has.",
         "The limits of the current hosting remain."],
        keep_points, keep_basis, [f["category"] for f in (containers, ci) if f] or [],
    )

    container_points = [
        "Package each part of the application as a container image, built the same way every time.",
    ]
    container_basis = []
    if containers:
        container_points.append("Start from the container images the code already references.")
        container_basis.append("containers.images")
    if iac:
        container_points.append("Describe the environments in the infrastructure code that already exists.")
        container_basis.append("infrastructure.as_code")
    if ci:
        container_basis.append("delivery.ci")
    containerize = _proposal(
        "containerize", "Package the application in containers and automate delivery", "medium",
        "Make builds and deploys repeatable across environments.",
        ["Repeatable builds and deploys. Easier to move later.",
         "Needs container skills and a registry to hold the images."],
        container_points, container_basis, [f["category"] for f in (containers, ci, iac) if f] or [],
    )

    managed_summary = ("Use a managed database for the " + str(table_count) + " tables, and managed hosting for the application.") \
        if table_count is not None else "Use a managed database and managed hosting for the application."
    managed_points = [managed_summary]
    managed_basis = []
    if tables:
        managed_basis.append("data.tables")
    if iac:
        managed_points.append("Build on the infrastructure code that already exists, so the cloud set-up is written down.")
        managed_basis.append("infrastructure.as_code")
    managed = _proposal(
        "managed", "Move the database and hosting to managed cloud services", "high",
        "Let the cloud provider run backups, scaling and patching.",
        ["Less to run and patch. Backups and scaling come from the provider.",
         "Needs the cloud choice and intake first, and a planned data migration."],
        managed_points, managed_basis, [f["category"] for f in (tables, iac) if f] or [],
    )
    rates = cost_model.load_rates()
    containerize["points"] += cost_model.cost_points(rates, "containerize")
    managed["points"] += cost_model.cost_points(rates, "managed")
    return [keep, containerize, managed]


def build(report: dict) -> dict:
    """The deeper assessment for one discovery report: four sections, an architecture overview, and the limits."""
    sections = [
        {"id": "business", "title": "Business: what the application does", "points": _business(report)},
        {"id": "systems", "title": "Systems: technology and delivery", "points": _systems(report)},
        {"id": "data", "title": "Data: what is stored", "points": _data(report)},
        {"id": "workflows", "title": "Workflows: screens and actions", "points": _workflows(report)},
    ]
    return {"sections": sections, "architecture": _architecture(report), "modernize": modernize(report), "limits": LIMITS}
