def nonblank: type == "string" and test("\\S");
def sha: type == "string" and test("^[0-9a-f]{40}$");
def unique_ids: map(.id) as $ids | ($ids | unique | length) == ($ids | length);
def assessment($head):
  . as $f | .assessment as $a
  | (.id | type == "string" and test("^[A-Za-z0-9_-]+$"))
  and (.origin_head_sha | sha)
  and (.why | nonblank) and (.recommendation | nonblank)
  and ($a | keys == ["assessed_head_sha", "basis", "reuse_checked_head_sha", "selection", "state", "verification"])
  and ($a.basis | nonblank) and ($a.assessed_head_sha | sha)
  and (if $a.state == "fresh" then $a.assessed_head_sha == $head and $a.reuse_checked_head_sha == null
    elif $a.state == "reused" then $f.severity == "Nit" and $a.selection == "none" and $a.reuse_checked_head_sha == $head
    else false end)
  and (if $a.selection == "none" then $f.critic == null and $a.verification == "not-required"
    else (["consequential", "disputed", "uncertain"] | index($a.selection)) != null
      and $f.severity == "Blocking"
      and (if $a.verification == "completed" then (["VALID", "INVALID", "DOWNGRADE"] | index($f.critic)) != null
        elif $a.verification == "incomplete" then $f.critic == null else false end)
    end);
. as $e
| (.review_head_sha | sha)
and (.findings | unique_ids) and (.carry_forward | unique_ids)
and ((.findings + .carry_forward) | all(.[]; assessment($e.review_head_sha)))
and ((.findings + .carry_forward) | group_by(.id) | all(.[]; (unique | length) == 1))
and (.incomplete_review_routes | type == "array")
and (.incomplete_review_routes | all(.[];
  keys == ["disposition", "route"]
  and (.route == "D7" or .route == "D10")
  and (.disposition == "FAILED" or .disposition == "NEEDS_CONTEXT" or .disposition == "CONTROLLER_OBSERVED_FAILURE")))
and ((.incomplete_review_routes | map(.route) | unique | length) == (.incomplete_review_routes | length))
and (.verification | keys == ["reason", "selected_ids", "state"])
and (.verification.reason | nonblank)
and (.verification.selected_ids | type == "array")
and ((.verification.selected_ids | unique | length) == (.verification.selected_ids | length))
and (((.findings + .carry_forward) | map(select(.assessment.selection != "none") | .id) | unique | sort) == (.verification.selected_ids | sort))
and (if (.verification.selected_ids | length) == 0 then
    .verification.state == "not-required" and (.incomplete_review_routes | all(.[]; .route != "D10"))
  elif .verification.state == "completed" then
    (.incomplete_review_routes | all(.[]; .route != "D10"))
    and ((.findings + .carry_forward) | all(.[]; .assessment.selection == "none" or .assessment.verification == "completed"))
  elif .verification.state == "incomplete" then
    (.incomplete_review_routes | any(.[]; .route == "D10"))
    and ((.findings + .carry_forward) | all(.[]; .assessment.selection == "none" or .assessment.verification == "incomplete"))
  else false end)
and (.prior_dispositions | type == "array" and unique_ids)
and (.prior_dispositions | all(.[];
  keys == ["assessed_head_sha", "id", "origin_head_sha", "reason", "status"]
  and (.id | nonblank) and (.origin_head_sha | sha)
  and (.why | nonblank) and (.recommendation | nonblank) and .assessed_head_sha == $e.review_head_sha
  and (.reason | nonblank) and (.status == "resolved" or .status == "invalid")
  and (.id as $id | ($e.findings + $e.carry_forward) | all(.[]; .id != $id))))
