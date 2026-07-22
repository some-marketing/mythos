"""
poc/cli.py -- Operator CLI for interacting with the orchestrator.

Usage examples:
    simpleminions worker --orchestrator http://localhost:8000 --port 8001
    simpleminions orchestrate --port 8000
    simpleminions submit "Create a social media campaign"
    simpleminions run-workflow social_media_campaign --param brand=PureFlow
    simpleminions status p_abc123
    simpleminions stream p_abc123
    simpleminions nodes
"""

from __future__ import annotations

import os
from typing import Any

import httpx
import typer
import uvicorn
from rich.console import Console
from rich.table import Table

app = typer.Typer(
    name="simpleminions",
    help="SimpleMiniions CLI -- Distributed AI Agency Orchestration",
    add_completion=False,
)
console = Console()


def _parse_params(values: list[str]) -> dict[str, Any]:
    params: dict[str, Any] = {}
    for raw in values:
        if "=" not in raw:
            raise ValueError(f"Invalid --param '{raw}', expected key=value")
        key, value = raw.split("=", 1)
        params[key.strip()] = value.strip()
    return params


@app.command()
def worker(
    orchestrator: str = typer.Option(
        "http://localhost:8000",
        "--orchestrator",
        "-o",
        help="Orchestrator URL",
    ),
    port: int = typer.Option(8001, "--port", "-p", help="Port for this worker"),
    name: str = typer.Option(None, "--name", "-n", help="Human-readable node name"),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Print startup config without launching"
    ),
) -> None:
    """Start the worker daemon."""
    worker_id = name or os.getenv("WORKER_ID")
    if dry_run:
        console.print("[green]Worker dry-run configuration[/green]")
        console.print(f"orchestrator={orchestrator}")
        console.print(f"port={port}")
        if worker_id:
            console.print(f"worker_id={worker_id}")
        return

    if worker_id:
        os.environ["WORKER_ID"] = worker_id
    os.environ["ORCHESTRATOR_URL"] = orchestrator
    os.environ["WORKER_PORT"] = str(port)

    console.print("[yellow]Starting worker daemon...[/yellow]")
    uvicorn.run(
        "poc.worker.daemon:app",
        host="0.0.0.0",
        port=port,
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
    )


@app.command()
def orchestrate(
    port: int = typer.Option(8000, "--port", "-p", help="Port to listen on"),
    brain: str = typer.Option(
        "claude-sonnet-4-5-20250929",
        "--brain",
        help="LLM model for planning",
    ),
    log_level: str = typer.Option("INFO", "--log-level", help="Log verbosity"),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Print startup config without launching"
    ),
) -> None:
    """Start the orchestrator API."""
    if dry_run:
        console.print("[green]Orchestrator dry-run configuration[/green]")
        console.print(f"port={port}")
        console.print(f"brain={brain}")
        console.print(f"log_level={log_level}")
        return

    os.environ["ORCHESTRATOR_PORT"] = str(port)
    os.environ["PLANNER_MODEL"] = brain
    os.environ["LOG_LEVEL"] = log_level.upper()

    console.print("[yellow]Starting orchestrator...[/yellow]")
    uvicorn.run(
        "poc.orchestrator.main:app",
        host="0.0.0.0",
        port=port,
        log_level=log_level.lower(),
    )


@app.command()
def submit(
    description: str = typer.Argument(..., help="Project description"),
    orchestrator: str = typer.Option(
        "http://localhost:8000",
        "--orchestrator",
        "-o",
        help="Orchestrator URL",
    ),
    name: str = typer.Option(None, "--name", help="Project name"),
    template: str = typer.Option(
        None,
        "--template",
        "-t",
        help="Workflow template name",
    ),
    local: bool = typer.Option(False, "--local", help="Prefer local models"),
    max_cost: float = typer.Option(None, "--max-cost", help="Max cost in USD"),
) -> None:
    """Submit a new project to the orchestrator."""
    base = orchestrator.rstrip("/")

    body: dict[str, Any] = {
        "name": name or description[:60],
        "description": description,
        "constraints": {"prefer_local": local},
    }
    if template:
        body["workflow_template"] = template
    if max_cost is not None:
        body["constraints"]["max_cost_usd"] = max_cost

    try:
        with console.status("[bold green]Submitting project..."):
            resp = httpx.post(f"{base}/api/projects", json=body, timeout=30.0)
            resp.raise_for_status()
            data = resp.json()

        console.print(f"[green]✓[/green] Project submitted: {data['project_id']}")
        console.print(f"Status: {data['status']}")
        stream_url = data.get("stream_url") or f"/api/stream/{data['project_id']}"
        console.print(f"Stream: {base}{stream_url}")
    except httpx.ConnectError:
        console.print(f"[red]ERROR:[/red] Cannot connect to orchestrator at {base}")
        raise typer.Exit(1)
    except httpx.HTTPStatusError as exc:
        console.print(
            f"[red]ERROR:[/red] {exc.response.status_code} {exc.response.text}"
        )
        raise typer.Exit(1)


@app.command("run-workflow")
def run_workflow(
    template: str = typer.Argument(..., help="Workflow template name"),
    orchestrator: str = typer.Option(
        "http://localhost:8000", "--orchestrator", "-o", help="Orchestrator URL"
    ),
    name: str = typer.Option(None, "--name", help="Project name"),
    param: list[str] = typer.Option(
        None, "--param", help="Template parameter, repeatable key=value"
    ),
    local: bool = typer.Option(True, "--local/--no-local", help="Prefer local models"),
    max_cost: float = typer.Option(None, "--max-cost", help="Max cost in USD"),
) -> None:
    """Submit a workflow template project."""
    try:
        parameters = _parse_params(param or [])
    except ValueError as exc:
        console.print(f"[red]ERROR:[/red] {exc}")
        raise typer.Exit(1)

    description = f"Run workflow template '{template}'"
    body: dict[str, Any] = {
        "name": name or f"workflow:{template}",
        "description": description,
        "workflow_template": template,
        "parameters": parameters,
        "constraints": {"prefer_local": local},
    }
    if max_cost is not None:
        body["constraints"]["max_cost_usd"] = max_cost

    base = orchestrator.rstrip("/")
    try:
        with console.status("[bold green]Submitting workflow..."):
            resp = httpx.post(f"{base}/api/projects", json=body, timeout=30.0)
            resp.raise_for_status()
            data = resp.json()
        console.print(f"[green]✓[/green] Workflow submitted: {data['project_id']}")
        console.print(f"Stream: {base}{data.get('stream_url', f'/api/stream/{data['project_id']}')}")
    except httpx.ConnectError:
        console.print(f"[red]ERROR:[/red] Cannot connect to orchestrator at {base}")
        raise typer.Exit(1)
    except httpx.HTTPStatusError as exc:
        console.print(f"[red]ERROR:[/red] {exc.response.status_code} {exc.response.text}")
        raise typer.Exit(1)


@app.command()
def status(
    project_id: str = typer.Argument(..., help="Project ID"),
    orchestrator: str = typer.Option(
        "http://localhost:8000",
        "--orchestrator",
        "-o",
        help="Orchestrator URL",
    ),
) -> None:
    """Get project status and details."""
    base = orchestrator.rstrip("/")

    try:
        resp = httpx.get(f"{base}/api/projects/{project_id}", timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
        console.print_json(data=data)
    except httpx.ConnectError:
        console.print(f"[red]ERROR:[/red] Cannot connect to orchestrator at {base}")
        raise typer.Exit(1)
    except httpx.HTTPStatusError as exc:
        console.print(
            f"[red]ERROR:[/red] {exc.response.status_code} {exc.response.text}"
        )
        raise typer.Exit(1)


@app.command()
def stream(
    project_id: str = typer.Argument(..., help="Project ID"),
    orchestrator: str = typer.Option(
        "http://localhost:8000", "--orchestrator", "-o", help="Orchestrator URL"
    ),
    timeout_seconds: int = typer.Option(300, "--timeout", help="Read timeout"),
) -> None:
    """Stream SSE events for a project."""
    base = orchestrator.rstrip("/")
    url = f"{base}/api/stream/{project_id}"

    try:
        with httpx.stream("GET", url, timeout=timeout_seconds) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if line:
                    console.print(line)
                if "event: project_completed" in line or "event: project_failed" in line:
                    break
    except httpx.ConnectError:
        console.print(f"[red]ERROR:[/red] Cannot connect to orchestrator at {base}")
        raise typer.Exit(1)
    except httpx.HTTPStatusError as exc:
        console.print(f"[red]ERROR:[/red] {exc.response.status_code} {exc.response.text}")
        raise typer.Exit(1)


@app.command()
def nodes(
    orchestrator: str = typer.Option(
        "http://localhost:8000",
        "--orchestrator",
        "-o",
        help="Orchestrator URL",
    ),
    json_output: bool = typer.Option(False, "--json", help="Output as JSON"),
) -> None:
    """List all registered worker nodes."""
    base = orchestrator.rstrip("/")

    try:
        resp = httpx.get(f"{base}/api/nodes", timeout=10.0)
        resp.raise_for_status()
        data = resp.json()

        if json_output:
            console.print_json(data=data)
            return

        table = Table(title="Registered Nodes")
        table.add_column("Node ID", style="cyan")
        table.add_column("Status", style="green")
        table.add_column("Models", style="yellow")
        table.add_column("URL", style="dim")

        for node in data.get("nodes", []):
            node_id = node.get("node_id", "?")
            status = node.get("status", "unknown")
            models = [m.get("model_id", "?") for m in node.get("models", [])]
            url = node.get("url", "")
            table.add_row(node_id, status, ", ".join(models), url)

        console.print(table)
    except httpx.ConnectError:
        console.print(f"[red]ERROR:[/red] Cannot connect to orchestrator at {base}")
        raise typer.Exit(1)
    except httpx.HTTPStatusError as exc:
        console.print(
            f"[red]ERROR:[/red] {exc.response.status_code} {exc.response.text}"
        )
        raise typer.Exit(1)


def main() -> None:
    app()


if __name__ == "__main__":
    main()
