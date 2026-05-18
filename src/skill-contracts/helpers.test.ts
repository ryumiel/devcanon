import { describe, expect, it } from "vitest";
import { getMarkdownSection } from "../__test-helpers__/skill-contracts.js";

describe("skill contract markdown helpers", () => {
  it("ignores headings inside fenced markdown examples when extracting sections", () => {
    const source = [
      "## Draft Shape",
      "",
      "The section explains the issue body template.",
      "",
      "```markdown",
      "## Problem",
      "",
      "Example problem text.",
      "```",
      "",
      "The section continues after the fenced example.",
      "",
      "## Next Section",
      "",
      "This content belongs elsewhere.",
    ].join("\n");

    const section = getMarkdownSection(source, "Draft Shape");

    expect(section).toContain("## Problem");
    expect(section).toContain(
      "The section continues after the fenced example.",
    );
    expect(section).not.toContain("## Next Section");
  });

  it("ignores matching start headings inside fenced examples", () => {
    const source = [
      "## Template Container",
      "",
      "```markdown",
      "## Target",
      "",
      "Template-only content.",
      "```",
      "",
      "## Target",
      "",
      "Real section content.",
      "",
      "## Next Section",
      "",
      "This content belongs elsewhere.",
    ].join("\n");

    const section = getMarkdownSection(source, "Target");

    expect(section).toContain("Real section content.");
    expect(section).not.toContain("Template-only content.");
    expect(section).not.toContain("## Next Section");
  });

  it("tracks opening fence length before treating shorter inner fences as boundaries", () => {
    const source = [
      "## Outer Section",
      "",
      "````markdown",
      "```markdown",
      "## Inner Template Heading",
      "```",
      "````",
      "",
      "The real section continues after the nested example.",
      "",
      "## Next Section",
      "",
      "This content belongs elsewhere.",
    ].join("\n");

    const section = getMarkdownSection(source, "Outer Section");

    expect(section).toContain("## Inner Template Heading");
    expect(section).toContain(
      "The real section continues after the nested example.",
    );
    expect(section).not.toContain("## Next Section");
  });
});
