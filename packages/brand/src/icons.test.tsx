import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  SunIcon,
  MoonIcon,
  ExternalLinkIcon,
  ShieldCheckIcon,
  RadarIcon,
  PenLineIcon,
  ScissorsIcon,
  ScaleIcon,
  GaugeIcon,
  MegaphoneIcon,
  EyeIcon,
  VerdictTrueIcon,
  VerdictMostlyTrueIcon,
  VerdictMisleadingIcon,
  VerdictFalseIcon,
  VerdictUnprovenIcon,
  VerdictNotCheckableIcon,
} from "./icons";

describe("icons", () => {
  it.each([
    ["SunIcon", SunIcon],
    ["MoonIcon", MoonIcon],
    ["ExternalLinkIcon", ExternalLinkIcon],
    ["ShieldCheckIcon", ShieldCheckIcon],
    ["RadarIcon", RadarIcon],
    ["PenLineIcon", PenLineIcon],
    ["ScissorsIcon", ScissorsIcon],
    ["ScaleIcon", ScaleIcon],
    ["GaugeIcon", GaugeIcon],
    ["MegaphoneIcon", MegaphoneIcon],
    ["EyeIcon", EyeIcon],
    ["VerdictTrueIcon", VerdictTrueIcon],
    ["VerdictMostlyTrueIcon", VerdictMostlyTrueIcon],
    ["VerdictMisleadingIcon", VerdictMisleadingIcon],
    ["VerdictFalseIcon", VerdictFalseIcon],
    ["VerdictUnprovenIcon", VerdictUnprovenIcon],
    ["VerdictNotCheckableIcon", VerdictNotCheckableIcon],
  ] as const)("%s renders a decorative (aria-hidden) svg with currentColor stroke", (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("stroke", "currentColor");
  });

  it("respects a custom size", () => {
    const { container } = render(<SunIcon size={32} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "32");
    expect(svg).toHaveAttribute("height", "32");
  });
});
