# Validated evidence is immutable; this projection is only for publication.
def project($scope):
  . as $e
  | (if $scope == "current" then .findings elif $scope == "posted" then .findings + [.carry_forward[] | select(.anchor == "out-of-diff")] else .findings + .carry_forward end)
  | reduce .[] as $f ([]; if any(.id == $f.id) then . else . + [$f] end)
  | map(. as $f | ([$e.presentation_overrides[]? | select(.id == $f.id)][0] // {}) as $o
      | select(.critic != "INVALID" and $o.action != "drop")
      | .severity = ($o.severity // (if .critic == "DOWNGRADE" then "Nit" else .severity end))
      | .category = ($o.category // .category)
      | .body = ("**" + .severity + " | " + .category + "** — " + .why + "\n\n**Recommendation:** " + .recommendation));
