# 5Tick IDE (Phase 7 — Path B)

Goal: ship a Trae-like **standalone IDE** based on Code-OSS, with 5Tick agent built in.

## Stages

| Stage | What | Status |
|-------|------|--------|
| 7.1 | Product launcher (Extension Host as “5Tick IDE”) | Done |
| 7.2 | Package extension as `.vsix` | Done |
| 7.3 | Clone Code-OSS + brand `product.json` as 5Tick | Done |
| 7.4 | Bundle agent + extension as built-in + brand logo | Done |
| 7.5 | Portable zip + classic Setup.exe (`npm run ide:setup`) | Done |

## Quick start (7.1 launcher)

From repo root (agent must be running):

```powershell
npm run agent
npm run ide
```

This opens VS Code Extension Host with the 5Tick extension loaded and `demo-workspace` open — closest Path A “product” experience before a full Code-OSS build.

## Portable installer (available now)

```powershell
npm run ide:portable
```

Creates `apps/ide/dist/5Tick-portable-win64.zip` (VSIX + `Start-5Tick.bat`).

## Full Code-OSS compile / setup.exe

```powershell
npm run ide:install-oss   # deps + native rebuild
npm run ide:compile-oss   # gulp compile
npm run ide:run-oss       # scripts/code.bat
npm run ide:installer     # win32-x64 package / setup (long)
```

Requires VS 2022 Build Tools with C++. Spectre libs are optional; the install script bypasses Spectre mitigation for node-gyp.

## Portable installer (available now)

```powershell
npm run ide:portable
```

Creates `apps/ide/dist/5Tick-portable-win64.zip` (VSIX + `Start-5Tick.bat`).

## Full Code-OSS compile / setup.exe

```powershell
npm run ide:install-oss   # deps + native rebuild
npm run ide:compile-oss   # gulp compile
npm run ide:run-oss       # scripts/code.bat
npm run ide:installer     # win32-x64 package / setup (long)
```

Requires VS 2022 Build Tools with C++. Spectre libs are optional; the install script bypasses Spectre mitigation for node-gyp.

## Code-OSS bootstrap (7.3)

```powershell
npm run ide:bootstrap
```

Clones `microsoft/vscode` shallow into `apps/ide/vscode` and applies 5Tick branding patches under `apps/ide/branding/`.

**Note:** A full Code-OSS compile needs Visual Studio C++ tools, Python, and a long first build on this CPU. Use the launcher (7.1) day-to-day until 7.3–7.5 are finished.
