#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -euo pipefail

DELETE_MODE=0
MAIN_BRANCH="main"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --delete|-d)
        DELETE_MODE=1
        shift
        ;;
        --base=*)
        MAIN_BRANCH="${1#*=}"
        shift
        ;;
        --base)
        if [[ $# -lt 2 ]]; then
            echo "Error: --base requires an argument."
            exit 1
        fi
        MAIN_BRANCH="$2"
        shift 2
        ;;
        --help|-h)
        echo "Usage: $0 [--delete|-d] [--base=<branch_name>]"
        echo ""
        echo "Finds squash-merged local branches (and their worktrees)."
        echo ""
        echo "Options:"
        echo "  --delete, -d      Actually delete the branches (default is to only find)"
        echo "  --base=<name>     Specify the main/base branch (default: 'main')"
        exit 0
        ;;
        *)
        echo "Unknown option: $1"
        exit 1
        ;;
    esac
done

echo "Base branch: $MAIN_BRANCH"
if [ "$DELETE_MODE" -eq 0 ]; then
    echo "Mode: FIND (No branches/worktrees will be deleted)"
else
    echo "Mode: DELETE (Branches and associated worktrees WILL be deleted)"
fi
echo "--------------------------------------------------------"

# Helper function to find the worktree path for a branch
get_worktree_for_branch() {
    local target_branch="$1"
    git worktree list --porcelain | awk -v br="refs/heads/$target_branch" '
        /^worktree / { wt=substr($0, 10) }
        /^branch / { if ($2 == br) print wt }
    '
}

# Helper function to handle the deletion logic
process_branch() {
    local branch_name="$1"
    local reason="$2"
    
    # 1. Find if the branch has a worktree
    local wt_path
    wt_path=$(get_worktree_for_branch "$branch_name")
    
    if [ -n "$wt_path" ]; then
        if [ "$DELETE_MODE" -eq 0 ]; then
            echo "Found branch ($reason) with worktree at $wt_path: $branch_name"
        else
            echo "Removing worktree for $branch_name at: $wt_path"
            # Note: This will naturally fail if the worktree has uncommitted changes.
            if git worktree remove "$wt_path"; then
                echo "Deleting branch ($reason): $branch_name"
                git branch -D "$branch_name"
            else
                echo "⚠️  Skipping branch $branch_name because worktree could not be safely removed."
            fi
        fi
    else
        # No worktree, just delete or report the branch
        if [ "$DELETE_MODE" -eq 0 ]; then
            echo "Found branch ($reason): $branch_name"
        else
            echo "Deleting branch ($reason): $branch_name"
            git branch -D "$branch_name"
        fi
    fi
}

NOT_MERGED_BRANCHES=()
CLEAN_GONE_BRANCHES=()

# 1. The Fast Path: Upstream [gone] tracking
echo "Step 1: Checking for remote branches marked as [gone]..."
git fetch --prune --quiet

GONE_BRANCHES=()
while IFS= read -r line; do
    [[ -n "$line" ]] && GONE_BRANCHES+=("$line")
done < <(git for-each-ref --format '%(refname:short) %(upstream:track)' refs/heads | awk '$2 == "[gone]" {print $1}' || true)

if [ ${#GONE_BRANCHES[@]} -gt 0 ]; then
    for branch_name in "${GONE_BRANCHES[@]}"; do
        if [ -z "$branch_name" ] || [ "$branch_name" = "$MAIN_BRANCH" ]; then continue; fi
        
        CLEAN_GONE_BRANCHES+=("$branch_name")
        process_branch "$branch_name" "upstream gone"
    done
else
    echo "No [gone] branches found."
fi

echo ""

# Helper to check if array contains element
contains_element() {
    local e match="$1"
    shift
    for e in "$@"; do [ "$e" = "$match" ] && return 0; done
    return 1
}

# 2. The Deep Check: Patch-ID / Dummy Commit Method
echo "Step 2: Performing deep tree diffs for local branches..."

LOCAL_BRANCHES=()
while IFS= read -r line; do
    if [[ -n "$line" && "$line" != "$MAIN_BRANCH" ]]; then
        LOCAL_BRANCHES+=("$line")
    fi
done < <(git for-each-ref refs/heads/ "--format=%(refname:short)" || true)

if [ ${#LOCAL_BRANCHES[@]} -gt 0 ]; then
    for branch in "${LOCAL_BRANCHES[@]}"; do
        if [ -z "$branch" ]; then continue; fi

        # Skip if the branch was already processed in Step 1
        if contains_element "$branch" "${CLEAN_GONE_BRANCHES[@]:-}"; then
            continue
        fi

        if ! git show-ref --verify --quiet "refs/heads/$branch"; then
            continue
        fi

        # Find the merge base
        mergeBase=$(git merge-base "$MAIN_BRANCH" "$branch" 2>/dev/null || true)
        
        if [ -z "$mergeBase" ]; then
            NOT_MERGED_BRANCHES+=("$branch (no common ancestor)")
            continue
        fi

        # Check if the branch has no commits ahead of the merge base
        branchRev=$(git rev-parse "$branch" 2>/dev/null || true)
        if [ "$branchRev" = "$mergeBase" ]; then
            process_branch "$branch" "fully merged (no new commits)"
            continue
        fi

        # Create a dummy commit of the branch's tree on top of the merge base
        dummyCommit=$(git commit-tree "$(git rev-parse "$branch^{tree}")" -p "$mergeBase" -m _ 2>/dev/null || true)
        
        if [ -z "$dummyCommit" ]; then
            NOT_MERGED_BRANCHES+=("$branch")
            continue
        fi

        # Check if the exact changes in the dummy commit are already in the main branch
        cherryStatus=$(git cherry "$MAIN_BRANCH" "$dummyCommit" 2>/dev/null | cut -c 1 || true)

        if [ "$cherryStatus" = "-" ]; then
            process_branch "$branch" "squash-merged"
        else
            NOT_MERGED_BRANCHES+=("$branch")
        fi
    done
fi

echo "--------------------------------------------------------"
if [ ${#NOT_MERGED_BRANCHES[@]} -gt 0 ]; then
    echo "The following branches are NOT merged into $MAIN_BRANCH:"
    for b in "${NOT_MERGED_BRANCHES[@]}"; do
        echo "  - $b"
    done
    echo "--------------------------------------------------------"
fi

if [ "$DELETE_MODE" -eq 0 ]; then
    echo "Find complete. Run with --delete to actually clean up merged branches and worktrees."
else
    echo "Cleanup complete."
fi
