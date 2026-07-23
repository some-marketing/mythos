# Fleet Node Update Commands

Use this when Orwell, Rupert, or another Windows fleet node needs the current
Mythos fleet worker, mirror broadcast support, Ollama reachability repair, and
Google Drive/iCloud desktop stack.

Run from an elevated PowerShell session on the node:

```powershell
cd C:\Mythos
git fetch origin
git switch recovery/clean-lineage-2026-05-18
git pull --ff-only
powershell -ExecutionPolicy Bypass -File tools\fleet\ensure-node-cloud-stack.ps1 -OpenCloudApps
Restart-Service simpleminions-worker
```

After the node updates, verify from the orchestrator host:

```bash
curl http://orwell:8001/api/health
curl http://orwell:11434/api/tags
curl http://rupert:8001/api/health
curl http://rupert:11434/api/tags
npm run fleet:broadcast-mirror -- --serve
```

Expected state:

- Orwell and Rupert are on `recovery/clean-lineage-2026-05-18`.
- Each worker supports the `display` tool.
- Each node has Ollama installed and listening through `OLLAMA_HOST=0.0.0.0:11434`.
- TCP 11434 is allowed through the Windows firewall on Private networks.
- Google Drive and iCloud are installed and opened for human sign-in.
- `simpleminions-worker` has been restarted so it picks up the latest code and environment.
