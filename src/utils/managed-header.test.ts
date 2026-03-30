import { describe, expect, it } from "vitest";
import {
  extractSourceFromHeader,
  hasManagedHeader,
  makeMdHeader,
  makeTomlHeader,
} from "./managed-header.js";

describe("makeMdHeader", () => {
  it("produces correct HTML comment lines", () => {
    const header = makeMdHeader("agents/my-agent.yaml");
    expect(header).toBe(
      "<!-- Managed by agents-manager. Do not edit directly. -->\n" +
        "<!-- Source: agents/my-agent.yaml -->",
    );
  });
});

describe("makeTomlHeader", () => {
  it("produces correct TOML comment lines", () => {
    const header = makeTomlHeader("agents/my-agent.yaml");
    expect(header).toBe(
      "# Managed by agents-manager. Do not edit directly.\n" +
        "# Source: agents/my-agent.yaml",
    );
  });
});

describe("hasManagedHeader", () => {
  it("detects managed md files", () => {
    const content =
      "<!-- Managed by agents-manager. Do not edit directly. -->\n<!-- Source: foo -->\nBody";
    expect(hasManagedHeader(content, "md")).toBe(true);
  });

  it("detects managed toml files", () => {
    const content =
      "# Managed by agents-manager. Do not edit directly.\n# Source: foo\n[section]";
    expect(hasManagedHeader(content, "toml")).toBe(true);
  });

  it("returns false for non-managed content", () => {
    expect(hasManagedHeader("# Just a normal file", "md")).toBe(false);
    expect(hasManagedHeader("Some random content", "toml")).toBe(false);
  });
});

describe("extractSourceFromHeader", () => {
  it("extracts source path from md header", () => {
    const content =
      "<!-- Managed by agents-manager. Do not edit directly. -->\n<!-- Source: agents/test.yaml -->\nBody";
    expect(extractSourceFromHeader(content, "md")).toBe("agents/test.yaml");
  });

  it("extracts source path from toml header", () => {
    const content =
      "# Managed by agents-manager. Do not edit directly.\n# Source: agents/test.yaml\n[section]";
    expect(extractSourceFromHeader(content, "toml")).toBe("agents/test.yaml");
  });

  it("returns null when no source header is present", () => {
    expect(extractSourceFromHeader("No header here", "md")).toBeNull();
    expect(extractSourceFromHeader("No header here", "toml")).toBeNull();
  });
});
