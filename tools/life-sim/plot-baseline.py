#!/usr/bin/env python3
"""plot-baseline.py — Generate plots from a LifeSim CSV baseline.

Usage: python3 plot-baseline.py <input.csv> <output_dir>

Produces:
  - population.png    (prey + predator population over time)
  - traits.png        (mean speed, perception, metabolism over time)
  - energy.png        (energy quartiles over time)
  - predator.png      (predator kills, births, deaths over time)
"""
import sys, csv
from pathlib import Path

try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
except ImportError:
    print("matplotlib not installed. Run: pip3 install matplotlib")
    sys.exit(1)

csv_path = Path(sys.argv[1])
out_dir = Path(sys.argv[2])
out_dir.mkdir(parents=True, exist_ok=True)

# Parse
rows = []
with open(csv_path) as f:
    for r in csv.DictReader(f):
        rows.append({k: float(v) if k != 'focal_id' and v.replace('.','',1).replace('-','',1).isdigit() else v for k, v in r.items()})

t = [r['elapsed_s'] for r in rows if isinstance(r.get('elapsed_s'), (int, float))]

def plot_series(title, filename, y_specs):
    """y_specs: list of (column_name, label, color) tuples."""
    fig, ax = plt.subplots(figsize=(10, 5))
    for col, label, color in y_specs:
        vals = [r.get(col) for r in rows if isinstance(r.get(col), (int, float))]
        if len(vals) == len(t):
            ax.plot(t, vals, label=label, color=color, linewidth=1.2)
    ax.set_xlabel('elapsed (s)')
    ax.set_title(title)
    ax.legend(loc='best', fontsize=8)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_dir / filename, dpi=120)
    plt.close(fig)

# Population
plot_series('Population Over Time', 'population.png', [
    ('pop', 'Prey', '#2196F3'),
    ('predators', 'Predators', '#F44336'),
    ('food', 'Food', '#4CAF50'),
])

# Traits
plot_series('Trait Evolution (Mean)', 'traits.png', [
    ('mean_speed', 'Speed', '#E91E63'),
    ('mean_perception', 'Perception', '#9C27B0'),
    ('mean_metabolism', 'Metabolism', '#00BCD4'),
])

# Energy
plot_series('Energy Distribution', 'energy.png', [
    ('energy_q25', 'Q25', '#FFC107'),
    ('energy_q50', 'Median', '#FF9800'),
    ('energy_q75', 'Q75', '#F44336'),
])

# Predator
plot_series('Predator Dynamics', 'predator.png', [
    ('pred_kills', 'Kills', '#F44336'),
    ('pred_births', 'Births', '#4CAF50'),
    ('pred_deaths', 'Deaths', '#9E9E9E'),
])

print(f"4 plots written to {out_dir}/")