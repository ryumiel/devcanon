Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

function Require-Env {
  param([string] $Name)

  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($Name))) {
    [Console]::Error.WriteLine("Missing required environment variable: $Name")
    exit 1
  }
}

function Emit-Line {
  param(
    [string] $Key,
    [string] $Value
  )

  Write-Output "$Key=$Value"
}

function Invoke-Git {
  param([string[]] $Arguments)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & git @Arguments 2>&1
    $status = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($status -ne 0) {
    if ($output) {
      [Console]::Error.WriteLine(($output | Out-String).TrimEnd())
    }
    exit $status
  }

  return ($output -join "`n").TrimEnd()
}

function Test-Git {
  param([string[]] $Arguments)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & git @Arguments *> $null
    return $LASTEXITCODE -eq 0
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

function Normalize-Path {
  param([string] $Path)

  return [System.IO.Path]::GetFullPath($Path).TrimEnd("\", "/")
}

function Is-Link {
  param([string] $Path)

  try {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    return [bool] ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
  } catch [System.Management.Automation.ItemNotFoundException] {
    return $false
  }
}

Require-Env "BRANCH_NAME"
Require-Env "WORKTREE_LEAF"

$branchName = [Environment]::GetEnvironmentVariable("BRANCH_NAME")
$worktreeLeaf = [Environment]::GetEnvironmentVariable("WORKTREE_LEAF")
$baseRef = [Environment]::GetEnvironmentVariable("BASE_REF")

if ($branchName.StartsWith("-") -or $branchName.Contains("`n") -or $branchName.Contains("`r")) {
  [Console]::Error.WriteLine("Unsafe BRANCH_NAME: $branchName")
  exit 1
}
if (-not (Test-Git @("check-ref-format", "--branch", $branchName))) {
  [Console]::Error.WriteLine("Invalid BRANCH_NAME: $branchName")
  exit 1
}

if (
  $worktreeLeaf -eq "." -or
  $worktreeLeaf.StartsWith("/") -or
  $worktreeLeaf.StartsWith("\") -or
  $worktreeLeaf.StartsWith("-") -or
  $worktreeLeaf.Contains("/") -or
  $worktreeLeaf.Contains("\") -or
  $worktreeLeaf.Contains("..") -or
  $worktreeLeaf.Contains("`n") -or
  $worktreeLeaf.Contains("`r") -or
  [System.IO.Path]::IsPathRooted($worktreeLeaf)
) {
  [Console]::Error.WriteLine("Unsafe WORKTREE_LEAF: $worktreeLeaf")
  exit 1
}

if ([string]::IsNullOrWhiteSpace($baseRef)) {
  $defaultBranch = ""
  $symbolicRef = & git symbolic-ref --short refs/remotes/origin/HEAD 2>$null
  if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($symbolicRef)) {
    $defaultBranch = ($symbolicRef -join "").Trim() -replace "^origin/", ""
  }
  if ([string]::IsNullOrWhiteSpace($defaultBranch)) {
    foreach ($fallback in @("main", "master")) {
      if (Test-Git @("show-ref", "--verify", "--quiet", "refs/remotes/origin/$fallback")) {
        $defaultBranch = $fallback
        break
      }
    }
  }
  if ([string]::IsNullOrWhiteSpace($defaultBranch)) {
    $defaultBranch = "main"
  }
  $baseRef = "origin/$defaultBranch"
}

if ($baseRef.StartsWith("-") -or $baseRef.Contains("`n") -or $baseRef.Contains("`r")) {
  [Console]::Error.WriteLine("Unsafe BASE_REF: $baseRef")
  exit 1
}

$currentWorktree = Invoke-Git @("rev-parse", "--show-toplevel")
$currentWorktreeReal = Normalize-Path $currentWorktree
$currentStatus = Invoke-Git @("status", "--short")

$superproject = & git rev-parse --show-superproject-working-tree 2>$null
if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($superproject)) {
  $superprojectReal = Normalize-Path (($superproject -join "").Trim())
  Emit-Line "MODE" "stop"
  Emit-Line "WORKTREE_PATH" $currentWorktree
  Emit-Line "MESSAGE" "Running issue-worktree-setup from inside submodule $currentWorktreeReal is unsupported; re-run from superproject $superprojectReal."
  exit 0
}

$mainWorktree = ""
$worktreeList = Invoke-Git @("worktree", "list", "--porcelain")
foreach ($line in ($worktreeList -split "`n")) {
  if ($line.StartsWith("worktree ")) {
    $mainWorktree = $line.Substring("worktree ".Length).TrimEnd("`r")
    break
  }
}
if ([string]::IsNullOrWhiteSpace($mainWorktree)) {
  [Console]::Error.WriteLine("Unable to determine the primary worktree.")
  exit 1
}

Invoke-Git @("fetch", "origin") | Out-Null

$resolvedBase = & git rev-parse --verify --quiet "$baseRef^{commit}" 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($resolvedBase)) {
  [Console]::Error.WriteLine("Unable to resolve BASE_REF to a commit: $baseRef")
  exit 1
}
$resolvedBase = ($resolvedBase -join "").Trim()

if (Test-Git @("show-ref", "--verify", "--quiet", "refs/heads/$branchName")) {
  [Console]::Error.WriteLine("Branch already exists: $branchName")
  exit 1
}

if ((Normalize-Path $currentWorktree) -ne (Normalize-Path $mainWorktree)) {
  if ([string]::IsNullOrEmpty($currentStatus)) {
    & git merge-base --is-ancestor HEAD $resolvedBase *> $null
    $ancestorStatus = $LASTEXITCODE
    if ($ancestorStatus -eq 0) {
      Invoke-Git @("checkout", "-b", $branchName, $resolvedBase) | Out-Null
      Emit-Line "MODE" "reuse"
      Emit-Line "WORKTREE_PATH" $currentWorktree
      Emit-Line "MESSAGE" "Reused clean managed worktree."
      exit 0
    }
    if ($ancestorStatus -ne 1) {
      [Console]::Error.WriteLine("git merge-base --is-ancestor failed unexpectedly (exit $ancestorStatus)")
      exit 1
    }
  }

  Emit-Line "MODE" "stop"
  Emit-Line "WORKTREE_PATH" $currentWorktree
  if (-not [string]::IsNullOrEmpty($currentStatus)) {
    Emit-Line "MESSAGE" "Managed worktree has uncommitted changes; return to the primary checkout."
  } else {
    Emit-Line "MESSAGE" "Managed worktree has commits not in BASE_REF; return to the primary checkout."
  }
  exit 0
}

$worktreesDir = Join-Path $currentWorktree ".worktrees"
$ignoreProbe = ".worktrees/.devcanon-ignore-probe"
if (-not (Test-Git @("-C", $currentWorktree, "check-ignore", "-q", $ignoreProbe))) {
  [Console]::Error.WriteLine("'.worktrees/' is not ignored in this repo.")
  [Console]::Error.WriteLine("Add '.worktrees/' to .gitignore and commit before re-running.")
  exit 1
}

if (Is-Link $worktreesDir) {
  [Console]::Error.WriteLine(".worktrees must be a normal directory inside the primary checkout.")
  exit 1
}

New-Item -ItemType Directory -Force -Path $worktreesDir | Out-Null

$worktreesDirReal = Normalize-Path $worktreesDir
$expectedWorktreesDirReal = Normalize-Path (Join-Path $currentWorktreeReal ".worktrees")
if ($worktreesDirReal -ne $expectedWorktreesDirReal) {
  [Console]::Error.WriteLine(".worktrees resolved outside the primary checkout.")
  exit 1
}

$newWorktreePath = Join-Path $worktreesDir $worktreeLeaf
if ((Test-Path -LiteralPath $newWorktreePath) -or (Is-Link $newWorktreePath)) {
  [Console]::Error.WriteLine("Target worktree path already exists: $newWorktreePath")
  exit 1
}

Invoke-Git @("worktree", "add", "-b", $branchName, $newWorktreePath, $resolvedBase) | Out-Null

Emit-Line "MODE" "new"
Emit-Line "WORKTREE_PATH" $newWorktreePath
Emit-Line "MESSAGE" "Created new managed worktree."
