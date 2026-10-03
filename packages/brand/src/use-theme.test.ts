import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTheme } from "./use-theme";

function mockMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("useTheme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    mockMatchMedia(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to the system theme (light) and sets data-theme on <html>", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("defaults to dark when the OS prefers dark and nothing is stored", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe("dark");
  });

  it("toggle() flips the theme and persists the choice to localStorage", () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current[1]();
    });
    expect(result.current[0]).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("fck-theme")).toBe("dark");
  });

  it("reads a previously stored theme over the system preference", () => {
    window.localStorage.setItem("fck-theme", "dark");
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe("dark");
  });
});
